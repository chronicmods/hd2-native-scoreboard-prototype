const fs = require('fs');
const path = require('path');

const patchFilename = process.argv[2];
const xamlFilename = process.argv[3];
if (!patchFilename || !xamlFilename) {
  throw new Error('Usage: node validate_patch.js PATCH_FILE XAML_SOURCE');
}

const expectedFileId = 0x1b82bcb2c79c750dn;
const expectedTypeId = 0x46bc82aae9ae0565n;
const patch = fs.readFileSync(patchFilename);
const sourceXaml = fs.readFileSync(xamlFilename);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(patch.subarray(0, 4).equals(Buffer.from([0x11, 0, 0, 0xf0])), 'Bad Stingray archive magic');
assert(patch.readUInt32LE(4) === 1, 'Patch must contain exactly one resource type');
assert(patch.readUInt32LE(8) === 1, 'Patch must contain exactly one resource');
assert(patch.readBigUInt64LE(112) === expectedTypeId, 'Unexpected resource type');
assert(patch.readBigUInt64LE(104) === expectedFileId, 'Unexpected overlay_hud resource ID');

const resourceOffset = Number(patch.readBigUInt64LE(120));
const resourceSize = patch.readUInt32LE(160);
assert(resourceOffset % 16 === 0, 'Resource is not 16-byte aligned');
assert(resourceOffset + resourceSize <= patch.length, 'Resource extends past patch');
assert(patch.readUInt32LE(resourceOffset) === sourceXaml.length, 'Embedded XAML length differs from source');
assert(resourceSize === sourceXaml.length + 16, 'Resource wrapper size is invalid');
const embeddedXaml = patch.subarray(resourceOffset + 16, resourceOffset + 16 + sourceXaml.length);
assert(embeddedXaml.equals(sourceXaml), 'Embedded XAML differs from source bytes');

const text = sourceXaml.toString('utf8');
const modifiers = ['', 'Shift', 'Ctrl', 'Alt', 'Ctrl+Shift', 'Alt+Shift', 'Alt+Ctrl', 'Alt+Ctrl+Shift'];
for (const modifier of modifiers) {
  const modifierAttribute = modifier ? ` Modifiers="${modifier}"` : '';
  assert(text.includes(`<b:KeyTrigger Key="F8"${modifierAttribute} FiredOn="KeyDown" ActiveOnFocus="False">`),
    `Missing F8 press trigger for modifiers: ${modifier || 'None'}`);
  assert(text.includes(`<b:KeyTrigger Key="F8"${modifierAttribute} FiredOn="KeyUp" ActiveOnFocus="False">`),
    `Missing F8 release trigger for modifiers: ${modifier || 'None'}`);
}
assert(/Button="View" FiredOn="ButtonDown" ActiveOnFocus="False"/.test(text), 'Missing View press trigger');
assert(/Button="View" FiredOn="ButtonUp" ActiveOnFocus="False"/.test(text), 'Missing View release trigger');
assert(!text.includes('HandleWhenFired'), 'Unsupported modern GamepadTrigger property is present');
assert((text.match(/PropertyName="IsEnabled" Value="True"/g) || []).length === 9, 'Held-state press latch count is wrong');
assert((text.match(/PropertyName="IsEnabled" Value="False"/g) || []).length === 9, 'Held-state release latch count is wrong');
assert((text.match(/<DataTrigger Binding="\{Binding IsEnabled, ElementName=(KeyboardHeldState|ControllerHeldState)\}" Value="True">/g) || []).length === 2,
  'Keyboard/controller OR visibility triggers are missing');
assert(/<Setter Property="Visibility" Value="Collapsed"\/>/.test(text), 'Scoreboard lacks collapsed default state');
assert(/IsHitTestVisible="False"/.test(text), 'Scoreboard is not input-transparent');
assert(!/\b(?:Player|Teammates(?:\[[^\]]+\])?)\.(?:EnemyKills|Deaths|FriendlyKills|Score)\b/.test(text),
  'Speculative live-stat binding is present');

const modDirectory = path.dirname(patchFilename);
const entries = fs.readdirSync(modDirectory).sort();
const expectedEntries = [
  '9ba626afa44a3aa3.patch_0',
  '9ba626afa44a3aa3.patch_0.gpu_resources',
  '9ba626afa44a3aa3.patch_0.stream',
].sort();
assert(JSON.stringify(entries) === JSON.stringify(expectedEntries), 'Mod directory must contain only the native patch triplet');
assert(fs.statSync(path.join(modDirectory, expectedEntries[1])).size === 0, 'GPU companion must be empty');
assert(fs.statSync(path.join(modDirectory, expectedEntries[2])).size === 0, 'Stream companion must be empty');

process.stdout.write(JSON.stringify({
  valid: true,
  patchBytes: patch.length,
  xamlBytes: sourceXaml.length,
  resourceOffset,
  resourceSize,
  fileId: expectedFileId.toString(16),
  typeId: expectedTypeId.toString(16),
  files: entries,
  modifierTransitionCases: modifiers.length * modifiers.length,
  liveData: false,
  behavior: 'F8 or View held => visible; all Ctrl/Shift/Alt modifier states covered; neither held => collapsed; hit testing disabled',
}, null, 2));
