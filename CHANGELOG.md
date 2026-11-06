# Changelog

## [v0.1.0]

Initial release candidate.

### Included

- Sine mod for watching local CSS files and reloading `userChrome.css` and `userContent.css`.
- Multi-window watcher ownership and cleanup.
- Configurable watch roots, nested directories, exclusions, polling, and debounce.
- Optional Sine-managed style rebuilds.
- Manual reload from the Zen app menu and keyboard shortcut.
- Versioned JSON settings export/import.
- Local diagnostics and automated regression tests.

### Known limitations before publication

- Supported Zen versions and OS combinations must be recorded in the compatibility matrix (issue #58); do not claim compatibility until tested.
- File monitoring is polling-based; a supported cross-platform native watcher API has not been established (issue #13).
- Changed imported CSS is refreshed through its owning stylesheet entrypoint to preserve cascade behavior (issue #14).
- Final app-menu, native file-picker, real filesystem, and Sine runtime smoke tests are required before publishing.
