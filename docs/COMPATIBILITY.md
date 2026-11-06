# Zen compatibility matrix

> **Not verified:** No runtime combinations have been tested yet.

This repository's GitHub Actions validate JavaScript syntax, configuration, unit tests, and release packaging. They do **not** prove that a given Zen build, Sine version, or operating system works at runtime.

Do not claim a Zen version or operating system as supported until a real browser session has completed the checks below and the evidence is recorded.

## Current automated CI baseline

- Commit: `136cfb885cbb5818174f5483186e35ecbfbe2b52`
- Validate workflow: [run 42154769191](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/42154769191) — passed.
- Covered: JavaScript syntax, automated Node tests, preferences/theme JSON, installable archive integrity, initial changelog/tag validation, and malformed-tag rejection.
- This is source-level CI evidence only. It does not establish compatibility with any Zen build, Sine version, OS, or live desktop session. Update this baseline after future maintenance commits.

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

## Per-environment evidence template

Duplicate this block for every Zen/OS/Sine combination tested. Do not leave a check blank; use **Not tested** when evidence is unavailable.

```markdown
### Environment: [Zen version/build/channel] on [OS/version/architecture]

- Sine version:
- Tested commit SHA:
- Test date:
- Overall result: Not tested

| Required check | Result (Pass / Fail / Not tested) | Evidence / notes |
|---|---|---|
| Install and activation | Not tested | |
| Preference handling | Not tested | |
| Window lifecycle | Not tested | |
| CSS detection and atomic replacement | Not tested | |
| Chrome stylesheet reload | Not tested | |
| Content stylesheet reload | Not tested | |
| Nested/custom roots and exclusions | Not tested | |
| Sine style rebuild | Not tested | |
| App menu and file picker | Not tested | |
| Disable/uninstall cleanup | Not tested | |
```

Only change the overall result to **Pass** when every required check passes for that exact environment and commit. A failure in one environment does not establish failure in every other environment; record each combination separately.

## Evidence format

For each tested environment, add a row to the matrix with:

- Exact Zen version, build ID, and release channel (from the browser's About/Support information).
- OS name, version, and architecture.
- Sine version and the relevant permission setting.
- Exact tested commit SHA.
- Test date and Pass/Fail result for every required check.
- Console errors, reproduction steps, and relevant screenshots/logs for failures.

A successful CI run is not a substitute for this matrix. Keep untested combinations explicitly marked **Not verified**.


## Support policy

- Claim support only for an exact Zen version/build and OS/architecture represented by a completed environment record with every required check passing.
- The minimum tested Zen version is the lowest version that has passed the full matrix; do not infer support for earlier versions.
- Do not infer support for an untested OS, architecture, Zen channel, or Sine version from a passing result on another combination.
- If a newer Zen release has not been tested, mark it **Not verified** rather than carrying forward the previous version's result.
