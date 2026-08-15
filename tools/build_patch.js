const fs = require('fs');
const path = require('path');

const GAME_DATA = path.resolve(process.argv[2] || '.');
// Modern HD2 mods are emitted as a patch of the SDK's common base archive,
// even when the replaced resource originally lives in another archive.
const PATCH_ARCHIVE_NAME = '9ba626afa44a3aa3';
const SOURCE_ARCHIVE_NAME = '007e093ca718ca1a';
const FILE_ID = 0x1b82bcb2c79c750dn;
const TYPE_ID = 0x46bc82aae9ae0565n;

function u32(buffer, offset) { return buffer.readUInt32LE(offset); }
function u64(buffer, offset) { return buffer.readBigUInt64LE(offset); }
function putU32(buffer, offset, value) { buffer.writeUInt32LE(value >>> 0, offset); }
function align(value, alignment) { return Math.ceil(value / alignment) * alignment; }

function decodeLz4Block(input, outputSize) {
  const output = Buffer.alloc(outputSize);
  let ip = 0;
  let op = 0;

  while (ip < input.length) {
    const token = input[ip++];
    let literalLength = token >>> 4;
    if (literalLength === 15) {
      let extra;
      do {
        if (ip >= input.length) throw new Error('Truncated LZ4 literal length');
        extra = input[ip++];
        literalLength += extra;
      } while (extra === 255);
    }
    if (ip + literalLength > input.length || op + literalLength > output.length) {
      throw new Error('Invalid LZ4 literal range');
    }
    input.copy(output, op, ip, ip + literalLength);
    ip += literalLength;
    op += literalLength;

    if (ip === input.length) break;
    if (ip + 2 > input.length) throw new Error('Truncated LZ4 match offset');
    const matchOffset = input[ip] | (input[ip + 1] << 8);
    ip += 2;
    if (matchOffset === 0 || matchOffset > op) throw new Error('Invalid LZ4 match offset');

    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      let extra;
      do {
        if (ip >= input.length) throw new Error('Truncated LZ4 match length');
        extra = input[ip++];
        matchLength += extra;
      } while (extra === 255);
    }
    matchLength += 4;
    if (op + matchLength > output.length) throw new Error('Invalid LZ4 match range');
    for (let i = 0; i < matchLength; ++i) output[op + i] = output[op + i - matchOffset];
    op += matchLength;
  }

  if (op !== outputSize) throw new Error(`LZ4 size mismatch: got ${op}, expected ${outputSize}`);
  return output;
}

function parseDsar(filename) {
  const data = fs.readFileSync(filename);
  if (data.subarray(0, 4).toString('ascii') !== 'DSAR') throw new Error(`Not DSAR: ${filename}`);
  const count = u32(data, 8);
  const chunks = [];
  for (let i = 0; i < count; ++i) {
    const offset = 0x20 + i * 0x20;
    chunks.push({
      uncompressedOffset: Number(u64(data, offset)),
      compressedOffset: Number(u64(data, offset + 8)),
      uncompressedSize: u32(data, offset + 16),
      compressedSize: u32(data, offset + 20),
      compression: data[offset + 24],
      kind: data[offset + 25],
    });
  }
  return { filename, data, chunks };
}

function inflateChunk(dsar, chunk) {
  const payload = dsar.data.subarray(chunk.compressedOffset, chunk.compressedOffset + chunk.compressedSize);
  if (chunk.compression === 0) return Buffer.from(payload);
  if (chunk.compression === 3) return decodeLz4Block(payload, chunk.uncompressedSize);
  throw new Error(`Unsupported DSAR compression ${chunk.compression}`);
}

function inflateDsar(filename) {
  const dsar = parseDsar(filename);
  return Buffer.concat(dsar.chunks.map(chunk => inflateChunk(dsar, chunk)));
}

