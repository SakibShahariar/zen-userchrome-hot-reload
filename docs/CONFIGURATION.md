# Configuration

Sine builds the settings UI from `preferences.json`. Changes are stored in the Zen profile and apply without reinstalling the mod. Preference names use the `extensions.zen-userchrome-hot-reload.` prefix.

| Setting | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable or disable hot reload. |
| `paused` | `false` | Temporarily suspend watching and manual reload actions. |
| `reload-chrome` | `true` | Reload `userChrome.css`. |
| `reload-content` | `true` | Reload `userContent.css` in eligible open documents. |
| `watch-path` | empty | File or directory to watch. Empty uses the profile's `chrome` directory. |
| `poll-interval-ms` | `500` | Poll interval; clamped to 200–5000 ms. Invalid or blank values use 500 ms. |
| `reload-debounce-ms` | `300` | Delay after the latest detected change; clamped to 50–2000 ms. |
| `watch-nested-directories` | `false` | Include nested directories in scans. |
| `excluded-dirs` | `sine-mods,JS,utils` | Comma-separated directory names skipped during nested scans. Use names, not paths. |
| `reload-sine-mods` | `true` | Also call Sine's `manager.rebuildMods()`. |
| `toast` | `true` | Show a Zen toast after reloads when supported. |
| `hotkey` | `Ctrl+Shift+F5` | Manual reload shortcut. `CMD` and `SUPER` alias `META`; empty disables it. |
| `debug-logging` | `false` | Enable local scan, reload, actor, and watcher diagnostics. Logs may include absolute paths. |

## Matugen

Write generated styles into the profile's `chrome` directory and import them from the relevant entrypoint:

```toml
[templates.zen-userchrome]
input_path = './templates/zen-userchrome.css'
output_path = '~/.zen/<profile>/chrome/zen-userChrome.css'

[templates.zen-usercontent]
input_path = './templates/zen-usercontent.css'
output_path = '~/.zen/<profile>/chrome/zen-userContent.css'
```

```css
@import url("zen-userChrome.css");
@import url("mods/mods.css");
```

Adjust paths to match your profile and template locations.

## Behavior and troubleshooting

- The watcher checks for file changes on the configured interval and waits for the debounce period before reloading.
- By default it watches top-level CSS files and `mods/*.css`. Nested scans honor exclusions and stop at a depth limit to avoid unbounded symlink traversal.
- Content refresh targets eligible documents already open when a change occurs. New documents use the current stylesheet on navigation/open.
- Automatic watching and stylesheet reloads depend on privileged Zen/Gecko APIs. Missing APIs are reported in the Browser Console; available manual paths may still work.
- If Sine rebuilding is unavailable, stylesheet reload can continue without it.
- If settings are missing, check that `preferences.json` is present and reload the mod in Sine.
- If styles look stale, verify the entrypoint and its `@import` paths. Browser Console diagnostics may help.
- Debug logs remain local but can contain absolute paths; redact personal directory names before sharing.

See [TESTING.md](TESTING.md) for the manual QA and release checklist.
