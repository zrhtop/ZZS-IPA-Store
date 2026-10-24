#!/usr/bin/env python3
"""Inspect a public HTTPS IPA and publish its metadata, never copy the IPA."""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import os
import pathlib
import plistlib
import re
import struct
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from import_source import SafeRedirectHandler, valid_https, validate_dns
from sync_releases import ipa_metadata

SOURCE = ROOT / "docs" / "source.json"
ICON_DIR = ROOT / "docs" / "icons"
MAX_IPA = 1024 * 1024 * 1024
MAX_ICON = 5 * 1024 * 1024
FALLBACK_ICON = "https://avatars.githubusercontent.com/u/101614537?v=4"
HOME = "https://repo.zrh.jp/"
USER_AGENT = "ZZS-IPA-Importer/1.0"
RELEASE_PATH = re.compile(
    r"^/([A-Za-z0-9-]{1,39})/([A-Za-z0-9_.-]{1,100})/"
    r"releases/(?:download/([^/]+)|latest/download)/([^/?]+)", re.I
)
PLIST_PATH = re.compile(r"^Payload/[^/]+\.app/Info\.plist$", re.I)
PNG = b"\x89PNG\r\n\x1a\n"
CATEGORIES = {
    "auto", "developer", "entertainment", "games", "lifestyle",
    "other", "photo-video", "social", "utilities"
}


def opener():
    return urllib.request.build_opener(SafeRedirectHandler())


def download(url: str) -> tuple[pathlib.Path, int]:
    url = valid_https(url)
    validate_dns(urllib.parse.urlsplit(url).hostname)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    tmp = tempfile.NamedTemporaryFile(prefix="zzs-ipa-", suffix=".ipa", delete=False)
    path = pathlib.Path(tmp.name)
    size = 0
    try:
        with opener().open(req, timeout=90) as response:
            declared = response.headers.get("Content-Length")
            if declared and declared.isdigit() and int(declared) > MAX_IPA:
                raise ValueError("IPA 文件超过 1 GiB")
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_IPA:
                    raise ValueError("下载超过 1 GiB 大小限制")
                tmp.write(chunk)
        tmp.close()
        if size < 200 or not zipfile.is_zipfile(path):
            raise ValueError("下载结果不是有效 IPA / ZIP 文件")
        return path, size
    except Exception:
        tmp.close()
        path.unlink(missing_ok=True)
        raise


def api_json(url: str) -> dict:
    if not url.startswith("https://api.github.com/repos/"):
        raise ValueError("Invalid upstream API URL")
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
    )
    with opener().open(request, timeout=20) as response:
        data = response.read(8 * 1024 * 1024 + 1)
    if len(data) > 8 * 1024 * 1024:
        raise ValueError("GitHub repository is too large to scan")
    result = json.loads(data)
    if not isinstance(result, dict):
        raise ValueError("Upstream GitHub API returned invalid JSON")
    return result


def github_icon_path(files: list[str]) -> str | None:
    candidates: list[tuple[int, str]] = []
    for path in files[:15000]:
        low = path.lower()
        base = low.rsplit("/", 1)[-1]
        if not low.endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        if "icon" not in base and "logo" not in base:
            continue
        if any(marker in low for marker in (
            "/screenshots/", "/tests/", "/fixtures/", "/preview/", "/test/")):
            continue
        score = (
            (75 if "appicon" in base or "app-icon" in base else 0)
            + (40 if "icon" in base else 0)
            + (25 if "logo" in base else 0)
            + (18 if low.startswith("design/") else 0)
            + (8 if "1024" in base else 0)
            + (8 if "light" in base else 0)
            - (10 if "dark" in base else 0)
            - (40 if "badge" in base or "mask" in base else 0)
            + (5 if low.endswith(".png") else 0)
        )
        candidates.append((score, path))
    return max(candidates)[1] if candidates else None


