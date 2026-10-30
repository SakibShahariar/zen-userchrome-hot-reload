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

[How it works](#how-it-works) · [Install](#install) · [Preferences](#preferences) · [Matugen setup](#matugen-setup-reference) · [Manual QA](#manual-qa) · [Troubleshooting](#troubleshooting) · [Notes / limitations](#notes--limitations) · [License](#license)

## How it works

1. **Watcher** — a single polling watcher monitors the profile `chrome/` directory (top-level `*.css` +
   `mods/*.css` by default; optional recursive scanning can include deeper CSS directories).
   Directories listed in the `excluded-dirs` preference are skipped; the defaults are `sine-mods/`, `JS/`, and `utils/` to avoid self-triggering loops.
   Recursive scans skip repeated directory paths and stop beyond 64 directory levels to bound symlink cycles.
   Cached directory listings are revalidated at least every 10 seconds even if directory metadata appears unchanged; CSS file metadata is still checked on each poll.
   Ownership transfers to another open browser window if the watcher owner closes. Tracks mtimes
   via `IOUtils.stat`, default 500ms, debounced 300ms.
2. **Chrome reload** — for every browser window: `windowUtils.removeSheet(uri, USER_SHEET)`
   then `loadSheet(uri, USER_SHEET)` on the profile `userChrome.css`, followed by
   `Services.obs.notifyObservers(null, "chrome-flush-caches")`. Re-evaluating the entrypoint
   re-resolves its `@import`s, so freshly generated colors apply immediately.
3. **Content reload** — a `JSWindowActor` (`UserChromeHotReload`) requests a refresh of the profile
   `userContent.css` in eligible open content documents and frames across browser processes.
   The actor is registered for all frames in content contexts, not browser-chrome UI contexts.
4. **Sine engine (optional, default on)** — also calls `window.manager.rebuildMods(true, true)`
   so Sine-managed themes refresh in sync.

## Content reload coverage

The reload code walks the browsing contexts of open tabs in each browser window and sends an
update request to each available `UserChromeHotReload` actor. The actor is configured with
`allFrames: true` and `matchesTarget: ["content"]`, so cross-origin frames are eligible too;
there is no same-origin filter in this mod. This does not mean every browser surface is reloadable:
`includeChrome: false` deliberately excludes browser-chrome UI, and privileged or restricted
contexts may not expose an eligible content actor.

A frame that is navigating or closing, or has no current window global, is skipped. Actor lookup
problems are warned in the Browser Console. Rejected actor requests and unsuccessful actor replies
are counted and reported as a failed-document total; successful replies from other documents are
not discarded. If no eligible content documents exist, content refresh is reported as skipped
rather than as a reload failure. If tab enumeration itself fails, the result remains an error because
coverage cannot be established.

Use the Browser Console to investigate partial content reloads. The toast summarizes the overall
reload outcome; it does not enumerate individual URLs or expose page contents.

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
| `extensions.zen-userchrome-hot-reload.enabled` | `true` | Enable or disable hot reload in this profile; changes apply immediately. |
| `extensions.zen-userchrome-hot-reload.reload-chrome` | `true` | Reload `userChrome.css`; disable for content-only workflows. |
| `extensions.zen-userchrome-hot-reload.reload-content` | `true` | Reload `userContent.css`; disable for chrome-only workflows. |
| `extensions.zen-userchrome-hot-reload.watch-path` | *(empty)* | Custom file or directory to watch; leave empty to use the profile chrome directory. Invalid or unreadable paths are reported in the Browser Console rather than silently replaced. |
| `extensions.zen-userchrome-hot-reload.poll-interval-ms` | `500` | Watcher poll interval. |
| `extensions.zen-userchrome-hot-reload.reload-debounce-ms` | `300` | Delay after the latest detected change before reloading; clamped to 50–2000 ms and applied immediately to a pending reload. |
| `extensions.zen-userchrome-hot-reload.watch-nested-directories` | `false` | Also scan nested directories for CSS, respecting the excluded-directory list. |
| `extensions.zen-userchrome-hot-reload.excluded-dirs` | `sine-mods,JS,utils` | Comma-separated directory names to skip while scanning. Leave empty to exclude none. |
| `extensions.zen-userchrome-hot-reload.reload-sine-mods` | `true` | Also trigger `manager.rebuildMods()`. |
| `extensions.zen-userchrome-hot-reload.toast` | `true` | Show a Zen toast after each reload. |
| `extensions.zen-userchrome-hot-reload.hotkey` | `Ctrl+Shift+F5` | Force a reload from any browser window. Single-key shortcuts such as `F5` are supported; `CMD` and `SUPER` are aliases for `META`. Bare printable keys may conflict with browser shortcuts or text entry. Empty disables. |

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

The profile `chrome/userChrome.css` must `@import` the generated file(s). If the generated CSS is in the same directory, prefer relative imports so the setup works across profiles and machines:

```css
@import url("zen-userChrome.css");
@import url("mods/mods.css");
```

Absolute paths also work when the files live elsewhere, but must be adjusted for your own profile and username.

With this mod running, the next `matugen` run re-tints Zen and all open pages live.

## Manual QA

Run this checklist in Zen Browser before a release or after changes to the watcher:

- [ ] Edit a profile chrome CSS file and confirm `userChrome.css` updates without restarting Zen.
- [ ] Edit `userContent.css` and confirm existing tabs update; verify an iframe when available.
- [ ] Verify a cross-origin content iframe is refreshed when eligible; confirm privileged browser UI is excluded and unavailable frames do not prevent other documents from updating.
- [ ] Regenerate or touch an imported `zen-userChrome.css` file and confirm the change triggers a reload.
- [ ] Remove or rename a tracked imported CSS file and confirm the entrypoint reload removes stale imported styles.
- [ ] Replace a tracked CSS file atomically and add/remove files in a watched directory; confirm file metadata changes are detected on the next poll and directory listing changes are found by the periodic revalidation.
- [ ] Open multiple browser windows, close the current watcher-owner window, and confirm reloading continues.
- [ ] Trigger a manual reload with the configured hotkey.
- [ ] Set the hotkey to `F5`, then restore `Ctrl+Shift+F5`; confirm a blank or malformed shortcut disables registration.
- [ ] Disable `userContent.css` reload and confirm no content actors are contacted; disable `userChrome.css` reload and confirm chrome sheets are not touched; restore both defaults.
- [ ] Verify `META`, `CMD`, and `SUPER` modifier spellings trigger the same platform Meta key behavior.
- [ ] Disable hot reload through its preference and confirm changes stop triggering reloads; re-enable it and confirm watching resumes.
- [ ] Change the watch path, nested-directory setting, and excluded-directory list; confirm the next scan uses the new settings without duplicate polling.
- [ ] Change the reload debounce while a reload is pending; confirm the timer is rescheduled once and invalid values fall back safely or clamp to the documented bounds.
- [ ] With nested watching enabled, create a directory symlink back to an ancestor; confirm scanning remains bounded, normal nested CSS is still found, and a warning identifies the skipped path.
- [ ] Configure a missing, unreadable, and non-file/non-directory watch path; confirm one actionable Browser Console error appears and clearing the custom path restores the profile chrome directory.

## Troubleshooting

- **Sine integration unavailable:** CSS watching and stylesheet reloads continue, but Sine-managed mods are not rebuilt. Install or enable Sine, keep `sine.allow-unsafe-js` enabled, then restart Zen or toggle the mod off and on.
- **Sine settings are missing:** confirm `preferences.json` exists in the mod root and reload the mod in Sine. Without that schema, built-in defaults still work but the Sine settings controls are unavailable.
- **Custom watch path unavailable:** the Browser Console identifies the configured path and the underlying error. Clear the `watch-path` preference to return to the profile chrome directory.
- **Invalid stylesheet path or partial content reload:** check the Browser Console for the affected `userChrome.css` / `userContent.css` path and per-frame failure details. Other eligible documents continue to be processed.
- **No eligible content documents:** content refresh is skipped rather than treated as a failure; documents opened later use the current stylesheet.

## Notes / limitations

- Reloads are triggered by mtime polling, matching how `zen-boost-hot-reload` behaves.
- `userContent.css` is refreshed in already-open documents; documents opened **after** a
  change already pick up fresh content from the engine.
- CSS cached inside `@import` chains is re-read when the entrypoint is re-registered +
  `chrome-flush-caches` runs. Addition, modification, removal, and rename of tracked CSS files
  trigger that entrypoint reload; if you hit a stale-import case, regenerate the entrypoint too.

## License

MPL-2.0