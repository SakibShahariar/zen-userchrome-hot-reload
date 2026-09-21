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

## How it works

1. **Watcher** — polls the profile `chrome/` directory (top-level `*.css` +
   `mods/*.css` only; `sine-mods/`, `JS/`, `utils/` are deliberately ignored to avoid
   self-triggering loops). Tracks mtimes via `IOUtils.stat`, default 500ms, debounced 300ms.
2. **Chrome reload** — for every browser window: `windowUtils.removeSheet(uri, USER_SHEET)`
   then `loadSheet(uri, USER_SHEET)` on the profile `userChrome.css`, followed by
   `Services.obs.notifyObservers(null, "chrome-flush-caches")`. Re-evaluating the entrypoint
   re-resolves its `@import`s, so freshly generated colors apply immediately.
3. **Content reload** — the parent inlines the `userContent.css` `@import` chain into a single
   combined sheet at `<mod>/generated/content.css`, then a `UserChromeHotReload` JSWindowActor
   injects it as a `USER_SHEET` into every content window (`DOMWindowCreated` for new documents,
   a `Services.ppmm` broadcast + direct actor messages for open ones). This deliberately bypasses
   Firefox's engine path, because `GlobalStyleSheetCache` parses the profile `userContent.css`
   **once per process** and never re-reads it — so reloading pages or flushing caches cannot
   update it.
4. **Sine engine (optional, default on)** — also calls `window.manager.rebuildMods(true, true)`
   so Sine-managed themes refresh in sync.

## Install

Prerequisites: Sine (bootloader) installed and `sine.allow-unsafe-js` enabled (this mod ships
a userChrome script).

Options:

- **From a GitHub repo**: paste your repo URL in Sine settings → Sine Mods → add custom mod.
- **Local dev**: copy the whole `sine-userchrome-hot-reload` folder into
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

## Scope — what content hot-reload actually touches

`userContent.css` (and the generated `zen-userContent.css` it imports) is **in-content** CSS:
it only styles Firefox's built-in pages (`about:newtab`, `about:settings`, `about:library`,
the download/extension pages, …). It never applies to regular websites, so a wallpaper change
will only visibly re-tint those pages — that is expected.

Rules that target ordinary sites (e.g. via `@-moz-document`) work in legacy
`userContent.css` but are outside this mod's reload path; for per-website theming use
[Zen boosts](https://github.com/zen-browser/zen-boosts) instead.

## Notes / limitations

- Reloads are triggered by mtime polling, matching how `zen-boost-hot-reload` behaves.
- Content is injected as a **user sheet** into every content document (including websites), so
  it can override page styles. In practice `userContent.css` only defines `--in-content-*`
  design tokens, which regular sites ignore — but if you add broad rules there, they will apply
  everywhere.
- The injected sheet is re-added on every change; it does not remove the engine's own cached
  `userContent.css` (which keeps its startup colors). Because both are user sheets, the
  freshly injected one wins on equal specificity.
- Pages opened **before** the mod loaded are refreshed on the next change (the actor is
  instantiated and messaged directly); already-open documents are also refreshed.
- The generated combined sheet lives at
  `chrome/sine-mods/zen-userchrome-hot-reload/generated/content.css` and is safe to delete —
  it is rebuilt automatically.

## License

MPL-2.0