def brief_notes(body: str) -> str:
    result = []
    for line in body.replace("\r", "").splitlines():
        line = line.strip()
        if not line:
            continue
        line = re.sub(r"^#{1,5}\s*", "", line)
        if re.match(
            r"^(下载与安装|安装方法|验证与边界|已知问题|sha[-\s]?256|"
            r"checksums?|installation|downloads?|known issues)", line, re.I
        ):
            break
        if line.lower() in ("主要变化", "更新内容", "what's changed", "changelog"):
            continue
        if line.startswith(("<!--", "<details", "</details", chr(96) * 3)):
            continue
        if "github.com/" in line and (
            "compare/" in line or "releases/download/" in line
        ):
            continue
        if len(line) > 350:
            line = line[:347] + "..."
        result.append(line)
        if len(result) >= 5 or sum(map(len, result)) > 700:
            break
    return "\n".join(result)[:750]


def upstream_data(url: str) -> dict:
    parsed = urllib.parse.urlsplit(url)
    match = RELEASE_PATH.match(parsed.path) if parsed.hostname == "github.com" else None
    if not match:
        return {}
    owner, repo, tag, _ = match.groups()
    base = "https://api.github.com/repos/" + owner + "/" + repo
    out = {"developer": owner, "description": "", "notes": "", "icon": "", "date": ""}
    branch = "main"
    try:
        info = api_json(base)
        branch = str(info.get("default_branch") or "main")
        out["developer"] = str(info.get("owner", {}).get("login") or owner)[:120]
        out["description"] = str(info.get("description") or "")[:1600]
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"上游 GitHub 仓库资料不可用：{exc}")
    if tag:
        try:
            rel = api_json(base + "/releases/tags/" + urllib.parse.quote(
                urllib.parse.unquote(tag), safe=""
            ))
            out["notes"] = brief_notes(str(rel.get("body") or ""))
            out["date"] = str(rel.get("published_at") or "")[:10]
        except (OSError, ValueError, json.JSONDecodeError):
            pass
    try:
        tree = api_json(
            base + "/git/trees/" + urllib.parse.quote(branch, safe="") + "?recursive=1"
        )
        paths = [
            x["path"] for x in tree.get("tree", [])
            if isinstance(x, dict) and x.get("type") == "blob"
            and isinstance(x.get("path"), str)
        ]
        icon = github_icon_path(paths)
        if icon:
            rel_path = "/".join(urllib.parse.quote(p, safe="") for p in icon.split("/"))
            out["icon"] = (
                "https://raw.githubusercontent.com/" + owner + "/" + repo + "/"
                + urllib.parse.quote(branch, safe="") + "/" + rel_path
            )
            print(f"找到上游图标：{icon}")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"无法获取上游仓库图标：{exc}")
    return out


def ipa_png_icon(path: pathlib.Path) -> bytes | None:
    """Extract an IPA's standalone PNG icon (does not decode Assets.car)."""
    with zipfile.ZipFile(path) as archive:
        primary = next(
            (v for v in archive.infolist() if PLIST_PATH.fullmatch(v.filename)), None
        )
        if primary is None or primary.file_size > 4 * 1024 * 1024:
            return None
        plist = plistlib.loads(archive.read(primary))
        root = primary.filename[:-len("Info.plist")]
        aliases = []
        files = plist.get("CFBundleIconFiles")
        if isinstance(files, list):
            aliases.extend(x for x in files if isinstance(x, str))
        for kind in ("CFBundleIcons", "CFBundleIcons~ipad"):
            group = plist.get(kind)
            if isinstance(group, dict):
                files = group.get("CFBundlePrimaryIcon", {})
                if isinstance(files, dict):
                    values = files.get("CFBundleIconFiles")
                    if isinstance(values, list):
                        aliases.extend(x for x in values if isinstance(x, str))
        aliases = [pathlib.PurePosixPath(x).stem.lower() for x in aliases]
        possibilities = []
        for member in archive.infolist():
            if not member.filename.startswith(root):
                continue
            relative = member.filename[len(root):]
            if "/" in relative or not relative.lower().endswith(".png"):
                continue
            if not 100 <= member.file_size <= MAX_ICON:
                continue
            basename = pathlib.PurePosixPath(relative).stem.lower()
            score = (
                (90 if any(basename.startswith(a) for a in aliases if a) else 0)
                + (60 if "appicon" in basename else 0)
                + (25 if "icon" in basename else 0)
            )
            if score:
                possibilities.append((score, member))
        for _, member in sorted(possibilities, key=lambda v: v[0], reverse=True)[:20]:
            try:
                with archive.open(member) as f:
                    data = f.read(MAX_ICON + 1)
                if len(data) > MAX_ICON or not data.startswith(PNG):
                    continue
                if data[12:16] != b"IHDR":
                    continue
                width, height = struct.unpack(">II", data[16:24])
                if 40 <= width <= 2048 and 40 <= height <= 2048:
                    return data
            except (OSError, ValueError, zipfile.BadZipFile):
                continue
    return None


