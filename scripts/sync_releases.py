#!/usr/bin/env python3
"""Build docs/source.json from published GitHub Releases without a user PAT.

Runs on GitHub Actions using its short-lived built-in GITHUB_TOKEN.
Release workflow: upload one .ipa and optionally one app icon .png per release.
Existing non-release versions and manually edited app metadata are preserved.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import os
import pathlib
import plistlib
import re
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "source.json"
REPO = os.environ.get("GITHUB_REPOSITORY", "zrhtop/ZZS-IPA-Store")
TOKEN = os.environ.get("GH_TOKEN", "")
DEFAULT_ICON = "https://avatars.githubusercontent.com/u/101614537?v=4"
RELEASE_PREFIX = f"https://github.com/{REPO}/releases/download/"
MAX_IPA_BYTES = 1024 * 1024 * 1024
MAX_PLIST_BYTES = 4 * 1024 * 1024
MAIN_INFO = re.compile(r"^Payload/[^/]+\.app/Info\.plist$", re.I)
EXT_INFO = re.compile(r"^Payload/[^/]+\.app/PlugIns/[^/]+\.appex/Info\.plist$", re.I)

def api_json(path: str) -> object:
    if not TOKEN:
        raise RuntimeError("Missing Actions-provided GH_TOKEN.")
    request = urllib.request.Request(
        "https://api.github.com" + path,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + TOKEN,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ZZS-IPA-Store",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)

def releases() -> list[dict]:
    output = []
    for page in range(1, 11):
        batch = api_json(f"/repos/{REPO}/releases?per_page=100&page={page}")
        if not isinstance(batch, list):
            raise RuntimeError("Invalid GitHub Releases response.")
        output.extend(release for release in batch if not release.get("draft"))
        if len(batch) < 100:
            break
    return output

def fetch_ipa(asset: dict) -> pathlib.Path:
    url = str(asset.get("browser_download_url", ""))
    if not url.startswith(RELEASE_PREFIX) or not url.lower().endswith(".ipa"):
        raise ValueError("Asset is not a public IPA release URL from this repository.")
    size = int(asset.get("size", 0))
    if size < 100 or size > MAX_IPA_BYTES:
        raise ValueError(f"IPA file size {size} exceeds the allowed range.")
    tmp = tempfile.NamedTemporaryFile(prefix="zzs-ipa-", suffix=".ipa", delete=False)
    tmp_path = pathlib.Path(tmp.name)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ZZS-IPA-Store"})
        with urllib.request.urlopen(req, timeout=120) as response:
            read_bytes = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                read_bytes += len(chunk)
                if read_bytes > MAX_IPA_BYTES:
                    raise ValueError("IPA download exceeds 1 GiB limit.")
                tmp.write(chunk)
        tmp.close()
        if read_bytes != size:
            raise ValueError(f"IPA size mismatch: API {size}, download {read_bytes}.")
        return tmp_path
    except Exception:
        tmp.close()
        tmp_path.unlink(missing_ok=True)
        raise

def small_plist(archive: zipfile.ZipFile, entry: zipfile.ZipInfo) -> dict:
    if entry.file_size > MAX_PLIST_BYTES:
        raise ValueError(f"Info.plist too large: {entry.filename}")
    with archive.open(entry) as stream:
        blob = stream.read(MAX_PLIST_BYTES + 1)
    if len(blob) > MAX_PLIST_BYTES:
        raise ValueError("Info.plist was too large after decompression.")
    parsed = plistlib.loads(blob)
    if not isinstance(parsed, dict):
        raise ValueError("Info.plist is not a dictionary.")
    return parsed

def ipa_metadata(path: pathlib.Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        main_info = next(
            (entry for entry in archive.infolist() if MAIN_INFO.match(entry.filename)), None
        )
        if main_info is None:
            raise ValueError("Missing Payload/*.app/Info.plist.")
        info = small_plist(archive, main_info)
        bundle = str(info.get("CFBundleIdentifier") or "").strip()
        version = str(info.get("CFBundleShortVersionString") or "").strip()
        build = str(info.get("CFBundleVersion") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+", bundle):
            raise ValueError(f"Invalid IPA Bundle ID: {bundle!r}.")
        if not version or not build:
            raise ValueError("IPA requires CFBundleShortVersionString and CFBundleVersion.")
        privacy: dict[str, str] = {}
        for entry in [main_info, *[
            i for i in archive.infolist() if EXT_INFO.match(i.filename)
        ][:50]]:
            plist = info if entry == main_info else small_plist(archive, entry)
            for key, val in plist.items():
                if key.startswith("NS") and key.endswith("UsageDescription") and isinstance(val, str):
                    privacy[key] = val

        entitlements: set[str] = set()
        for entry in archive.infolist():
            if len(entitlements) >= 100:
                break
            if entry.filename.lower().endswith((".xcent", ".entitlements")):
                try:
                    ent = small_plist(archive, entry)
                    entitlements.update(k for k in ent if k not in {
                        "application-identifier", "com.apple.developer.team-identifier"
                    })
                except (ValueError, plistlib.InvalidFileException, OSError):
                    pass

        name = str(info.get("CFBundleDisplayName") or info.get("CFBundleName") or bundle.split(".")[-1])
        min_os = str(info.get("MinimumOSVersion") or "").strip()
        return {
            "bundleIdentifier": bundle, "name": name,
            "version": version, "buildVersion": build,
            "minOSVersion": min_os,
            "privacy": privacy, "entitlements": sorted(entitlements),
        }

def is_managed_version(version: dict) -> bool:
    url = str(version.get("downloadURL") or "")
    return url.startswith(RELEASE_PREFIX) and ".ipa" in url.lower()

def normalize_date(release: dict) -> str:
    return str(release.get("published_at") or release.get("created_at") or
               dt.datetime.now(dt.timezone.utc).isoformat()).split("T")[0]

def generate(current: dict, published: list[dict]) -> dict:
    current_apps = {
        a["bundleIdentifier"]: a
        for a in current.get("apps", [])
        if isinstance(a, dict) and isinstance(a.get("bundleIdentifier"), str)
    }
    built: dict[str, dict] = {}
    problems: list[str] = []

    # Work oldest -> newest, latest released version ends up at index 0.
    ordered = sorted(
        published,
        key=lambda r: r.get("published_at") or r.get("created_at") or "",
    )
    for rel in ordered:
        assets = [
            a for a in rel.get("assets", [])
            if isinstance(a.get("name"), str) and a["name"].lower().endswith(".ipa")
        ]
        if not assets:
            print(f"Skipping release {rel.get('tag_name')}: no IPA attached.")
            continue
        if len(assets) != 1:
            problems.append(f"Release {rel.get('tag_name')}: attach exactly one IPA.")
            continue
        asset = assets[0]
        try:
            file_path = fetch_ipa(asset)
            try:
                meta = ipa_metadata(file_path)
            finally:
                file_path.unlink(missing_ok=True)
        except (ValueError, OSError, urllib.error.URLError, zipfile.BadZipFile,
                plistlib.InvalidFileException) as error:
            problems.append(f"Release {rel.get('tag_name')}: {error}")
            continue

        bundle = meta["bundleIdentifier"]
        old = current_apps.get(bundle)
        if bundle not in built:
            if old:
                app = dict(old)
            else:
                app = {
                    "name": meta["name"],
                    "bundleIdentifier": bundle,
                    "developerName": "ZZS",
                    "subtitle": "在 ZZS IPA Store 发布",
                    "localizedDescription": str(rel.get("body") or meta["name"]).strip()[:5000] or meta["name"],
                    "iconURL": DEFAULT_ICON,
                    "category": "utilities",
                }
            original_perms = (app.get("appPermissions") or {})
            app["appPermissions"] = {
                # .xcent may be absent even in a signed IPA.
                "entitlements": meta["entitlements"] or original_perms.get("entitlements", []),
                "privacy": meta["privacy"] or original_perms.get("privacy", {}),
            }
            app["versions"] = []
            built[bundle] = app

        app = built[bundle]
        icon_assets = [
            a for a in rel.get("assets", [])
            if str(a.get("name", "")).lower().endswith(".png") and
            "icon" in str(a.get("name", "")).lower()
        ]
        if icon_assets and (
            not old or app.get("iconURL", "") == DEFAULT_ICON
        ):
            app["iconURL"] = str(icon_assets[0]["browser_download_url"])

        change_notes = str(rel.get("body") or "").strip()
        version_info = {
            "version": meta["version"],
            "buildVersion": meta["buildVersion"],
            "date": normalize_date(rel),
            "localizedDescription": change_notes[:5000] or "GitHub Release",
            "downloadURL": asset["browser_download_url"],
            "size": int(asset["size"]),
        }
        if meta["minOSVersion"]:
            version_info["minOSVersion"] = meta["minOSVersion"]
        versions = app["versions"]
        versions[:] = [
            version for version in versions
            if not (version["version"] == version_info["version"]
                    and version["buildVersion"] == version_info["buildVersion"])
        ]
        versions.insert(0, version_info)
        # Newest IPA's privacy permission list (manual entitlements preserved
        # when no .xcent found; always review signed IPA permissions).
        original_perms = (old or {}).get("appPermissions") or {}
        app["appPermissions"] = {
            "entitlements": meta["entitlements"] or original_perms.get("entitlements", []),
            "privacy": meta["privacy"] or original_perms.get("privacy", {}),
        }
        print(f"Detected {meta['name']} ({bundle}) {meta['version']} ({meta['buildVersion']})")

    if problems:
        raise RuntimeError("IPA release import failed:\n" + "\n".join(problems))

    kept: dict[str, dict] = {}
    for bundle, existing in current_apps.items():
        manual = [
            v for v in existing.get("versions", [])
            if isinstance(v, dict) and not is_managed_version(v)
        ]
        if bundle in built:
            known = {
                (v["version"], v["buildVersion"]) for v in built[bundle]["versions"]
            }
            built[bundle]["versions"].extend(
                v for v in manual
                if (v.get("version"), v.get("buildVersion")) not in known
            )
        elif manual or not existing.get("versions"):
            # Preserve apps managed directly by hand; drop apps whose only
            # historical versions were removed GitHub Releases.
            kept[bundle] = existing

    # Prioritize apps published through this repository's own Releases.
    # Newer releases go first; imported/manual entries keep their order.
    release_apps = sorted(
        built.values(),
        key=lambda app: (
            str(app["versions"][0].get("date") or ""),
            app["bundleIdentifier"],
        ),
        reverse=True,
    )
    ordered_apps = release_apps + [
        kept[bundle] for bundle in current_apps if bundle in kept
    ]

    output = dict(current)
    output["apps"] = ordered_apps
    output.setdefault("news", [])
    return output

def main() -> None:
    if not SOURCE.is_file():
        raise RuntimeError("docs/source.json is missing.")
    current = json.loads(SOURCE.read_text(encoding="utf-8"))
    published = releases()
    updated = generate(current, published)
    new_text = json.dumps(updated, ensure_ascii=False, indent=2) + "\n"
    if SOURCE.read_text(encoding="utf-8") != new_text:
        SOURCE.write_text(new_text, encoding="utf-8")
        print(f"Updated source: {len(updated['apps'])} apps.")
    else:
        print(f"No changes: {len(updated['apps'])} apps.")

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)
