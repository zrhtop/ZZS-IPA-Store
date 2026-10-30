#!/usr/bin/env python3
"""Append one bootstrap action; preserve every original Flash 5 tag byte for byte."""
from pathlib import Path
import base64
import hashlib
import json
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_SHA256 = "2a26f54d3ede5e716eec060e7afdb2530f0d2423d651aea0f2844ba600be6e0b"

def decode(raw):
    if raw[:3] == b"CWS":
        return b"FWS" + raw[3:8] + zlib.decompress(raw[8:])
    if raw[:3] != b"FWS":
        raise ValueError("Unexpected SWF format")
    return raw

def tags(data):
    offset = 8 + (5 + 4 * (data[8] >> 3) + 7) // 8 + 4
    while offset < len(data):
        start = offset
        header, = struct.unpack_from("<H", data, offset)
        offset += 2
        size = header & 63
        if size == 63:
            size, = struct.unpack_from("<I", data, offset)
            offset += 4
        if offset + size > len(data):
            raise ValueError("Truncated SWF tag")
        yield start, header >> 6, data[start:offset + size], data[offset:offset + size]
        offset += size
        if header >> 6 == 0:
            if offset != len(data):
                raise ValueError("Unexpected trailing data")
            return

def main():
    original = (ROOT / "Original/guoguan2.swf").read_bytes()
    if hashlib.sha256(original).hexdigest() != ORIGINAL_SHA256 or original[3] != 5:
        raise ValueError("Original Flash 5 identity changed")
    data = decode(original)
    if struct.unpack_from("<I", data, 4)[0] != len(data):
        raise ValueError("Invalid uncompressed length")
    adapter = base64.b64decode((ROOT / "bridge/bootstrap.avm1.b64").read_text())
    helper = base64.b64decode((ROOT / "bridge/helper.swf.b64").read_text())
    font = base64.b64decode((ROOT / "bridge/menu-font.swf.b64").read_text())
    if not adapter or adapter[-1] != 0 or helper[3] != 8:
        raise ValueError("Invalid interface adapter")
    old_tags = list(tags(data))
    frame = 1
    insertion = None
    for offset, kind, raw, body in old_tags:
        if kind == 1:
            if frame == 3:
                insertion = offset
                break
            frame += 1
    if insertion is None:
        raise ValueError("Title frame missing")
    addition = struct.pack("<HI", 12 << 6 | 63, len(adapter)) + adapter
    modified = data[:insertion] + addition + data[insertion:]
    modified = modified[:4] + struct.pack("<I", len(modified)) + modified[8:]
    new_tags = list(tags(modified))
    if [raw for offset, kind, raw, body in new_tags if offset != insertion] != [raw for _, _, raw, _ in old_tags]:
        raise ValueError("An original tag changed")
    # Compression is lossless and retains the original version/RECT/fps/frames.
    output = b"CWS" + modified[3:8] + zlib.compress(modified[8:], 9)
    web = ROOT / "Web"
    web.mkdir(exist_ok=True)
    (web / "guoguan2.swf").write_bytes(output)
    (web / "guoguan2-bridge.swf").write_bytes(helper)
    (web / "menu-font.swf").write_bytes(font)
    report = {
        "originalVersion":5, "patchedVersion":5,
        "originalSHA256":ORIGINAL_SHA256,
        "patchedSHA256":hashlib.sha256(output).hexdigest(),
        "helperVersion":8, "helperSHA256":hashlib.sha256(helper).hexdigest(),
        "menuFontSHA256":hashlib.sha256(font).hexdigest(),
        "originalTagCount":len(old_tags), "patchedTagCount":len(new_tags),
        "allOriginalTagsByteIdentical":True, "injectedRootFrame":3,
        "bootstrapSHA256":hashlib.sha256(adapter).hexdigest(),
        "game":{"title":"Fight Man / 过关斩将 II", "author":"朱志强（小小）", "width":500,"height":300,"frameRate":18},
        "changes":["Map virtual keys to the original rebindable controls", "Optional Flash 5 reserve-life write protection", "Optional Flash 5 player hurtbox and health write protection", "Separate Flash 8 interface with original gameplay remaining Flash 5", "Repair original GB2312 display text and provide an offline CJK device font"]
    }
    (ROOT / "preservation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))

if __name__ == "__main__":
    main()
