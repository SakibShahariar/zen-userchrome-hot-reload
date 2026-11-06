# Commit CI Audit Ledger

Persistent repository-specific record of commit-level CI checks and red-cross investigations.

## How to use this ledger

1. Read this file before auditing commit checks.
2. Check only commits newer than the checkpoint, plus older **red**, **pending**, or explicitly unresolved entries.
3. Record exact commit SHAs and observed results; never infer from missing badges or empty API responses.
4. Preserve failures and append diagnosis, fix, rerun, and final-outcome evidence.
5. Advance the checkpoint only after reviewing the range; carry unresolved entries forward.

## Result meanings

| Result | Meaning |
|---|---|
| **green** | Completed successful check/run directly observed. |
| **red** | Completed failing check/run directly observed. |
| **pending** | Check/run exists but is unfinished. |
| **unavailable** | Available evidence did not expose a result; not a pass or failure. |
| **not applicable** | Workflow configuration confirms no relevant check is triggered. |

## Checkpoint

- Repository: `SakibShahariar/zen-userchrome-hot-reload`
- Default branch: `main`
- Last fully reviewed checkpoint: `5ca3087526078cbd24a1bcd5082885a906534f2f`
- Review date: 2026-11-06
- Reviewed 14 commits after the previous checkpoint `312c162504603e6de79417f937d3f7639a586ef0`, plus four older owner-identified commits that needed explicit verification.
- Combined status endpoint returned empty status lists; authoritative workflow runs were checked directly by exact commit SHA.
- The next commit after this checkpoint is the current test/ledger commit; its own CI must be checked before advancing the checkpoint again.

## Verified commit results

| Commit SHA | Subject | CI result | Workflow run | Notes |
|---|---|---|---|---|
| `26e87acfa95243c7914fb2a1dc7046209fac867e` | fix: isolate chrome reload failures per window (#19) | green | [40223275233](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/40223275233) | no automated-test step |
| `c7c6a304abd17ff42c379a85dc383a22732dda6d` | fix: isolate tab teardown during content reload (#25) | green | [40223474172](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/40223474172) | no automated-test step |
| `90183f01f2e7daf1f0a67f6134789980c0ace8fc` | fix: isolate chrome cache flush failures (#19) | green | [40223606710](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/40223606710) | no automated-test step |
| `cbcc39c17531446bc73c566259541db6253d0927` | fix: stop on browser window enumeration errors (#19) | green | [40223724884](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/40223724884) | no automated-test step |
| `95923eddde34cdf07b945314059f091d3eb6f3ea` | docs: add AI agent instructions | green | [41300314048](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/41300314048) | automated tests included |
| `c33bb5cc881d3eb385484526d9516cf95740c5e8` | docs(agents): require verified issue checklists | green | [41325704646](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/41325704646) | automated tests included |
| `312c162504603e6de79417f937d3f7639a586ef0` | docs: improve maintenance workflow guidance | green | [41400975926](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/41400975926) | automated tests included; previous checkpoint |
| `70c7ad6e40ee1c8a6f6c3ea5624f5be6158b09eb` | docs: add persistent commit CI audit ledger | green | [41456778622](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/41456778622) | automated tests included |
| `d6f9eaa9ba2e6bcf2404ab73fd46110363d0de90` | docs: document incremental commit CI auditing | green | [41456784498](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/41456784498) | automated tests included |
| `6c379a5a1a94fd892ae2157cbaea639e4f131086` | docs: define issue triage categories | green | [41573506863](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/41573506863) | automated tests included |
| `d96c05225e093a67785827e49b762cf0972853f5` | docs(agents): define administrative commit hygiene | green | [41597881252](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/41597881252) | automated tests included |
| `e37c9b90cee6f273d0c8c8f67236ecc02af99dcf` | docs(agents): clarify acceptance criteria evidence | green | [41864290626](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/41864290626) | automated tests included |
| `388792c32c1db645f4faacec1f51ae4088b82514` | test: cover CSS directory cache revalidation (#28) | green | [42152306341](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/42152306341) | automated tests included |
| `dd4c7e836e5b7fb18afe62491f8ca4b241071f96` | test: cover watch-root security boundaries (#56) | green | [42152568780](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/42152568780) | automated tests included |
| `2b4b428c8845691f40742ceda09cdf5e95005ad0` | docs: document watch-root security boundaries (#56) | green | [42152575098](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/42152575098) | automated tests included |
| `fce411d6a475159c9223439fbbd36a67222bf5a2` | test: verify directory cache on large CSS trees (#28) | green | [42152776217](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/42152776217) | automated tests included |
| `2c9f6c66bd07c523cb73e44ed08af82514cbdf28` | feat: add versioned settings import and export (#50) | red | [42153165387](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/42153165387) | syntax check failed |
| `bdbd417fcdcbc37dc4e734858c47cb26585d78bb` | fix: keep settings actions in module scope (#50) | red | [42153196440](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/42153196440) | automated tests failed |
| `5ca3087526078cbd24a1bcd5082885a906534f2f` | fix: validate imported setting values strictly (#50) | green | [42153273243](https://github.com/SakibShahariar/zen-userchrome-hot-reload/actions/runs/42153273243) | automated tests included |

## Red-cross investigation log

### 2026-11-06 — settings import/export work (#50)

- Commit `2c9f6c66bd07c523cb73e44ed08af82514cbdf28`: **red**. The `Check userChrome script syntax` step failed with `SyntaxError: Unexpected token ')'` at the IIFE close. Cause: an extra opening `function setupReloadMenuItem()` was inserted before the settings helper functions, leaving the outer function unclosed.
- Corrective commit `bdbd417fcdcbc37dc4e734858c47cb26585d78bb`: syntax checks passed, but **automated tests failed**. The `settings import applies only included known preferences` test expected `900` but retained `500`; cause: the numeric validation regex was over-escaped and rejected digit strings.
- Corrective commit `5ca3087526078cbd24a1bcd5082885a906534f2f`: fixed the regex and hardened malformed watch-path array validation. Exact workflow run `42153273243` completed **success**, including syntax, content actor, automated tests, preferences JSON, and theme JSON checks.
- Classification: both failures were code defects introduced during this feature, not infrastructure failures. Published history is preserved; no amend or force-push performed.

## Remaining verification

- Settings import/export (#50): live Zen app-menu/file-picker smoke test remains; CI validates the mocked workflow only.
- Cache invalidation (#28): real filesystem replacement behavior and target-environment smoke test remain.
- Watch-root security (#56): actual symlink/junction behavior and Sine runtime implications remain.
- Native watcher (#13): Category E owner decision pending.
- Per-import stylesheet reload (#14): Category D upstream/runtime capability blocker.
- Compatibility matrix (#58): Category C requires actual supported Zen builds.

## Session history

| Date | Reviewed range / checkpoint | Result summary |
|---|---|---|
| 2026-11-02 | Initial checkpoint `312c162504603e6de79417f937d3f7639a586ef0` | Combined status lookup returned no entries; later direct workflow lookup established the actual results. |
| 2026-11-06 | Previous checkpoint `312c162504603e6de79417f937d3f7639a586ef0` through `5ca3087526078cbd24a1bcd5082885a906534f2f`, plus four older owner-identified commits | 19 commits checked: 17 green, 2 red. Both failures were diagnosed and corrected by a later green commit. |
