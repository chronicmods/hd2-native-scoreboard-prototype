# HD2 Native Scoreboard Prototype

I wanted a scoreboard that stays inside Helldivers 2, only appears while I hold a button, and does not need ReShade, a launcher, or a helper running in the background. This repo is the native archive-patch prototype for that idea.

## Current status

This is a UI and input prototype. It is **not a working live scoreboard yet**.

The patch contains:

- A native HD2 archive patch loaded from the game's `data` folder.
- A four-player scoreboard layout in `ui.OverlayHud`.
- F8 press/release triggers instead of a toggle.
- Xbox View/controller press/release triggers.
- Separate keyboard and controller held states, combined as an OR.
- Every Ctrl, Shift, and Alt combination on both F8 down and F8 up. The triggers cover cases where W or sprint is already held, but game-side forwarding is still untested.
- Disabled focus and hit testing so the panel is designed not to capture movement or combat input.

The hard limit is live data. The shipped `ui.OverlayHud` file is an empty page with no runtime squad-stat binding. I checked the game's shipped XAML and found no in-mission player kills, deaths, or score collection that this page can bind to. The rows therefore stay static. The bind is also fixed in the XAML rather than appearing in the game's input settings.

The archive and XAML have been validated, but I have not installed this build or run it in a live game. HD2 may not instantiate this legacy overlay page during a mission, and controller forwarding still needs an in-game test.

## Files

- `mod/` contains the three files copied into Helldivers 2.
- `src/overlay_hud.xaml` is the native overlay source.
- `tools/build_patch.js` rebuilds the archive directly from an installed game.
- `tools/validate_patch.js` checks the archive IDs, embedded XAML, hold triggers, sidecars, and input-transparent flags.

There are no runtime DLLs, scripts, launchers, injectors, or background programs in the mod package. The JavaScript files are development tools only and never run with the game.

## Experimental install

1. Close Helldivers 2.
2. Open `Steam\steamapps\common\Helldivers 2\data`.
3. Make sure `9ba626afa44a3aa3.patch_0` is not already used by another mod.
4. Copy all three files from `mod/` into that folder.
5. Launch the game normally through Steam.

If patch slot 0 is already occupied, do not overwrite it. Merge the patches or give all three files the same unused `patch_N` suffix with an HD2 mod manager.

To uninstall it, remove only the three matching files you copied.

## Controls

- Keyboard: hold F8 to show the panel; release F8 to hide it.
- Controller: hold View to show the panel; release View to hide it.

These controls describe the intended XAML behavior. They still need to be confirmed in the current game build.

## Changing the fixed binds

The native patch cannot add a new option to HD2's controls menu. To change the keyboard bind, replace every `Key="F8"` trigger near the top of `src/overlay_hud.xaml`, update the footer text, and rebuild the patch. Keep matching KeyDown and KeyUp triggers for every modifier combination or the panel can miss a release while Ctrl, Shift, or Alt is held.

The controller bind works the same way: change both `Button="View"` triggers and rebuild. This is source-level customization, not an in-game rebind.

## Build

Node.js is the only build dependency. No npm packages are required.

```powershell
node tools/build_patch.js `
  "C:\Program Files (x86)\Steam\steamapps\common\Helldivers 2\data" `
  build `
  src\overlay_hud.xaml
```

Validate the result:

```powershell
node tools/validate_patch.js `
  build\9ba626afa44a3aa3.patch_0 `
  src\overlay_hud.xaml
```

The builder reconstructs the required game archives from `bundles.nxa`, replaces resource `1b82bcb2c79c750d` of XAML type `46bc82aae9ae0565`, and writes the common-base `9ba626afa44a3aa3.patch_0` triplet.

## Notes

- This is unofficial and may break after a game update.
- It conflicts with other mods that replace `ui.OverlayHud`.
- Any HD2 mod is used at your own risk.
- The native UI uses [Noesis KeyTrigger](https://www.noesisengine.com/docs/App.Interactivity._KeyTrigger.html), [GamepadTrigger](https://www.noesisengine.com/docs/App.Interactivity._GamepadTrigger.html), and standard [Noesis bindings](https://www.noesisengine.com/docs/Gui.Core.Binding.html).
- HD2 archive mods are installed as patch files; mod managers only handle deployment and conflicts. See the [HD2 Modding Wiki](https://boxofbiscuits97.github.io/HD2-Modding-Wiki/user/mod%20manager/overview.html).

## License

MIT for the original source and tooling in this repo. See `LICENSE` and `NOTICE`.
