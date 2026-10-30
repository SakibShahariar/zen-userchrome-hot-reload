# Zen UserChrome & Content Hot Reload

[![Sine mod](https://img.shields.io/badge/Sine-mod-5865F2)](https://github.com/CosmoCreeper/Sine)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-blue.svg)](LICENSE)

**Live-reload Zen Browser stylesheets as you edit them.** This Sine mod watches your profile's CSS and refreshes `userChrome.css` and `userContent.css` without restarting the browser.

It is especially useful with [Matugen](https://github.com/InioX/matugen), pywal, or scripts that regenerate theme files when your wallpaper or color scheme changes.

## Features

- **Automatic CSS watching** — monitors top-level `*.css` files and `mods/*.css`; optional nested-directory scanning is available.
- **Chrome and content refresh** — reloads browser UI styles and refreshes eligible documents in already-open tabs.
- **Multi-window support** — one window owns the watcher; ownership transfers when that window closes.
- **Manual reload** — use the Zen application menu or the configurable keyboard shortcut.
- **Optional Sine integration** — rebuilds Sine-managed mods alongside stylesheet reloads.
- **Configurable and local** — tune paths, polling, debounce, reload scopes, exclusions, notifications, and diagnostics. The mod sends no telemetry.

## Requirements

- [Zen Browser](https://zen-browser.app/)
- [Sine](https://github.com/CosmoCreeper/Sine) installed
- `sine.allow-unsafe-js` enabled, because this mod uses a userChrome script

## Install

1. Open **Sine settings → Sine Mods**.
2. Choose the option to add a custom mod.
3. Paste this repository URL: `https://github.com/SakibShahariar/zen-userchrome-hot-reload`.
4. Add or enable the mod, then restart Zen once (or toggle the mod off and on).

To install a local development copy, place this repository in:

```text
~/.zen/<profile>/chrome/sine-mods/zen-userchrome-hot-reload/
```

Then add a `zen-userchrome-hot-reload` entry to `chrome/sine-mods/mods.json`, using the `zen-boost-hot-reload` entry as a template. Disable the mod in Sine settings whenever you do not want it watching files.

## Use it

Edit or regenerate a tracked CSS file. After the configured polling and debounce delays, the mod reloads the selected stylesheets in open windows and eligible content documents.

For an immediate refresh, use **Reload stylesheets now** in Zen's application menu or press the configured hotkey (default: `Ctrl+Shift+F5`). The menu item reports whether watching is active, handed off, paused, disabled, or unavailable. Its tooltip includes the effective watch path, poll interval, reload scopes, debounce, and last reload result. If the application menu is unavailable in a Zen build, use the hotkey.

## Configuration

Sine generates the settings UI from `preferences.json`. Changes are stored in the profile preferences and apply without reinstalling the mod. The pause setting is independent of the main enable switch.

| Setting | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable or disable hot reload in this profile. |
| `paused` | `false` | Temporarily suspend polling and manual reload actions without disabling the mod. |
| `reload-chrome` | `true` | Reload `userChrome.css`; turn off for content-only workflows. |
| `reload-content` | `true` | Reload `userContent.css`; turn off for chrome-only workflows. |
| `watch-path` | empty | Custom file or directory to watch. Empty uses the profile's `chrome` directory. Invalid or unreadable paths are reported in the Browser Console. |
| `poll-interval-ms` | `500` | Poll interval in milliseconds, clamped to 200–5000. Blank or invalid values use 500. |
| `reload-debounce-ms` | `300` | Wait after the latest detected change before reloading; clamped to 50–2000 ms. |
| `watch-nested-directories` | `false` | Also scan nested directories for CSS files. |
| `excluded-dirs` | `sine-mods,JS,utils` | Comma-separated directory names to skip during nested scans. Invalid path segments are ignored with a warning; empty excludes none. |
| `reload-sine-mods` | `true` | Also call Sine's `manager.rebuildMods()`. |
| `toast` | `true` | Show a Zen toast after each reload. |
| `hotkey` | `Ctrl+Shift+F5` | Reload from any browser window. Single-key shortcuts such as `F5` are supported; `CMD` and `SUPER` alias `META`. Empty disables the shortcut. |
| `debug-logging` | `false` | Opt-in local scan, changed-file, reload, actor, and watcher-handoff diagnostics. Logs can include absolute paths. |

Preference names use the `extensions.zen-userchrome-hot-reload.` prefix. Bare printable hotkey keys may conflict with browser shortcuts or text entry.

## Matugen setup

Add templates that write generated styles into your Zen profile's `chrome` directory:

```toml
[templates.zen-userchrome]
input_path = './templates/zen-userchrome.css'
output_path = '~/.zen/<profile>/chrome/zen-userChrome.css'

[templates.zen-usercontent]
input_path = './templates/zen-usercontent.css'
output_path = '~/.zen/<profile>/chrome/zen-userContent.css'
```

Import the generated files from the profile entrypoints. For files in the same directory, relative imports work across profiles and machines:

```css
@import url("zen-userChrome.css");
@import url("mods/mods.css");
```

Adjust absolute paths if your generated files live elsewhere. Once configured, the next Matugen run refreshes Zen and eligible open pages.

## Compatibility and behavior

This mod targets Zen Browser's privileged chrome environment and feature-detects required APIs at startup rather than pinning a numeric minimum version.

- **Watching** uses `IOUtils.stat`, `IOUtils.getChildren`, `PathUtils.join/filename`, and relevant `Services.prefs` / `Services.wm` APIs. If unavailable, automatic polling is disabled while available manual reload paths remain usable.
- **Chrome stylesheets** require `PathUtils.toFileURI`, `Services.io.newURI`, `Services.obs.notifyObservers`, and per-window `windowUtils.loadSheet` support.
- **Content stylesheets** use a `JSWindowActor` registered for content contexts and all frames. Eligible cross-origin frames can be refreshed; browser-chrome UI is deliberately excluded. Navigating, closing, privileged, or otherwise ineligible documents may be skipped.
- **Sine integration and Zen toasts** are optional. CSS reload remains available without Sine; status falls back to the Browser Console if the toast API is unavailable.

The watcher polls for file changes (default 500 ms) and debounces reloads (default 300 ms). It watches top-level CSS and `mods/*.css` by default. Nested scans respect the excluded-directory list, skip repeated directory paths, and stop beyond 64 directory levels to bound symlink cycles. Cached directory listings are revalidated at least every 10 seconds.

Content refresh applies to eligible documents already open when a change occurs. New documents use the current stylesheet when they open. Partial actor failures are counted and reported; successful documents continue to refresh. If no eligible content documents exist, content refresh is reported as skipped. CSS parser diagnostics may appear separately in the Browser Console.

Other Gecko-based browsers are not guaranteed to provide Zen- or Sine-specific integrations.

## Troubleshooting

- **No automatic reload:** check that the mod is enabled and not paused, and that the watch path exists and is readable. Clear `watch-path` to return to the profile's `chrome` directory.
- **Sine integration unavailable:** stylesheet watching and reloads can continue, but Sine-managed mods will not rebuild. Install or enable Sine, keep `sine.allow-unsafe-js` enabled, then restart Zen or toggle the mod off and on.
- **Settings are missing:** confirm `preferences.json` is present in the mod root and reload the mod in Sine. Built-in defaults still work without the settings schema.
- **Content reload is partial or skipped:** inspect the Browser Console for actor lookup warnings, failed-document counts, and ineligible contexts. Other eligible documents continue to be processed.
- **Styles look stale:** check the CSS entrypoint and its `@import` paths. Re-registering the entrypoint and flushing chrome caches re-reads its import chain; regenerating the entrypoint can help with unusual stale-import cases.
- **Sharing debug logs:** diagnostics stay in the local Browser Console and may contain absolute file paths. Redact personal directory names before sharing. The mod sends no telemetry.

## Testing

The detailed [manual QA and release checklist](docs/TESTING.md) covers stylesheet refresh, multi-window handoff, preferences, filesystem edge cases, and failure handling. Checks that require a live Zen session must be run in Zen; function-level tests alone do not verify browser integration.

## License

[MPL-2.0](LICENSE)
