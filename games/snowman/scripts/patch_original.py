#!/usr/bin/env python3
"""Append an input/optional-lives adapter without recompiling original bytecode."""
from pathlib import Path
import base64
import hashlib
import json
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_SHA256 = "03874a0451d37ef0148a8cb7fb27e0b7ec4077977ec8426d8983e53a9dadb947"

def decode(raw):
    if raw[:3] == b"CWS":
        return b"FWS" + raw[3:8] + zlib.decompress(raw[8:])
    if raw[:3] != b"FWS":
        raise ValueError("Unexpected SWF format")
    return raw

def tags(data):
    coordinate_bits = data[8] >> 3
    offset = 8 + (5 + 4 * coordinate_bits + 7) // 8 + 4
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
        yield start, header >> 6, data[start:offset + size]
        offset += size
        if header >> 6 == 0:
            if offset != len(data):
                raise ValueError("Unexpected SWF trailing data")
            return

def main():
    original = (ROOT / "Original/snowman.swf").read_bytes()
    if hashlib.sha256(original).hexdigest() != ORIGINAL_SHA256:
        raise ValueError("Original SWF identity changed")
    data = decode(original)
    if struct.unpack_from("<I", data, 4)[0] != len(data):
        raise ValueError("Invalid uncompressed SWF length")
    adapter = base64.b64decode((ROOT / "bridge/adapter.avm1.b64").read_text(), validate=False)
    if not adapter or adapter[-1] != 0:
        raise ValueError("Adapter action block has no End opcode")
    frame = 1
    insertion = None
    old_tags = list(tags(data))
    for offset, kind, raw in old_tags:
        if kind == 1:
            if frame == 19:
                insertion = offset
                break
            frame += 1
    if insertion is None:
        raise ValueError("Original title frame was not found")
    added = struct.pack("<HI", 12 << 6 | 63, len(adapter)) + adapter
    modified = data[:insertion] + added + data[insertion:]
    modified = modified[:4] + struct.pack("<I", len(modified)) + modified[8:]
    new_tags = list(tags(modified))
    preserved = [raw for offset, _, raw in new_tags if offset != insertion]
    if preserved != [raw for _, _, raw in old_tags]:
        raise ValueError("An original SWF tag was changed")
    output = b"CWS" + modified[3:8] + zlib.compress(modified[8:], 9)
    (ROOT / "Web").mkdir(exist_ok=True)
    (ROOT / "Web/snowman.swf").write_bytes(output)
    report = {
        "sourceSHA256": ORIGINAL_SHA256,
        "patchedSHA256": hashlib.sha256(output).hexdigest(),
        "adapterSHA256": hashlib.sha256(adapter).hexdigest(),
        "originalTagCount": len(old_tags), "patchedTagCount": len(new_tags),
        "allOriginalTagsByteIdentical": True, "injectedRootFrame": 19,
        "bridgeActionBytes": len(adapter),
        "game": {"title": "Deep Freeze", "publisher": "Miniclip", "width": 550,
                 "height": 400, "frameRate": 30, "language": "ActionScript 2"},
        "changes": ["Combine touch keys with original keyboard input",
                    "Restore life lost through the original damage handler only when cheat is enabled",
                    "Expose state and test-mode-only probes for runtime verification"],
        "originalTimerRetained": True,
    }
    (ROOT / "preservation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))

if __name__ == "__main__":
    main()
