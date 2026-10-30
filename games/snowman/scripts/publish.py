#!/usr/bin/env python3
"""Publish only the verified build, then use the store's existing sync path."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

GAME_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = GAME_ROOT.parents[1]
REPOSITORY = "zrhtop/ZZS-IPA-Store"
BUNDLE_ID = "jp.zrh.snowmanchristmas"


def command(*args: str) -> str:
    result = subprocess.run(args, cwd=REPO_ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)
    return result.stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("delivery", type=Path)
    args = parser.parse_args()
    delivery = args.delivery.resolve()
    if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY or os.environ.get("GITHUB_REF") != "refs/heads/main":
        raise RuntimeError("Publishing is restricted to this repository's main workflow")
    commit = os.environ.get("SNOWMAN_BUILD_SHA", "")
    if len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit):
        raise RuntimeError("Missing exact build source commit")
    ipa_files = list(delivery.glob("*.ipa"))
    if len(ipa_files) != 1:
        raise RuntimeError("The verified delivery must contain exactly one IPA")
    ipa = ipa_files[0]
    spec = importlib.util.spec_from_file_location("snowman_validate_ipa", GAME_ROOT / "scripts/validate_ipa.py")
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    actual = validator.inspect(ipa)
    recorded = json.loads((delivery / "ipa-metadata.json").read_text())
    if actual != recorded:
        raise RuntimeError("IPA bytes or metadata changed after validation")
    smoke_path = delivery / "simulator-smoke-result.json"
    if smoke_path.is_file():
        smoke = json.loads(smoke_path.read_text())
        if smoke.get("success") is not True or smoke.get("diagnostics", {}).get("gameLoaded") is not True:
            raise RuntimeError("The optional simulator check reported a failure")
    elif not (delivery / "verification-scope.json").is_file():
        raise RuntimeError("Missing validation scope record")
    metadata = json.loads((GAME_ROOT / "release-metadata.json").read_text())
    required = ["developerName", "localizedDescription", "subtitle", "category"]
    if any(not isinstance(metadata.get(key), str) or not metadata[key].strip() for key in required):
        raise RuntimeError("Verified author and app description metadata are required")
    icon = delivery / "snowman-icon.png"
    if not icon.is_file() or icon.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError("Missing PNG release icon")
    command("python3", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v")
    tag = f"{BUNDLE_ID}-v{actual['version']}-b{actual['buildVersion']}"
    url = f"https://github.com/{REPOSITORY}/releases/download/{tag}/{ipa.name}"
    release_name = f"圣诞雪球人 {actual['version']} ({actual['buildVersion']})"
    notes = metadata["localizedDescription"] + "\n\n" + metadata.get("releaseNotes", "首个 iOS 版本。")
    notes += "\n\n安装方式：在 AltStore Classic 中添加 https://repo.zrh.jp/source.json 并重签安装。IPA 未使用开发者证书预签。\n"
    notes += f"\n源代码提交：{commit}\nIPA SHA-256：{actual['sha256']}\n"
    # An interrupted attempt may be resumed only when all uploaded bytes match.
    # A release containing a different IPA or icon is never replaced.
    existing = subprocess.run(["gh", "api", f"repos/{REPOSITORY}/releases/tags/{tag}"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if existing.returncode == 0:
        release = json.loads(existing.stdout)
        names = {asset["name"] for asset in release.get("assets", [])}
        if names != {ipa.name, icon.name}:
            raise RuntimeError(f"Existing release {tag} has unexpected assets; no files were replaced")
        with tempfile.TemporaryDirectory(prefix="snowman-existing-release-") as tmp:
            command("gh", "release", "download", tag, "--repo", REPOSITORY, "--dir", tmp)
            for original in [ipa, icon]:
                if (Path(tmp) / original.name).read_bytes() != original.read_bytes():
                    raise RuntimeError(f"Existing release {tag} contains different {original.name} bytes")
        if release.get("draft"):
            command("gh", "release", "edit", tag, "--repo", REPOSITORY, "--draft=false", "--latest=false")
    else:
        if "404" not in existing.stderr:
            raise RuntimeError("Could not establish whether the release already exists")
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", encoding="utf-8") as body:
            body.write(notes)
            body.flush()
            command("gh", "release", "create", tag, str(ipa), str(icon), "--repo", REPOSITORY, "--target", commit, "--title", release_name, "--notes-file", body.name, "--draft")
        command("gh", "release", "edit", tag, "--repo", REPOSITORY, "--draft=false", "--latest=false")

    # A GITHUB_TOKEN-created release does not recursively start other workflows.
    # First sync with the repository's existing parser, then correct only this
    # app's display metadata so the generic ZZS author is not published.
    command("git", "pull", "--ff-only", "origin", "main")
    command("python3", "scripts/sync_releases.py")
    source_path = REPO_ROOT / "docs/source.json"
    source = json.loads(source_path.read_text())
    matches = [app for app in source["apps"] if app.get("bundleIdentifier") == BUNDLE_ID]
    if len(matches) != 1:
        raise RuntimeError("Release sync did not produce exactly one Snowman application")
    app = matches[0]
    latest = app["versions"][0]
    if (latest["version"], latest["buildVersion"], latest["downloadURL"], latest["size"]) != (actual["version"], actual["buildVersion"], url, actual["size"]):
        raise RuntimeError("Synchronized source metadata does not match the real IPA")
    app.update({key: metadata[key] for key in required})
    app["name"] = actual["name"]
    app["iconURL"] = f"https://github.com/{REPOSITORY}/releases/download/{tag}/{icon.name}"
    source_path.write_text(json.dumps(source, ensure_ascii=False, indent=2) + "\n")
    command("python3", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v")
    command("git", "config", "user.name", "github-actions[bot]")
    command("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    command("git", "add", "docs/source.json")
    changes = command("git", "diff", "--cached", "--name-only")
    if changes:
        if changes != "docs/source.json":
            raise RuntimeError("Unexpected staged paths during source publication")
        command("git", "commit", "-m", f"Publish Christmas Snowman {actual['version']} ({actual['buildVersion']}) [skip ci]")
        command("git", "push", "origin", "HEAD:main")
    try:
        command("gh", "workflow", "run", "publish.yml", "--repo", REPOSITORY, "--ref", "main")
    except subprocess.CalledProcessError as error:
        # The release and source commit are already complete. Preserve both;
        # recover through the existing workflow rather than replacing the IPA
        # or introducing a PAT or broader permissions.
        raise RuntimeError(
            "The IPA release and source.json update completed, but Pages dispatch failed. "
            "Run the existing Publish ZZS IPA Store workflow on main at "
            "https://github.com/zrhtop/ZZS-IPA-Store/actions/workflows/publish.yml . "
            "Do not replace release assets or broaden token permissions."
        ) from error
    print(json.dumps({"releaseURL": f"https://github.com/{REPOSITORY}/releases/tag/{tag}", "downloadURL": url, "sourceURL": "https://repo.zrh.jp/source.json", "sha256": actual["sha256"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
