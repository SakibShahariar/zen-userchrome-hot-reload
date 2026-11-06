#!/usr/bin/env python3
"""Build and verify the installable ZIP attached to a tagged GitHub release."""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "userchrome-hot-reload.uc.js",
    "hot-reload-content.sys.mjs",
    "preferences.json",
    "theme.json",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "docs/CONFIGURATION.md",
    "docs/TESTING.md",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tag", help="Semantic version tag, e.g. v0.1.0")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Build a test archive without requiring a matching changelog section",
    )
    args = parser.parse_args()

    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", args.tag):
        parser.error("tag must use vMAJOR.MINOR.PATCH format")

    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    if not args.check and not re.search(
        rf"^## \[{re.escape(args.tag)}\]$", changelog, re.MULTILINE
    ):
        parser.error(f"CHANGELOG.md has no section for {args.tag}")

    missing = [name for name in FILES if not (ROOT / name).is_file()]
    if missing:
        parser.error("missing release files: " + ", ".join(missing))

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    archive = dist / f"zen-userchrome-hot-reload-{args.tag}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in FILES:
            bundle.write(ROOT / name, arcname=name)

    with zipfile.ZipFile(archive) as bundle:
        corrupt_member = bundle.testzip()
        if corrupt_member is not None:
            raise RuntimeError(f"archive verification failed at {corrupt_member}")

    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (dist / "SHA256SUMS").write_text(
        f"{digest}  {archive.name}\n", encoding="utf-8"
    )
    print(f"Created {archive.relative_to(ROOT)}")
    print(f"SHA-256 {digest}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, zipfile.BadZipFile) as error:
        print(f"release packaging failed: {error}", file=sys.stderr)
        raise SystemExit(1)