def icon_location(bundle: str, png: bytes) -> tuple[pathlib.Path, str]:
    safe = re.sub(r"[^A-Za-z0-9._-]", "-", bundle)
    name = safe + "-" + hashlib.sha256(png).hexdigest()[:12] + ".png"
    return ICON_DIR / name, HOME + "icons/" + name


def merge(source: dict, metadata: dict, version: dict, *,
          app_name: str = "", developer: str = "", description: str = "",
          icon: str = "", category: str = "auto", existing_mode: str = "skip",
          explicit_icon: bool = False) -> tuple[dict, str]:
    if category not in CATEGORIES or existing_mode not in ("skip", "replace"):
        raise ValueError("Invalid selection")
    if not isinstance(source.get("apps"), list):
        raise ValueError("Invalid AltStore source")
    result = copy.deepcopy(source)
    bundle = metadata["bundleIdentifier"]
    target = next((app for app in result["apps"]
                   if app.get("bundleIdentifier") == bundle), None)
    status = "new-version"
    if target is None:
        status = "new-app"
        target = {
            "name": app_name.strip()[:160] or metadata["name"][:160],
            "bundleIdentifier": bundle,
            "developerName": developer.strip()[:160] or "Unknown developer",
            "localizedDescription": description.strip()[:3000] or metadata["name"][:160],
            "iconURL": icon or FALLBACK_ICON,
            "category": "utilities" if category == "auto" else category,
            "appPermissions": {
                "entitlements": metadata.get("entitlements", []),
                "privacy": metadata.get("privacy", {}),
            },
            "versions": [],
        }
        result["apps"].insert(0, target)
    else:
        if app_name.strip():
            target["name"] = app_name.strip()[:160]
        if developer.strip():
            target["developerName"] = developer.strip()[:160]
        if description.strip():
            target["localizedDescription"] = description.strip()[:3000]
        if icon and (explicit_icon or not target.get("iconURL")
                     or target.get("iconURL") == FALLBACK_ICON):
            target["iconURL"] = icon
        if category != "auto":
            target["category"] = category
        permissions = target.get("appPermissions") or {}
        old_privacy = permissions.get("privacy") or {}
        privacy = dict(old_privacy)
        privacy.update(metadata.get("privacy", {}))
        target["appPermissions"] = {
            "entitlements": metadata.get("entitlements") or permissions.get("entitlements") or [],
            "privacy": privacy,
        }
    history = target.get("versions")
    if not isinstance(history, list):
        history = []
    key = (version["version"], version["buildVersion"])
    exists = any(
        (v.get("version"), str(v.get("buildVersion", ""))) == key
        for v in history if isinstance(v, dict)
    )
    if exists and existing_mode == "skip":
        status = "version-already-exists"
    else:
        target["versions"] = [v for v in history if (
            v.get("version"), str(v.get("buildVersion", ""))) != key]
        target["versions"].insert(0, version)
        if exists:
            status = "version-replaced"
    result.setdefault("news", [])
    return result, status


