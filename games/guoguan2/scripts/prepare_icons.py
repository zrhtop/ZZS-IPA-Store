#!/usr/bin/env python3
"""Generate the catalog's exact iOS icon sizes from the opaque master PNG."""
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def main():
    catalog = ROOT / "iOS/Assets.xcassets/AppIcon.appiconset"
    metadata = json.loads((catalog / "Contents.json").read_text())
    seen = set()
    for entry in metadata["images"]:
        filename = entry["filename"]
        if filename in seen:
            continue
        seen.add(filename)
        points = float(entry["size"].split("x")[0])
        pixels = int(points * float(entry["scale"].removesuffix("x")))
        subprocess.run(["sips", "-z", str(pixels), str(pixels), str(ROOT / "icon.png"),
                        "--out", str(catalog / filename)], check=True, stdout=subprocess.DEVNULL)
    print(f"Prepared {len(seen)} opaque iOS icon sizes")

if __name__ == "__main__":
    main()
