# Release checklist

## Publication gate

Do not create a release tag until all of the following are true:

- [ ] The exact default-branch commit has a successful Validate workflow, including automated tests.
- [ ] The manual checks in [TESTING.md](TESTING.md) have been completed in a real Zen + Sine session.
- [ ] The [compatibility matrix](COMPATIBILITY.md) records tested Zen versions and operating systems; issue [#58](https://github.com/SakibShahariar/zen-userchrome-hot-reload/issues/58) tracks completion.
- [ ] The native watcher limitation (#13), selective stylesheet reload limitation (#14), and other known constraints are accurately described.
- [ ] The changelog section for the release tag is final.
- [ ] The commit CI ledger has no unexplained red or pending checks.

## Preparing a release

1. Update the version section in [CHANGELOG.md](../CHANGELOG.md).
2. Confirm the version uses `vMAJOR.MINOR.PATCH` (the initial proposal is `v0.1.0`).
3. Push the version tag only after the publication gate is complete.
4. The `Draft Release` workflow builds an installable ZIP, verifies its contents, calculates SHA-256, and creates a **draft** GitHub Release.
5. Review the draft, attached ZIP, checksum file, and GitHub-generated source archives. Publish the draft manually only after final review.

The normal Validate workflow builds a disposable `v0.0.0` archive, exercises the actual `v0.1.0` changelog/tag path, and rejects malformed tags on every push. Packaging regressions are therefore caught before a release tag is created.

## Reviewing generated artifacts

After building the candidate archive, inspect and verify it before publishing:

```sh
python3 scripts/package_release.py v0.1.0
cd dist
sha256sum -c SHA256SUMS
python3 -m zipfile -t zen-userchrome-hot-reload-v0.1.0.zip
python3 -m zipfile -l zen-userchrome-hot-reload-v0.1.0.zip
```

The tag workflow creates a draft only. Confirm the ZIP contents, checksum, changelog, and GitHub-generated source archives in the draft before manually publishing it.

## Distribution contents

The installable ZIP contains the userChrome script, content actor, Sine preferences/theme metadata, license, README, changelog, configuration reference, and manual QA checklist. GitHub adds source-code ZIP and tar.gz archives to the release automatically.

## Install, update, and uninstall

- **Install:** In Sine settings, open **Sine Mods → Add custom mod** and paste the repository URL shown in the [README](../README.md).
- **Update:** Refresh the custom mod through Sine, or toggle it off and on if Sine does not fetch the new revision immediately. Follow any restart instruction shown by Sine.
- **Uninstall:** Disable and remove the custom mod through Sine settings. This mod does not own or delete your `userChrome.css`, `userContent.css`, generated theme files, or other watched CSS; remove those separately only if you created them specifically for this mod. If its preferences remain after removal, clear only the `extensions.zen-userchrome-hot-reload.*` preference branch if you want to reset its configuration.

## Known limitations

- File detection uses configurable polling rather than a native OS watcher.
- Imported stylesheet changes are refreshed through the owning `userChrome.css` or `userContent.css` entrypoint to preserve cascade semantics.
- Content refresh is limited to eligible open documents and frames.
- Sine rebuilding depends on the Sine runtime and its configured permissions.
- Supported Zen versions remain unconfirmed until issue #58 has actual test evidence.
