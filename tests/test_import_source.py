"""Offline regression checks for the AltStore source importer."""
from __future__ import annotations

import copy
import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("import_source", ROOT / "scripts" / "import_source.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def version(number: str, build: str, url: str) -> dict:
    return {
        "version": number,
        "buildVersion": build,
        "date": "2026-10-24",
        "downloadURL": url,
        "size": 123456,
    }


def app(bundle="com.example.sample", versions=None) -> dict:
    return {
        "name": "Sample App",
        "bundleIdentifier": bundle,
        "developerName": "Original Developer",
        "localizedDescription": "A sample app",
        "iconURL": "https://example.com/icon.png",
        "appPermissions": {
            "entitlements": ["com.apple.security.application-groups"],
            "privacy": {"NSCameraUsageDescription": "Take photos"},
        },
        "versions": versions if versions is not None else [
            version("1.0", "1", "https://example.com/releases/v1.ipa")
        ],
    }


class ImportSourceTests(unittest.TestCase):
    def test_valid_app_and_attribution_preserved(self):
        cleaned, message = module.clean_app(app())
        self.assertEqual(message, "")
        self.assertEqual(cleaned["developerName"], "Original Developer")
        self.assertEqual(cleaned["versions"][0]["downloadURL"], "https://example.com/releases/v1.ipa")
        self.assertEqual(cleaned["appPermissions"]["privacy"]["NSCameraUsageDescription"], "Take photos")

    def test_add_only_does_not_overwrite_existing(self):
        existing = {"name": "My source", "apps": [app()]}
        upstream = {"apps": [app(versions=[version("2.0", "2", "https://example.com/v2.ipa")])]}
        original = copy.deepcopy(existing)
        updated, report = module.import_apps(
            existing, upstream, mode="add-only", bundles=set()
        )
        self.assertEqual(updated, original)
        self.assertEqual(existing, original)
        self.assertEqual(report["added"], 0)

    def test_merge_new_versions_without_changing_latest(self):
        existing = {"name": "My source", "apps": [app()]}
        upstream = {"apps": [app(versions=[
            version("2.0", "2", "https://example.com/v2.ipa"),
            version("1.0", "1", "https://example.com/v1.ipa"),
        ])]}
        updated, report = module.import_apps(
            existing, upstream, mode="merge-versions", bundles=set()
        )
        versions = updated["apps"][0]["versions"]
        self.assertEqual(len(versions), 2)
        self.assertEqual(versions[0]["version"], "1.0")
        self.assertEqual(versions[1]["version"], "2.0")
        self.assertEqual(report["versions_added"], 1)

    def test_import_selection(self):
        upstream = {"apps": [app("com.example.one"), app("com.example.two")]}
        updated, report = module.import_apps(
            {"apps": []}, upstream,
            mode="add-only", bundles={"com.example.two"}
        )
        self.assertEqual(report["added"], 1)
        self.assertEqual(updated["apps"][0]["bundleIdentifier"], "com.example.two")

    def test_restricted_apps_rejected(self):
        protected = app()
        protected["patreon"] = {"tiers": ["paid-tier"]}
        updated, report = module.import_apps(
            {"apps": []}, {"apps": [protected]}, mode="add-only", bundles=set()
        )
        self.assertEqual(updated["apps"], [])
        self.assertEqual(report["skipped"], 1)

    def test_nsfw_source_rejected(self):
        with self.assertRaises(ValueError):
            module.import_apps(
                {"apps": []}, {"nsfw": True, "apps": [app()]},
                mode="add-only", bundles=set()
            )

    def test_http_download_rejected(self):
        damaged = app(versions=[version("1.0", "1", "http://example.com/app.ipa")])
        cleaned, _ = module.clean_app(damaged)
        self.assertIsNone(cleaned)

    def test_invalid_bundle_rejected(self):
        damaged = app(bundle="not a valid bundle")
        cleaned, _ = module.clean_app(damaged)
        self.assertIsNone(cleaned)

    def test_missing_selected_bundle_is_error(self):
        with self.assertRaises(ValueError):
            module.import_apps(
                {"apps": []}, {"apps": [app()]},
                mode="add-only", bundles={"com.example.doesnotexist"}
            )


if __name__ == "__main__":
    unittest.main()