function resourceAt(dsar, uncompressedOffset) {
  const index = dsar.chunks.findIndex(chunk => chunk.uncompressedOffset === uncompressedOffset);
  if (index < 0) throw new Error(`No DSAR chunk starts at ${uncompressedOffset} in ${dsar.filename}`);
  const pieces = [];
  for (let i = index; i < dsar.chunks.length; ++i) {
    if (i !== index && (dsar.chunks[i].kind & 0x02) !== 0) break;
    pieces.push(inflateChunk(dsar, dsar.chunks[i]));
  }
  return Buffer.concat(pieces);
}

function readPackageMap() {
  const index = inflateDsar(path.join(GAME_DATA, 'bundles.nxa'));
  const packageCount = u32(index, 0x10);
  const result = new Map();
  for (let i = 0; i < packageCount; ++i) {
    const base = 0x18 + i * 0x18;
    const size = Number(u64(index, base));
    const nameOffset = u32(index, base + 8);
    let nameEnd = nameOffset;
    while (index[nameEnd] !== 0) ++nameEnd;
    const name = index.subarray(nameOffset, nameEnd).toString('utf8');
    const itemCount = u32(index, base + 12);
    const itemOffset = u32(index, base + 16);
    const entries = [];
    for (let j = 0; j < itemCount; ++j) {
      const entryOffset = itemOffset + j * 0x10;
      entries.push({
        originalOffset: Number(u64(index, entryOffset)),
        bundleOffset: u32(index, entryOffset + 8),
        bundleIndex: index[entryOffset + 15],
      });
    }
    result.set(name, { size, entries });
  }
  return result;
}

function reconstructPackage(packageName) {
  const packageInfo = readPackageMap().get(packageName);
  if (!packageInfo) throw new Error(`Package ${packageName} is absent from bundles.nxa`);
  const output = Buffer.alloc(packageInfo.size);
  const bundles = new Map();
  for (let i = 0; i < packageInfo.entries.length; ++i) {
    const entry = packageInfo.entries[i];
    const nextOffset = i + 1 < packageInfo.entries.length ? packageInfo.entries[i + 1].originalOffset : packageInfo.size;
    const expectedSize = nextOffset - entry.originalOffset;
    if (!bundles.has(entry.bundleIndex)) {
      bundles.set(entry.bundleIndex, parseDsar(path.join(GAME_DATA, `bundles.${String(entry.bundleIndex).padStart(2, '0')}.nxa`)));
    }
    const resource = resourceAt(bundles.get(entry.bundleIndex), entry.bundleOffset);
    resource.copy(output, entry.originalOffset, 0, Math.min(resource.length, expectedSize));
  }
  return output;
}

function findBaseRecords(archive) {
  if (!archive.subarray(0, 4).equals(Buffer.from([0x11, 0x00, 0x00, 0xf0]))) throw new Error('Bad Stingray archive magic');
  const numTypes = u32(archive, 4);
  const numFiles = u32(archive, 8);
  let typeRecord = null;
  for (let i = 0; i < numTypes; ++i) {
    const record = Buffer.from(archive.subarray(72 + i * 32, 72 + (i + 1) * 32));
    if (u64(record, 8) === TYPE_ID) typeRecord = record;
  }
  const fileTable = 72 + numTypes * 32;
  let fileRecord = null;
  for (let i = 0; i < numFiles; ++i) {
    const record = Buffer.from(archive.subarray(fileTable + i * 80, fileTable + (i + 1) * 80));
    if (u64(record, 0) === FILE_ID && u64(record, 8) === TYPE_ID) fileRecord = record;
  }
  if (!typeRecord || !fileRecord) throw new Error('Target overlay XAML record not found in base archive');
  return { typeRecord, fileRecord };
}

