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
import zlib

BUNDLE_ID = "jp.zrh.guoguan2"
ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_SHA256 = "2a26f54d3ede5e716eec060e7afdb2530f0d2423d651aea0f2844ba600be6e0b"


def inspect(path: Path, preservation_path: Path | None = None) -> dict:
    preservation = json.loads((preservation_path or ROOT / "preservation.json").read_text())
    if preservation.get("originalVersion") != 5 or preservation.get("originalSHA256") != ORIGINAL_SHA256:
        raise ValueError("Preservation record does not identify the supplied Flash 5 original")
    expected_game_hash = preservation.get("patchedSHA256", "")
    if not isinstance(expected_game_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_game_hash):
        raise ValueError("Preservation record is missing the generated SWF SHA-256")
    expected_game_version = preservation.get("patchedVersion")
    if not isinstance(expected_game_version, int) or isinstance(expected_game_version, bool) or not 1 <= expected_game_version <= 45:
        raise ValueError("Preservation record is missing the generated SWF version")
    with zipfile.ZipFile(path) as archive:
        infos = [x for x in archive.namelist() if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", x)]
        if len(infos) != 1:
            raise ValueError("IPA must contain exactly one main application")
        info = plistlib.loads(archive.read(infos[0]))
        expected = {"CFBundleIdentifier": BUNDLE_ID, "CFBundleShortVersionString": "1.0.0", "CFBundleVersion": "1"}
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
        game = archive.read(web + "guoguan2.swf")
        if game[:3] not in (b"CWS", b"FWS") or game[3] != expected_game_version:
            raise ValueError("Bundled SWF version differs from the preservation record")
        if hashlib.sha256(game).hexdigest() != expected_game_hash:
            raise ValueError("Bundled SWF bytes differ from the generated game")
        helper = archive.read(web + "guoguan2-bridge.swf")
        if helper[3] != 8 or hashlib.sha256(helper).hexdigest() != preservation.get("helperSHA256"):
            raise ValueError("Bundled interface movie differs from the verified helper")
        font = archive.read(web + "menu-font.swf")
        if hashlib.sha256(font).hexdigest() != preservation.get("menuFontSHA256"):
            raise ValueError("Bundled CJK device font differs from the verified resource")
        if b"setTextInteractionEnabled:" not in executable:
            raise ValueError("Native text selection protection is absent")
        decoded = game[:8] + zlib.decompress(game[8:]) if game[:3] == b"CWS" else game
        if struct.unpack_from("<I", decoded, 4)[0] != len(decoded):
            raise ValueError("Bundled SWF has an inconsistent uncompressed length")
        bits_per_coordinate = decoded[8] >> 3
        rect_length = (5 + bits_per_coordinate * 4 + 7) // 8
        rect_bits = "".join(f"{byte:08b}" for byte in decoded[8:8 + rect_length])
        coordinates = []
        for index in range(4):
            bits = rect_bits[5 + index * bits_per_coordinate:5 + (index + 1) * bits_per_coordinate]
            value = int(bits, 2)
            coordinates.append(value - (1 << bits_per_coordinate) if bits[0] == "1" else value)
        stage = [(coordinates[1] - coordinates[0]) / 20, (coordinates[3] - coordinates[2]) / 20]
        frame_rate = struct.unpack_from("<H", decoded, 8 + rect_length)[0] / 256
        if stage != [500, 300] or frame_rate != 18:
            raise ValueError(f"Original 500×300 stage or 18 FPS timing changed: {stage}, {frame_rate}")
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
            "helperSHA256": hashlib.sha256(helper).hexdigest(),
            "menuFontSHA256": hashlib.sha256(font).hexdigest(),
            "originalGameSHA256": ORIGINAL_SHA256,
            "originalFlashVersion": preservation["originalVersion"],
            "bundledFlashVersion": game[3],
            "stage": stage,
            "frameRate": frame_rate,
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
    parser.add_argument("--preservation", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = inspect(args.ipa, args.preservation)
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
