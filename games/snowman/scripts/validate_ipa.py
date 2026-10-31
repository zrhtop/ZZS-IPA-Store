#!/usr/bin/env python3
"""Validate real IPA metadata and embedded offline game resources."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import struct
import zipfile

BUNDLE_ID = "jp.zrh.snowmanchristmas"


def inspect(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        infos = [x for x in archive.namelist() if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", x)]
        if len(infos) != 1:
            raise ValueError("IPA must contain exactly one main application")
        info = plistlib.loads(archive.read(infos[0]))
        expected = {"CFBundleIdentifier": BUNDLE_ID, "CFBundleShortVersionString": "1.0.4", "CFBundleVersion": "5"}
        for key, value in expected.items():
            if str(info.get(key)) != value:
                raise ValueError(f"Unexpected {key}: {info.get(key)!r}")
        if info.get("DTPlatformName") != "iphoneos":
            raise ValueError("Release payload was not built for physical iOS devices")
        minimum = str(info.get("MinimumOSVersion", ""))
        if not minimum or tuple(map(int, minimum.split("."))) < (15,):
            raise ValueError(f"Unexpected minimum iOS version: {minimum!r}")
        base = infos[0].removesuffix("Info.plist")
        executable = archive.read(base + info["CFBundleExecutable"])
        if executable[:4] == b"\xcf\xfa\xed\xfe":
            architectures = [struct.unpack_from("<I", executable, 4)[0]]
        elif executable[:4] == b"\xca\xfe\xba\xbe":
            count = struct.unpack_from(">I", executable, 4)[0]
            architectures = [struct.unpack_from(">I", executable, 8 + i * 20)[0] for i in range(count)]
        else:
            raise ValueError("Main executable is not a supported Mach-O device binary")
        if 0x0100000C not in architectures:
            raise ValueError("Main executable does not contain arm64")
        web = base + "Web/"
        if not archive.read(web + "index.html"):
            raise ValueError("Missing offline launch page")
        game = archive.read(web + "snowman.swf")
        if game[:3] not in (b"CWS", b"FWS") or game[3] != 8:
            raise ValueError("Bundled game is not the expected Flash 8 artifact")
        runtime = json.loads(archive.read(web + "runtime/runtime-manifest.json"))
        if runtime["version"] != "0.7.1" or runtime["archiveSHA256"] != "ef12edbee135d581a9cd523837d746da30a07a64dbf1cf472d2e472c656f4b5e":
            raise ValueError("Unexpected Flash runtime version")
        wasm_count = 0
        for name, meta in runtime["files"].items():
            content = archive.read(web + "runtime/" + name)
            if hashlib.sha256(content).hexdigest() != meta["sha256"] or len(content) != meta["size"]:
                raise ValueError(f"Embedded runtime file differs from verified artifact: {name}")
            wasm_count += name.endswith(".wasm")
        if wasm_count < 2:
            raise ValueError("Both offline WASM variants must be bundled")
        entitlements = set()
        for entry in archive.namelist():
            if entry.endswith((".xcent", ".entitlements")):
                parsed = plistlib.loads(archive.read(entry))
                entitlements.update(k for k in parsed if k not in {"application-identifier", "com.apple.developer.team-identifier"})
        result = {
            "bundleIdentifier": info["CFBundleIdentifier"],
            "name": info.get("CFBundleDisplayName") or info.get("CFBundleName"),
            "version": info["CFBundleShortVersionString"],
            "buildVersion": str(info["CFBundleVersion"]),
            "minOSVersion": minimum,
            "size": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "gameSHA256": hashlib.sha256(game).hexdigest(),
            "arm64": True,
            "runtimeVersion": runtime["version"],
            "runtimeArchiveSHA256": runtime["archiveSHA256"],
            "runtimeFilesVerified": len(runtime["files"]),
            "appPermissions": {
                "privacy": {k: v for k, v in info.items() if k.startswith("NS") and k.endswith("UsageDescription")},
                "entitlements": sorted(entitlements),
            },
            "codeSignaturePresent": any(x.startswith(base + "_CodeSignature/") for x in archive.namelist()),
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = inspect(args.ipa)
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