function main() {
  const outputDirectory = process.argv[3];
  const xamlFilename = process.argv[4];
  const originalXamlFilename = process.argv[5];
  const sourceArchiveFilename = process.argv[6];
  if (!process.argv[2] || !outputDirectory || !xamlFilename) {
    throw new Error('Usage: node build_patch.js GAME_DATA OUTPUT_DIRECTORY XAML_FILE [ORIGINAL_XAML] [SOURCE_ARCHIVE]');
  }

  const sourceArchive = reconstructPackage(SOURCE_ARCHIVE_NAME);
  if (sourceArchiveFilename) {
    fs.mkdirSync(path.dirname(sourceArchiveFilename), { recursive: true });
    fs.writeFileSync(sourceArchiveFilename, sourceArchive);
  }
  const patchBaseArchive = reconstructPackage(PATCH_ARCHIVE_NAME);
  const { typeRecord, fileRecord } = findBaseRecords(sourceArchive);
  const originalOffset = Number(u64(fileRecord, 16));
  const originalSize = u32(fileRecord, 56);
  const originalResource = sourceArchive.subarray(originalOffset, originalOffset + originalSize);
  if (originalResource.length < 16) throw new Error('Original XAML resource is too short');
  if (originalXamlFilename) {
    const originalXamlLength = u32(originalResource, 0);
    const originalXaml = originalResource.subarray(16, 16 + originalXamlLength);
    fs.mkdirSync(path.dirname(originalXamlFilename), { recursive: true });
    fs.writeFileSync(originalXamlFilename, originalXaml);
  }

  const xaml = fs.readFileSync(xamlFilename);
  const resource = Buffer.alloc(16 + xaml.length);
  putU32(resource, 0, xaml.length);
  originalResource.copy(resource, 4, 4, 16);
  xaml.copy(resource, 16);

  const header = Buffer.from(patchBaseArchive.subarray(0, 72));
  putU32(header, 4, 1);
  putU32(header, 8, 1);
  putU32(typeRecord, 16, 1);
  const mainAlignment = u32(fileRecord, 68) || 16;
  const resourceOffset = align(72 + 32 + 80, mainAlignment);
  fileRecord.writeBigUInt64LE(BigInt(resourceOffset), 16);
  fileRecord.writeBigUInt64LE(0n, 24);
  fileRecord.writeBigUInt64LE(0n, 32);
  putU32(fileRecord, 56, resource.length);
  putU32(fileRecord, 60, 0);
  putU32(fileRecord, 64, 0);
  putU32(fileRecord, 76, 1);

  const minimumSize = Math.max(256, resourceOffset + resource.length);
  const patch = Buffer.alloc(minimumSize);
  header.copy(patch, 0);
  typeRecord.copy(patch, 72);
  fileRecord.copy(patch, 104);
  resource.copy(patch, resourceOffset);

  fs.mkdirSync(outputDirectory, { recursive: true });
  const patchName = `${PATCH_ARCHIVE_NAME}.patch_0`;
  fs.writeFileSync(path.join(outputDirectory, patchName), patch);
  fs.writeFileSync(path.join(outputDirectory, `${patchName}.gpu_resources`), Buffer.alloc(0));
  fs.writeFileSync(path.join(outputDirectory, `${patchName}.stream`), Buffer.alloc(0));

  const parsedLength = u32(patch, resourceOffset);
  if (u32(patch, 4) !== 1 || u32(patch, 8) !== 1 || u64(patch, 104) !== FILE_ID ||
      u64(patch, 112) !== TYPE_ID || parsedLength !== xaml.length) {
    throw new Error('Patch self-validation failed');
  }
  process.stdout.write(JSON.stringify({
    gameData: GAME_DATA,
    outputDirectory,
    patchName,
    patchBytes: patch.length,
    xamlBytes: xaml.length,
    resourceOffset,
    mainAlignment,
    patchBaseArchive: PATCH_ARCHIVE_NAME,
    patchBaseArchiveBytes: patchBaseArchive.length,
    sourceArchive: SOURCE_ARCHIVE_NAME,
    sourceArchiveBytes: sourceArchive.length,
    originalResourceBytes: originalSize,
  }, null, 2));
}

main();
