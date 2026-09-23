# Zen UserChrome & Content Hot Reload

A [Sine](https://github.com/CosmoCreeper/Sine) mod for Zen Browser that watches your
profile's chrome CSS and hot-reloads `userChrome.css` / `userContent.css` **live on
save** — no restart required.

It is the exact sister-mod of `zen-boost-hot-reload` (which watches `~/.config/zen-boosts/`),
but for the browser UI. Its primary use case is live theming:

- Matugen (or pywal, or any script) regenerates `chrome/zen-userChrome.css` /
  `chrome/zen-userContent.css` on wallpaper change.
- This mod detects the change and reapplies the whole `userChrome.css` / `userContent.css`
  chain in every open window and tab in milliseconds.

## Contents

[How it works](#how-it-works) · [Install](#install) · [Preferences](#preferences) · [Matugen setup](#matugen-setup-reference) · [Notes / limitations](#notes--limitations) · [License](#license)

## How it works

1. **Watcher** — polls the profile `chrome/` directory (top-level `*.css` +
   `mods/*.css` only; `sine-mods/`, `JS/`, `utils/` are deliberately ignored to avoid
   self-triggering loops). Tracks mtimes via `IOUtils.stat`, default 500ms, debounced 300ms.
2. **Chrome reload** — for every browser window: `windowUtils.removeSheet(uri, USER_SHEET)`
   then `loadSheet(uri, USER_SHEET)` on the profile `userChrome.css`, followed by
   `Services.obs.notifyObservers(null, "chrome-flush-caches")`. Re-evaluating the entrypoint
   re-resolves its `@import`s, so freshly generated colors apply immediately.
3. **Content reload** — a `JSWindowActor` (`UserChromeHotReload`) refreshes the profile
   `userContent.css` in every open content document across all processes (Fission-safe),
   same pattern Sine uses for its own content injection.
4. **Sine engine (optional, default on)** — also calls `window.manager.rebuildMods(true, true)`
   so Sine-managed themes refresh in sync.

## Install

Prerequisites: Sine (bootloader) installed and `sine.allow-unsafe-js` enabled (this mod ships
a userChrome script).

Options:

- **From a GitHub repo**: paste your repo URL in Sine settings → Sine Mods → add custom mod.
- **Local dev**: copy the contents of this repository into
  `~/.zen/<profile>/chrome/sine-mods/zen-userchrome-hot-reload/` and add a `zen-userchrome-hot-reload`
  entry to `chrome/sine-mods/mods.json` (see the `zen-boost-hot-reload` entry as a template).

Restart Zen (or toggle the mod off/on in Sine Mods) once so the script loads. Disable the mod
in Sine settings when you don't want it watching.

## Preferences

| Preference | Default | Description |
| --- | --- | --- |
| `extensions.zen-userchrome-hot-reload.watch-path` | *(empty)* | Custom file or directory to watch instead of the profile chrome dir. |
| `extensions.zen-userchrome-hot-reload.poll-interval-ms` | `500` | Watcher poll interval. |
| `extensions.zen-userchrome-hot-reload.reload-sine-mods` | `true` | Also trigger `manager.rebuildMods()`. |
| `extensions.zen-userchrome-hot-reload.toast` | `true` | Show a Zen toast after each reload. |
| `extensions.zen-userchrome-hot-reload.hotkey` | `Ctrl+Shift+F5` | Force a reload anytime. Empty disables. |

## Matugen setup (reference)

Your matugen config already has templates like:

```toml
[templates.zen-userchrome]
input_path = './templates/zen-userchrome.css'
output_path = '~/.zen/<profile>/chrome/zen-userChrome.css'

[templates.zen-usercontent]
input_path = './templates/zen-usercontent.css'
output_path = '~/.zen/<profile>/chrome/zen-userContent.css'
```

The profile `chrome/userChrome.css` must `@import` the generated file(s):

```css
@import url("/home/<user>/.zen/<profile>/chrome/zen-userChrome.css");
@import url("/home/<user>/.zen/<profile>/chrome/mods/mods.css");
```

With this mod running, the next `matugen` run re-tints Zen and all open pages live.

## Notes / limitations

- Reloads are triggered by mtime polling, matching how `zen-boost-hot-reload` behaves.
- `userContent.css` is refreshed in already-open documents; documents opened **after** a
  change already pick up fresh content from the engine.
- CSS cached inside `@import` chains is re-read when the entrypoint is re-registered +
  `chrome-flush-caches` runs; if you hit a stale-import case, regenerate the entrypoint too.

## License

MPL-2.0