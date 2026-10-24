#!/usr/bin/env python3
"""Import app entries from a permitted AltStore Classic JSON or JSON5 source.

This script only imports public metadata + external IPA HTTPS links.
It does NOT download, copy, mirror, sign or rehost third-party IPA binaries.
Use GitHub Actions workflow_dispatch with GITHUB_TOKEN; no user PAT needed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import os
import pathlib
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_FILE = ROOT / "docs" / "source.json"
MAX_SOURCE_BYTES = 6 * 1024 * 1024
MAX_APPS = 150
MAX_VERSIONS_PER_APP = 60
ALLOWED_CATEGORIES = {
    "developer", "entertainment", "games", "lifestyle",
    "other", "photo-video", "social", "utilities",
}
BUNDLE_PATTERN = re.compile(r"^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$")
HEX_COLOR_PATTERN = re.compile(r"^#?[0-9a-fA-F]{6}$")


def valid_https(url: object, *, public: bool = True) -> str:
    if not isinstance(url, str) or len(url) > 2048:
        raise ValueError("URL 必须是 2048 字符以内的 HTTPS 地址")
    parsed = urllib.parse.urlsplit(url.strip())
    if (
        parsed.scheme.lower() != "https" or not parsed.hostname
        or parsed.username or parsed.password or parsed.fragment
        or parsed.port not in (None, 443)
    ):
        raise ValueError("必须使用无用户名、密码、特殊端口或片段的 HTTPS URL")
    host = parsed.hostname.lower().strip(".")
    if (
        len(host) > 253 or "." not in host
        or host.endswith((".localhost", ".local", ".internal", ".test"))
        or host in ("localhost", "metadata.google.internal")
    ):
        raise ValueError("不能访问本地域名或保留域名")
    if public:
        try:
            direct_ip = ipaddress.ip_address(host.strip("[]"))
        except ValueError:
            direct_ip = None
        if direct_ip is not None and not direct_ip.is_global:
            raise ValueError("不允许私有、环回或保留 IP 地址")
    return urllib.parse.urlunsplit(
        ("https", parsed.netloc.lower(), parsed.path or "/", parsed.query, "")
    )


def validate_dns(hostname: str) -> None:
    # Defence-in-depth. Do not send GitHub credentials to this remote URL.
    records = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    if not records:
        raise ValueError("无法解析来源域名")
    for record in records:
        address = ipaddress.ip_address(record[4][0])
        if not address.is_global:
            raise ValueError("来源域名解析到内部或保留 IP，已拒绝导入")


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    max_redirections = 5
    max_repeats = 5

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = valid_https(newurl)
        host = urllib.parse.urlsplit(url).hostname
        validate_dns(host)
        return super().redirect_request(req, fp, code, msg, headers, url)


def fetch_source(url: str) -> dict:
    source_url = valid_https(url)
    validate_dns(urllib.parse.urlsplit(source_url).hostname)
    opener = urllib.request.build_opener(SafeRedirectHandler())
    request = urllib.request.Request(
        source_url,
        headers={
            "Accept": "application/json, text/plain;q=0.9, */*;q=0.5",
            "User-Agent": "ZZS-IPA-Store-Source-Importer/1.0",
        },
    )
    with opener.open(request, timeout=25) as response:
        if response.status != 200:
            raise ValueError(f"上游返回 HTTP {response.status}")
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_SOURCE_BYTES:
            raise ValueError("来源 JSON 大于 6 MiB 上限")
        data = response.read(MAX_SOURCE_BYTES + 1)
        if len(data) > MAX_SOURCE_BYTES:
            raise ValueError("来源 JSON 大于 6 MiB 上限")
    try:
        document = json.loads(data.decode("utf-8-sig"))
    except json.JSONDecodeError:
        try:
            import json5
            document = json5.loads(data.decode("utf-8-sig"))
        except Exception as error:
            raise ValueError("不是有效的 JSON/JSON5 软件源") from error
    if not isinstance(document, dict) or not isinstance(document.get("apps"), list):
        raise ValueError("不是 AltStore 格式，缺少 apps 数组")
    if len(document["apps"]) > 2000:
        raise ValueError("来源超过 2,000 个应用，请选择更小的软件源")
    return document


def clean_screenshots(value: object) -> list | dict | None:
    def clean_array(values: object) -> list:
        result = []
        if not isinstance(values, list):
            return result
        for item in values[:16]:
            try:
                if isinstance(item, str):
                    result.append(valid_https(item))
                elif isinstance(item, dict):
                    image = valid_https(item.get("imageURL"))
                    out = {"imageURL": image}
                    if isinstance(item.get("width"), int) and item["width"] > 0:
                        out["width"] = item["width"]
                    if isinstance(item.get("height"), int) and item["height"] > 0:
                        out["height"] = item["height"]
                    result.append(out)
            except (ValueError, TypeError):
                continue
        return result
    if isinstance(value, list):
        return clean_array(value)
    if isinstance(value, dict):
        device = {}
        for kind in ("iphone", "ipad"):
            images = clean_array(value.get(kind))
            if images:
                device[kind] = images
        return device or None
    return None


def clean_permissions(value: object) -> dict:
    if not isinstance(value, dict):
        return {"entitlements": [], "privacy": {}}
    ent = value.get("entitlements")
    entitlements = [
        item for item in ent[:150]
        if isinstance(item, str) and 0 < len(item) <= 200
    ] if isinstance(ent, list) else []
    privacy = value.get("privacy")
    safe_privacy = {}
    if isinstance(privacy, dict):
        for key, val in list(privacy.items())[:150]:
            if isinstance(key, str) and key.endswith("UsageDescription") and isinstance(val, str):
                safe_privacy[key] = val[:2048]
    return {"entitlements": entitlements, "privacy": safe_privacy}


def clean_version(version: object) -> dict | None:
    if not isinstance(version, dict):
        return None
    value = version.get("version")
    date = version.get("date")
    size = version.get("size")
    if not isinstance(value, str) or not value.strip() or len(value) > 100:
        return None
    if not isinstance(date, str) or not re.match(r"^\d{4}-\d{1,2}-\d{1,2}", date):
        return None
    if isinstance(size, bool) or not isinstance(size, int) or size < 1 or size > 10**11:
        return None
    try:
        download = valid_https(version.get("downloadURL"))
    except (ValueError, TypeError):
        return None
    out = {
        "version": value.strip(),
        "date": date[:35],
        "downloadURL": download,
        "size": size,
    }
    build = version.get("buildVersion")
    if isinstance(build, str) and build.strip() and len(build) <= 100:
        out["buildVersion"] = build.strip()
    elif isinstance(build, int) and build >= 0:
        out["buildVersion"] = str(build)
    for field in ("minOSVersion", "maxOSVersion", "localizedDescription", "marketingVersion", "sha256"):
        candidate = version.get(field)
        if isinstance(candidate, str) and candidate and len(candidate) <= 5000:
            out[field] = candidate
    return out


def clean_app(app: object) -> tuple[dict | None, str]:
    if not isinstance(app, dict):
        return None, "应用记录不是对象"
    bundle = app.get("bundleIdentifier")
    if not isinstance(bundle, str) or not BUNDLE_PATTERN.fullmatch(bundle):
        return None, "Bundle ID 无效"
    if "patreon" in app and app["patreon"] is not None:
        return None, f"{bundle}: 跳过 Patreon 付费限制应用"
    if app.get("marketplaceID"):
        return None, f"{bundle}: 跳过 AltStore PAL 专用应用"
    versions = app.get("versions")
    if not isinstance(versions, list):
        return None, f"{bundle}: 缺少 versions 列表"
    clean = []
    seen = set()
    for item in versions[:MAX_VERSIONS_PER_APP]:
        version = clean_version(item)
        if not version:
            continue
        key = (version["version"], version.get("buildVersion"))
        if key not in seen:
            clean.append(version)
            seen.add(key)
    if not clean:
        return None, f"{bundle}: 没有可用的公开 HTTPS 版本"
    name = app.get("name")
    if not isinstance(name, str) or not name.strip():
        return None, f"{bundle}: 缺少应用名称"
    try:
        icon = valid_https(app.get("iconURL"))
    except (TypeError, ValueError):
        icon = "https://avatars.githubusercontent.com/u/101614537?v=4"
    developer = app.get("developerName")
    desc = app.get("localizedDescription")
    result = {
        "name": name[:180].strip(),
        "bundleIdentifier": bundle,
        "developerName": developer[:180] if isinstance(developer, str) and developer.strip() else "Unknown developer",
        "localizedDescription": desc[:12000] if isinstance(desc, str) and desc.strip() else name[:180],
        "iconURL": icon,
        "category": app.get("category") if app.get("category") in ALLOWED_CATEGORIES else "other",
        "versions": clean,
        "appPermissions": clean_permissions(app.get("appPermissions")),
    }
    if isinstance(app.get("subtitle"), str):
        result["subtitle"] = app["subtitle"][:250]
    tint = app.get("tintColor")
    if isinstance(tint, str) and HEX_COLOR_PATTERN.fullmatch(tint):
        result["tintColor"] = tint if tint.startswith("#") else "#" + tint
    screenshots = clean_screenshots(app.get("screenshots"))
    if screenshots:
        result["screenshots"] = screenshots
    return result, ""


def import_apps(existing: dict, external: dict, *, mode: str, bundles: set[str]) -> tuple[dict, dict]:
    if external.get("nsfw") is True:
        raise ValueError("原始软件源标记为 NSFW，本工具默认不导入此类软件源")
    if not isinstance(existing, dict) or not isinstance(existing.get("apps"), list):
        raise ValueError("现有软件源 JSON 格式无效")
    new = json.loads(json.dumps(existing, ensure_ascii=False))
    current = {
        app.get("bundleIdentifier"): app
        for app in new["apps"] if isinstance(app, dict)
    }
    counters = {"added": 0, "merged": 0, "skipped": 0, "versions_added": 0, "warnings": []}
    seen = set()
    for item in external["apps"]:
        if isinstance(item, dict) and isinstance(item.get("bundleIdentifier"), str):
            bundle = item["bundleIdentifier"]
            if bundles and bundle not in bundles:
                continue
            if bundle in seen:
                counters["warnings"].append(f"{bundle}: 原始软件源中重复出现，跳过重复记录")
                counters["skipped"] += 1
                continue
            seen.add(bundle)
        app, reason = clean_app(item)
        if not app:
            counters["skipped"] += 1
            if len(counters["warnings"]) < 25:
                counters["warnings"].append(reason)
            continue
        bundle = app["bundleIdentifier"]
        if bundle in current:
            if mode == "add-only":
                counters["skipped"] += 1
                continue
            target = current[bundle]
            known = {(v.get("version"), v.get("buildVersion"))
                     for v in target.get("versions", []) if isinstance(v, dict)}
            count = 0
            for version in app["versions"]:
                key = (version.get("version"), version.get("buildVersion"))
                if key not in known:
                    target.setdefault("versions", []).append(version)
                    known.add(key)
                    count += 1
            if count:
                counters["versions_added"] += count
                counters["merged"] += 1
            else:
                counters["skipped"] += 1
        else:
            if len(new["apps"]) >= MAX_APPS:
                raise ValueError(f"已达到每次最多 {MAX_APPS} 款应用的保护上限")
            new["apps"].append(app)
            current[bundle] = app
            counters["added"] += 1
            counters["versions_added"] += len(app["versions"])
    missing = bundles - seen
    if missing:
        raise ValueError("原始源中没有找到指定的 Bundle ID: " + ", ".join(sorted(missing)))
    return new, counters


def write_summary(url: str, info: dict, *, preview: bool):
    lines = [
        "### ZZS IPA Store source import",
        f"- Mode: {'Preview only' if preview else 'Publish'}",
        f"- Added apps: {info['added']}",
        f"- Apps with merged versions: {info['merged']}",
        f"- Versions imported: {info['versions_added']}",
        f"- Skipped: {info['skipped']}",
        f"- Original source: {url}",
    ]
    if info["warnings"]:
        lines.append("#### Warnings")
        lines.extend("- " + str(item).replace("\n", " ") for item in info["warnings"][:25])
    message = "\n".join(lines) + "\n"
    print(message)
    output = os.environ.get("GITHUB_STEP_SUMMARY")
    if output:
        with open(output, "a", encoding="utf-8") as fh:
            fh.write(message)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import public AltStore Classic source entries")
    parser.add_argument("--url", required=True)
    parser.add_argument("--mode", choices=["add-only", "merge-versions"], default="add-only")
    parser.add_argument("--bundle-ids", default="", help="Optional comma-separated bundle IDs")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    selected = {part.strip() for part in args.bundle_ids.replace("\n", ",").split(",") if part.strip()}
    if len(selected) > MAX_APPS:
        raise ValueError("选择的应用数量过多")
    external = fetch_source(args.url)
    existing = json.loads(SOURCE_FILE.read_text(encoding="utf-8"))
    updated, counters = import_apps(existing, external, mode=args.mode, bundles=selected)
    write_summary(args.url, counters, preview=args.preview)
    if not args.preview:
        SOURCE_FILE.write_text(
            json.dumps(updated, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8"
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)
