"""Regression tests for release pagination and imported-app retention."""
from __future__ import annotations

import importlib.util
import pathlib
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "sync_releases", ROOT / "scripts" / "sync_releases.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SyncReleasesTests(unittest.TestCase):
    def test_more_than_1000_github_releases_are_scanned(self):
        total = 1205
        calls = []

        def fake_api(path: str):
            page = int(path.split("page=")[-1])
            calls.append(page)
            start = (page - 1) * 100
            return [
                {"tag_name": f"tag-{index}", "draft": False, "assets": []}
                for index in range(start, min(total, start + 100))
            ]

        with mock.patch.object(module, "api_json", side_effect=fake_api):
            published = module.releases()

        self.assertEqual(len(published), 1205)
        self.assertEqual(published[-1]["tag_name"], "tag-1204")
        self.assertEqual(calls, list(range(1, 14)))

    def test_external_apps_survive_when_own_release_deleted(self):
        external_url = (
            "https://github.com/another/repo/releases/download/v1/demo.ipa"
        )
        local_url = (
            "https://github.com/zrhtop/ZZS-IPA-Store/releases/download/v1/old.ipa"
        )
        app = {
            "name": "Example", "bundleIdentifier": "com.example.package",
            "versions": [
                {"version": "2.0", "buildVersion": "2",
                 "downloadURL": external_url},
                {"version": "1.0", "buildVersion": "1",
                 "downloadURL": local_url},
            ],
        }
        result = module.generate({"name": "Example", "apps": [app]}, [])
        self.assertEqual(len(result["apps"]), 1)
        self.assertEqual(len(result["apps"][0]["versions"]), 1)
        self.assertEqual(result["apps"][0]["versions"][0]["downloadURL"],
                         external_url)

    def test_more_than_2000_manual_apps_are_preserved(self):
        originals = [
            {"bundleIdentifier": f"com.example.app{i}",
             "name": f"App {i}", "versions": [
                 {"version": "1.0", "buildVersion": "1",
                  "downloadURL": f"https://example.org/{i}.ipa"}
             ]}
            for i in range(2200)
        ]
        result = module.generate({"apps": originals}, [])
        self.assertEqual(len(result["apps"]), 2200)
        self.assertEqual(result["apps"][0]["bundleIdentifier"],
                         "com.example.app0")
        self.assertEqual(result["apps"][-1]["bundleIdentifier"],
                         "com.example.app2199")


if __name__ == "__main__":
    unittest.main()
