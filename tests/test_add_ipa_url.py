"""Offline checks for GitHub Actions IPA-by-URL importer."""
from __future__ import annotations

import copy
import importlib.util
import pathlib
import plistlib
import struct
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("add_ipa_url", ROOT / "scripts" / "add_ipa_url.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def metadata():
    return {
        "bundleIdentifier": "com.demo.reader", "name": "Demo Reader",
        "version": "1.2", "buildVersion": "34", "minOSVersion": "17.0",
        "privacy": {"NSCameraUsageDescription": "Scan codes"},
        "entitlements": [],
    }


def version(url="https://example.com/demo.ipa"):
    return {
        "version": "1.2", "buildVersion": "34", "date": "2026-10-24",
        "downloadURL": url, "size": 12345,
        "localizedDescription": "更新说明",
    }


def app():
    return {
        "name": "Old name", "bundleIdentifier": "com.demo.reader",
        "developerName": "Original author",
        "localizedDescription": "Existing description",
        "iconURL": "https://example.com/old.png",
        "category": "utilities",
        "appPermissions": {"entitlements": ["com.apple.security.application-groups"],
                           "privacy": {}},
        "versions": [{"version": "1.0", "buildVersion": "30",
                      "date": "2026-01-01", "downloadURL": "https://example.com/v1.ipa",
                      "size": 1234}],
    }


class AddIpaURLTests(unittest.TestCase):
    def test_upstream_icon_selection(self):
        files = [
            "docs/screenshots/icon.png",
            "Design/WrapPin-AppIcon-Dark.png",
            "Design/WrapPin-AppIcon-Light.png",
            "WrapPin/Resources/Assets.xcassets/AppIcon.appiconset/WrapPin-AppIcon-Light.png",
        ]
        self.assertEqual(module.github_icon_path(files), "Design/WrapPin-AppIcon-Light.png")

    def test_notes_exclude_installation_chatter(self):
        body = "主要变化\n- 新增快捷指令\n- 修复连接问题\n\n下载与安装\n请下载文件\nSHA-256: abc"
        notes = module.brief_notes(body)
        self.assertIn("新增快捷指令", notes)
        self.assertNotIn("下载文件", notes)
        self.assertNotIn("SHA-256", notes)

    def test_new_app_published_first(self):
        original = {"name": "My Store", "apps": [app()], "news": []}
        updated, status = module.merge(
            original, {"bundleIdentifier": "org.other.app", "name": "Other App",
                       "privacy": {}, "entitlements": []},
            version(), icon="https://example.com/icon.png", developer="Official Developer"
        )
        self.assertEqual(status, "new-app")
        self.assertEqual(updated["apps"][0]["bundleIdentifier"], "org.other.app")
        self.assertEqual(updated["apps"][0]["iconURL"], "https://example.com/icon.png")
        self.assertEqual(updated["apps"][0]["developerName"], "Official Developer")
        self.assertEqual(original["apps"][0]["name"], "Old name")

    def test_existing_app_keeps_metadata(self):
        original = {"apps": [app()]}
        newer = version()
        newer["version"] = "1.3"
        newer["buildVersion"] = "35"
        updated, status = module.merge(original, metadata(), newer)
        self.assertEqual(status, "new-version")
        self.assertEqual(updated["apps"][0]["name"], "Old name")
        self.assertEqual(updated["apps"][0]["iconURL"], "https://example.com/old.png")
        self.assertEqual(len(updated["apps"][0]["versions"]), 2)
        self.assertEqual(updated["apps"][0]["versions"][0]["version"], "1.3")
        self.assertEqual(updated["apps"][0]["appPermissions"]["privacy"]["NSCameraUsageDescription"], "Scan codes")

    def test_same_version_skipped_by_default(self):
        original = {"apps": [app()]}
        original["apps"][0]["versions"].insert(0, version("https://example.com/original.ipa"))
        before = copy.deepcopy(original)
        after, status = module.merge(original, metadata(), version(), existing_mode="skip")
        self.assertEqual(status, "version-already-exists")
        self.assertEqual(after["apps"][0]["versions"][0]["downloadURL"],
                         "https://example.com/original.ipa")
        self.assertEqual(original, before)

    def test_same_version_replace_option(self):
        original = {"apps": [app()]}
        original["apps"][0]["versions"].insert(0, version("https://example.com/old.ipa"))
        after, status = module.merge(original, metadata(), version(), existing_mode="replace")
        self.assertEqual(status, "version-replaced")
        self.assertEqual(after["apps"][0]["versions"][0]["downloadURL"],
                         "https://example.com/demo.ipa")
        self.assertEqual(len(after["apps"][0]["versions"]), 2)

    def test_url_validation(self):
        with self.assertRaises(ValueError):
            module.valid_https("http://localhost/private.ipa")
        with self.assertRaises(ValueError):
            module.valid_https("https://127.0.0.1/private.ipa")

    def test_extract_embedded_icon(self):
        plist = {
            "CFBundleIdentifier": "com.demo.reader",
            "CFBundleName": "Demo Reader",
            "CFBundleShortVersionString": "1.2",
            "CFBundleVersion": "34",
            "CFBundleIconFiles": ["AppIcon60x60"],
        }
        png = (
            module.PNG + struct.pack(">I", 13) + b"IHDR"
            + struct.pack(">II", 120, 120) + bytes([8, 6, 0, 0, 0])
            + b"\0" * 110
        )
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "demo.ipa"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Payload/Demo.app/Info.plist", plistlib.dumps(plist))
                archive.writestr("Payload/Demo.app/AppIcon60x60@2x.png", png)
            self.assertEqual(module.ipa_png_icon(path), png)
            meta = module.ipa_metadata(path)
            self.assertEqual(meta["bundleIdentifier"], "com.demo.reader")

    def test_github_release_url_shape(self):
        uri = "https://github.com/suversal/WrapPin/releases/download/v1.0.19/WrapPin.ipa"
        match = module.RELEASE_PATH.match(module.urllib.parse.urlsplit(uri).path)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), "suversal")
        self.assertEqual(match.group(2), "WrapPin")


if __name__ == "__main__":
    unittest.main()
