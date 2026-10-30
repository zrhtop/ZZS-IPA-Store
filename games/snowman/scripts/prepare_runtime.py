#!/usr/bin/env python3
"""Acquire the exact upstream runtime that is bundled into the offline app."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
URL = "https://github.com/ruffle-rs/ruffle/releases/download/v0.7.1/ruffle-0.7.1-web-selfhosted.zip"
SHA256 = "ef12edbee135d581a9cd523837d746da30a07a64dbf1cf472d2e472c656f4b5e"


def main() -> None:
    # The adapter is assembled ahead of time; CI patches the preserved original
    # deterministically with Python and does not need FFDec or a Java runtime.
    subprocess.run([sys.executable, str(ROOT / "scripts" / "patch_original.py")], check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts" / "prepare_icons.py")], check=True)
    request = urllib.request.Request(URL, headers={"User-Agent": "ZZS-Snowman-iOS-Build"})
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = response.read(32 * 1024 * 1024)
    digest = hashlib.sha256(payload).hexdigest()
    if digest != SHA256:
        raise RuntimeError(f"Ruffle archive digest mismatch: {digest}")
    target = ROOT / "Web" / "runtime"
    target.mkdir(parents=True, exist_ok=True)
    files = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        for entry in archive.infolist():
            path = Path(entry.filename)
            if entry.is_dir():
                continue
            if path.name != entry.filename or path.name in files:
                raise RuntimeError(f"Unexpected runtime archive path: {entry.filename}")
            if path.suffix not in {".js", ".wasm"} and not path.name.startswith("LICENSE"):
                continue
            data = archive.read(entry)
            (target / path.name).write_bytes(data)
            files[path.name] = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    if "ruffle.js" not in files or sum(name.endswith(".wasm") for name in files) < 2:
        raise RuntimeError("Runtime package is incomplete: both WASM variants are required")
    manifest = {"version": "0.7.1", "sourceURL": URL, "archiveSHA256": digest, "files": files}
    (target / "runtime-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Verified Ruffle 0.7.1: {len(files)} bundled files")


if __name__ == "__main__":
    main()
