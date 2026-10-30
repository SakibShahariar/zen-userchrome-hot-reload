# Testing and release checklist

Run these checks in Zen Browser before a release or after changes to the watcher. Automated or function-level tests do not replace checks against a real Zen session.

## Stylesheet reload

- [ ] Edit a profile chrome CSS file and confirm `userChrome.css` updates without restarting Zen.
- [ ] Edit `userContent.css` and confirm existing tabs update; verify an iframe when available.
- [ ] Verify a cross-origin content iframe is refreshed when eligible; confirm privileged browser UI is excluded and unavailable frames do not prevent other documents from updating.
- [ ] Regenerate or touch an imported `zen-userChrome.css` file and confirm the change triggers a reload.
- [ ] Remove or rename a tracked imported CSS file and confirm the entrypoint reload removes stale imported styles.
- [ ] Replace a tracked CSS file atomically and add/remove files in a watched directory; confirm file metadata changes are detected on the next poll and directory listing changes are found by periodic revalidation.

## Watcher lifecycle and controls

- [ ] Open multiple browser windows, close the current watcher-owner window, and confirm reloading continues.
- [ ] Trigger a manual reload with the configured hotkey.
- [ ] Trigger a manual reload from the Zen application menu; confirm it respects the independent stylesheet toggles and does not create a second poller.
- [ ] Check the app-menu status label and tooltip in active, handed-off, paused, disabled, and unavailable states; confirm path, poll interval, and last reload time/result update after configuration changes and reloads.
- [ ] Pause watching, confirm polling and hotkey/menu reloads stop, then resume; verify the prior scan state returns and only one poller runs across open windows.
- [ ] While paused, close the watcher-owner window and open another; confirm paused state transfers and resume starts only one watcher.
- [ ] Disable hot reload through its preference and confirm changes stop triggering reloads; re-enable it and confirm watching resumes.
- [ ] Change the watch path, nested-directory setting, and excluded-directory list; confirm the next scan uses the new settings without duplicate polling.

## Preferences and diagnostics

- [ ] Set the hotkey to `F5`, then restore `Ctrl+Shift+F5`; confirm a blank or malformed shortcut disables registration.
- [ ] Disable `userContent.css` reload and confirm no content actors are contacted; disable `userChrome.css` reload and confirm chrome sheets are not touched; restore both defaults.
- [ ] Enable debug logging, add/change/remove CSS files, and confirm the Browser Console reports action and path for up to 20 files plus an omitted count; disable it and confirm normal scans stay quiet.
- [ ] Verify `META`, `CMD`, and `SUPER` modifier spellings trigger the same platform Meta key behavior.
- [ ] Change the reload debounce while a reload is pending; confirm the timer is rescheduled once and invalid values fall back safely or clamp to the documented bounds.
- [ ] Try blank, non-numeric, below-range, and above-range poll/debounce values; verify documented defaults and clamps. Try malformed hotkeys and exclusion paths; confirm clear warnings and valid legacy values still work.

## Filesystem and failure handling

- [ ] With nested watching enabled, create a directory symlink back to an ancestor; confirm scanning remains bounded, normal nested CSS is still found, and a warning identifies the skipped path.
- [ ] Simulate or reproduce a chrome stylesheet load failure in one browser window; confirm a partial failure is reported even if another window reloads successfully. Check the Browser Console for CSS parser diagnostics.
- [ ] Configure a missing, unreadable, and non-file/non-directory watch path; confirm one actionable Browser Console error appears and clearing the custom path restores the profile chrome directory.
- [ ] Try malformed exclusion paths; confirm invalid path segments are ignored with a warning.

## Release notes

- Review the [README](../README.md) for user-facing setup and preference documentation.
- Record which checks require a real Zen session; do not report those as passed when they were not run.