def publish_summary(meta: dict, app: dict, status: str, icon_method: str,
                    url: str, preview: bool):
    text = "\n".join([
        "### ZZS IPA Store · 从 URL 添加 IPA",
        "- 模式：" + ("仅预览" if preview else "正式发布"),
        "- 操作结果：" + status,
        "- 应用：" + app["name"],
        "- Bundle ID：" + meta["bundleIdentifier"],
        "- 版本：" + meta["version"] + " (Build " + meta["buildVersion"] + ")",
        "- 图标：" + icon_method,
        "- 图标地址：" + app.get("iconURL", ""),
        "- IPA 下载地址：" + url,
        "- 注意：真实签名 Entitlements 可能无法从 IPA 完整读取。",
    ]) + "\n"
    print(text)
    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        with open(summary_file, "a", encoding="utf-8") as f:
            f.write(text)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--icon-url", default="")
    p.add_argument("--name", default="")
    p.add_argument("--developer", default="")
    p.add_argument("--description", default="")
    p.add_argument("--notes", default="")
    p.add_argument("--category", default="auto")
    p.add_argument("--existing-mode", choices=("skip", "replace"), default="skip")
    p.add_argument("--preview", action="store_true")
    args = p.parse_args()

    url = valid_https(args.url)
    custom_icon = valid_https(args.icon_url) if args.icon_url.strip() else ""
    file, byte_size = download(url)
    try:
        meta = ipa_metadata(file)
        upstream = upstream_data(url)
        notes = args.notes.strip() or upstream.get("notes", "")
        developer = args.developer.strip() or upstream.get("developer", "")
        description = args.description.strip() or upstream.get("description", "")
        png = None
        if custom_icon:
            icon = custom_icon
            method = "自定义图片 URL"
        else:
            try:
                png = ipa_png_icon(file)
            except (OSError, ValueError, plistlib.InvalidFileException,
                    zipfile.BadZipFile) as exc:
                print("IPA 未提取到 PNG 图标：" + str(exc))
            if png:
                _, icon = icon_location(meta["bundleIdentifier"], png)
                method = "自动提取 IPA 内的 PNG"
            elif upstream.get("icon"):
                icon = upstream["icon"]
                method = "自动使用上游 GitHub 图标"
            else:
                icon = ""
                method = "默认占位图（可以额外填写图标 URL）"
    finally:
        file.unlink(missing_ok=True)

    date = upstream.get("date")
    if not isinstance(date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        date = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    version = {
        "version": meta["version"],
        "buildVersion": meta["buildVersion"],
        "date": date,
        "localizedDescription": notes.strip()[:2000] or "版本 " + meta["version"],
        "downloadURL": url,
        "size": byte_size,
    }
    if meta.get("minOSVersion"):
        version["minOSVersion"] = meta["minOSVersion"]
    original = json.loads(SOURCE.read_text(encoding="utf-8"))
    # Inferred upstream metadata should not override a user's edited
    # description, developer attribution or custom icon on existing apps.
    exists = any(a.get("bundleIdentifier") == meta["bundleIdentifier"]
                 for a in original.get("apps", []) if isinstance(a, dict))
    if exists:
        if not args.developer.strip():
            developer = ""
        if not args.description.strip():
            description = ""
    updated, status = merge(
        original, meta, version, app_name=args.name,
        developer=developer, description=description,
        icon=icon, category=args.category, existing_mode=args.existing_mode,
        explicit_icon=bool(custom_icon)
    )
    app = next(a for a in updated["apps"]
               if a["bundleIdentifier"] == meta["bundleIdentifier"])
    publish_summary(meta, app, status, method, url, args.preview)
    if args.preview:
        return
    SOURCE.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
    if png and not custom_icon:
        image_path, _ = icon_location(meta["bundleIdentifier"], png)
        image_path.parent.mkdir(parents=True, exist_ok=True)
        if not image_path.exists():
            image_path.write_bytes(png)
    print(f"发布成功，软件源目前有 {len(updated['apps'])} 款应用")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)
