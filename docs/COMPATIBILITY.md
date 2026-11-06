# Zen compatibility matrix

<badge color="warning">No runtime combinations verified yet</badge>

This repository's GitHub Actions validate JavaScript syntax, configuration, unit tests, and release packaging. They do **not** prove that a given Zen build, Sine version, or operating system works at runtime.

Do not claim a Zen version or operating system as supported until a real browser session has completed the checks below and the evidence is recorded.

## Environment record

| Zen version / build / channel | OS version / architecture | Sine version | Test date | Tested commit | Result |
|---|---|---|---|---|---|
| Not yet tested | Not yet tested | Not yet tested | — | — | Not verified |

## Required checks for each environment

Record Pass, Fail, or Not tested for each item. A row is considered verified only when all required items pass.

| Check | What to exercise |
|---|---|
| Install and activation | Install as a Sine custom mod; confirm startup without console errors. |
| Preference handling | Confirm required Sine preference and all mod settings load correctly. |
| Window lifecycle | Open multiple windows, close the owner, and confirm watcher handoff and cleanup. |
| CSS detection | Change, rename, and atomically replace a watched CSS file; confirm changes are detected. |
| Chrome stylesheet reload | Verify the correct `userChrome.css` dependency graph reloads. |
| Content stylesheet reload | Verify eligible open documents and frames refresh correctly. |
| Nested/custom roots | Verify absolute custom roots, nested-directory preference, exclusions, and invalid-path fallback. |
| Sine rebuild | Change a declared enabled Sine stylesheet and confirm style rebuilding without unintended mod-script reload. |
| App-menu actions | Verify manual reload, settings export/import, native file-picker flows, cancellation, and confirmation. |
| Disable/uninstall | Disable or remove the mod; confirm timers, observers, menu items, and window references are cleaned up. |

## Evidence format

For each tested environment, add a row to the matrix with:

- Exact Zen version, build ID, and release channel (from the browser's About/Support information).
- OS name, version, and architecture.
- Sine version and the relevant permission setting.
- Exact tested commit SHA.
- Test date and Pass/Fail result for every required check.
- Console errors, reproduction steps, and relevant screenshots/logs for failures.

A successful CI run is not a substitute for this matrix. Keep untested combinations explicitly marked **Not verified**.
