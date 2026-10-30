# Zen UserChrome & Content Hot Reload

[![Sine mod](https://img.shields.io/badge/Sine-mod-5865F2)](https://github.com/CosmoCreeper/Sine)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-blue.svg)](LICENSE)

**Automatically reload Zen Browser stylesheets while you edit them.** This Sine mod watches CSS files in your profile and refreshes `userChrome.css` and `userContent.css` without restarting Zen.

Useful with [Matugen](https://github.com/InioX/matugen), pywal, and scripts that generate browser themes.

## Features

- Automatic CSS watching with configurable polling and debounce.
- Refresh browser UI styles and eligible open content documents.
- Multi-window watcher handoff.
- Manual reload from the app menu or keyboard shortcut.
- Optional Sine mod rebuild and local diagnostics.
- No telemetry.

## Requirements

- [Zen Browser](https://zen-browser.app/)
- [Sine](https://github.com/CosmoCreeper/Sine)
- `sine.allow-unsafe-js` enabled.

## Install

1. Open **Sine settings → Sine Mods** and choose **Add custom mod**.
2. Copy and paste this repository URL:

   ```text
   https://github.com/SakibShahariar/zen-userchrome-hot-reload
   ```
3. Enable the mod, then restart Zen once (or toggle the mod off and on).

## Use

Edit or regenerate a tracked CSS file. The mod detects the change and reloads the enabled stylesheets after the configured debounce delay.

For an immediate refresh, choose **Reload stylesheets now** from Zen's app menu or press `Ctrl+Shift+F5` (default).

## Settings

Sine provides the settings UI from `preferences.json`. The main options are:

- **Watch path:** choose a file or directory; empty uses the profile's `chrome` directory.
- **Reload scopes:** independently enable `userChrome.css`, `userContent.css`, and Sine mod rebuilding.
- **Polling and debounce:** control detection frequency and reload delay.
- **Nested directories:** optionally scan deeper folders and exclude selected directory names.
- **Hotkey, toast, and debug logging:** customize manual reload and diagnostics.

See the [configuration reference](docs/CONFIGURATION.md) for every setting and Matugen examples.

## Compatibility

This mod uses privileged Zen APIs and is not guaranteed to work in other Gecko-based browsers. Content refresh is limited to eligible documents; browser-chrome UI and some privileged or transient documents are excluded. Missing API support is reported in the Browser Console.

## Help and testing

If reloads do not work, check that the mod is enabled and not paused, confirm the watch path exists, and inspect the Browser Console. Debug logs may contain absolute paths.

The [manual QA checklist](docs/TESTING.md) documents browser-level tests that require a live Zen session.

## License

[MPL-2.0](LICENSE)
