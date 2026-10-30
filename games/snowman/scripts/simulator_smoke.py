#!/usr/bin/env python3
"""Boot an available iPhone and retain the app's actual WebKit test result."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

BUNDLE_ID = "jp.zrh.snowmanchristmas"


def command(*args: str, timeout: int = 120) -> str:
    completed = subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    return completed.stdout.strip()


def select_device() -> dict:
    inventory = json.loads(command("xcrun", "simctl", "list", "devices", "available", "--json"))
    candidates = []
    for runtime, devices in inventory["devices"].items():
        if ".iOS-" not in runtime:
            continue
        version = tuple(int(x) for x in re.findall(r"\d+", runtime.split(".iOS-", 1)[1]))
        for device in devices:
            if device.get("isAvailable") and device["name"].startswith("iPhone"):
                candidates.append((version, device["name"], {**device, "runtime": runtime}))
    if not candidates:
        raise RuntimeError("The runner has no available iPhone simulator")
    return sorted(candidates, key=lambda x: (x[0], x[1]), reverse=True)[0][2]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--build-root", type=Path, required=True)
    parser.add_argument("--delivery", type=Path, required=True)
    args = parser.parse_args()
    args.delivery.mkdir(parents=True, exist_ok=True)
    device = select_device()
    udid = device["udid"]
    (args.delivery / "simulator-device.json").write_text(json.dumps(device, indent=2) + "\n")
    if device["state"] != "Booted":
        command("xcrun", "simctl", "boot", udid)
    command("xcrun", "simctl", "bootstatus", udid, "-b", timeout=240)
    try:
        build_args = ["xcodebuild", "-project", str(args.project), "-scheme", "Snowman", "-configuration", "Release", "-sdk", "iphonesimulator", "-destination", f"id={udid}", "-derivedDataPath", str(args.build_root), "CODE_SIGNING_ALLOWED=NO", "build"]
        with (args.delivery / "simulator-build.log").open("w") as log:
            subprocess.run(build_args, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=600)
        app = args.build_root / "Build/Products/Release-iphonesimulator/Snowman.app"
        command("xcrun", "simctl", "install", udid, str(app))
        launch = command("xcrun", "simctl", "launch", "--terminate-running-process", udid, BUNDLE_ID, "--snowman-smoke-test")
        (args.delivery / "simulator-launch.txt").write_text(launch + "\n")
        container = Path(command("xcrun", "simctl", "get_app_container", udid, BUNDLE_ID, "data"))
        report = container / "Documents/snowman-smoke-result.json"
        deadline = time.monotonic() + 180
        while not report.exists() and time.monotonic() < deadline:
            time.sleep(2)
        if not report.is_file():
            raise RuntimeError("The running app did not produce a WebKit smoke result within 180 seconds")
        shutil.copyfile(report, args.delivery / "simulator-smoke-result.json")
        result = json.loads(report.read_text())
        diagnostics = result.get("diagnostics", {})
        if result.get("success") is not True:
            raise RuntimeError(f"WebKit runtime checks failed: {result}")
        if diagnostics.get("ready") is not True or diagnostics.get("gameLoaded") is not True or diagnostics.get("fatalError"):
            raise RuntimeError(f"SWF did not reach a usable runtime state: {diagnostics}")
        print("iOS Simulator WebKit checks passed:")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        screenshot = args.delivery / "simulator-screenshot.png"
        try:
            command("xcrun", "simctl", "io", udid, "screenshot", str(screenshot))
        except Exception as error:
            (args.delivery / "screenshot-error.txt").write_text(str(error) + "\n")
        try:
            logs = command("xcrun", "simctl", "spawn", udid, "log", "show", "--style", "compact", "--last", "5m", "--predicate", 'process == "Snowman"', timeout=45)
            (args.delivery / "simulator-runtime.log").write_text(logs + "\n")
        except Exception as error:
            (args.delivery / "simulator-log-error.txt").write_text(str(error) + "\n")
        command("xcrun", "simctl", "shutdown", udid)


if __name__ == "__main__":
    main()
