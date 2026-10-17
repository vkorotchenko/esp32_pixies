import importlib.util
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock
import zipfile

spec = importlib.util.spec_from_file_location("release", Path(__file__).parents[1] / "release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class VersionTests(unittest.TestCase):
    def test_bumps_and_monotonic_android_code(self):
        start = {"version": "1.2.3", "androidVersionCode": 41}
        for kind, version in (("major", "2.0.0"), ("minor", "1.3.0"), ("patch", "1.2.4")):
            self.assertEqual({"version": version, "androidVersionCode": 42}, release.bumped(start, kind))
        self.assertEqual("1.2.3", start["version"])

    def test_rejects_noncanonical_versions(self):
        for value in ("1.2.3.4", "01.2.3", "v1.2.3", "1.2", "1.2.3\n",
                      "1.2.3-beta.1", "1.2.-3", "1.2.٣", None, "1000000.0.0"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                release.version_parts(value)

    def test_rejects_invalid_or_exhausted_android_codes(self):
        for code in (0, -1, True, 1.5, 2100000001):
            with self.assertRaises(ValueError):
                release.validate_version({"version": "1.2.3", "androidVersionCode": code})
        with self.assertRaises(ValueError):
            release.bumped({"version": "1.2.3", "androidVersionCode": 2100000000}, "patch")

    def test_publication_rejects_version_or_android_code_reuse(self):
        previous = {"version": "1.2.3", "androidVersionCode": 41}
        release.validate_progress(previous, {"version": "1.2.4", "androidVersionCode": 42})
        for current in ({"version": "1.3.0", "androidVersionCode": 41},
                        {"version": "1.2.3", "androidVersionCode": 42},
                        {"version": "1.2.2", "androidVersionCode": 43}):
            with self.assertRaisesRegex(ValueError, "must increase"):
                release.validate_progress(previous, current)
    def test_consumers_are_synchronized(self):
        release.sync(check=True)

    def test_image_validator_can_be_imported_without_scons(self):
        path = Path(__file__).parents[1] / "check_build.py"
        specification = importlib.util.spec_from_file_location("check_build", path)
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        self.assertTrue(callable(module.check))
        module.check()


class PackagingTests(unittest.TestCase):
    def test_apksigner_36_and_37_formats_and_wrong_certificates(self):
        value = release.read_version()
        fingerprint = (release.ROOT / "android-signing.sha256").read_text().strip()
        badging = f"package: name='{release.PACKAGE}' versionCode='{value['androidVersionCode']}' versionName='{value['version']}'"
        with tempfile.TemporaryDirectory() as temporary:
            apk = Path(temporary) / "app.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr("assets/index.android.bundle", "offline bundle fixture")
            for prefix in ("Signer #1", "V2 Signer:", "V3.1 Signer:"):
                output = f"Number of signers: 1\n{prefix} certificate SHA-256 digest: {fingerprint}\n"
                with mock.patch.object(release, "android_tool", side_effect=lambda name: name), \
                        mock.patch.object(release, "run", side_effect=[badging, output]):
                    self.assertEqual(fingerprint, release.verify_apk(apk, value))
            for output in (
                f"Number of signers: 1\nSigner #1 certificate SHA-256 digest: {'0' * 64}\n",
                f"Number of signers: 2\nSigner #1 certificate SHA-256 digest: {fingerprint}\n",
                "Number of signers: 1\nUnrecognized certificate format\n",
            ):
                with mock.patch.object(release, "android_tool", side_effect=lambda name: name), \
                        mock.patch.object(release, "run", side_effect=[badging, output]), \
                        self.assertRaisesRegex(ValueError, "configured production certificate"):
                    release.verify_apk(apk, value)

    def package(self, root, changed_identity=None):
        value = {"version": "1.2.3", "androidVersionCode": 4}
        firmware, apk = root / "firmware.bin", root / "app.apk"
        firmware.write_bytes(b"firmware fixture")
        apk.write_bytes(b"APK boundary fixture")
        identity = {**value, "commit": "a" * 40, "localDirtyBuild": False,
                    "firmwareSha256": hashlib.sha256(firmware.read_bytes()).hexdigest()}
        identity.update(changed_identity or {})
        materials, notices = root / "firmware.zip", root / "mobile.zip"
        with zipfile.ZipFile(materials, "w") as archive:
            archive.writestr("build-identity.json", json.dumps(identity))
        with zipfile.ZipFile(notices, "w") as archive:
            archive.writestr("react-native/LICENSE", "MIT notice fixture")
        args = argparse.Namespace(firmware=firmware, apk=apk, firmware_materials=materials,
                                  mobile_materials=notices, output=root / "output", allow_dirty=False)
        with mock.patch.object(release, "sync", return_value=value), \
                mock.patch.object(release, "run", side_effect=["", "a" * 40]), \
                mock.patch.object(release, "verify_apk", return_value="b" * 64), \
                mock.patch.dict("sys.modules", {"check_build": types.SimpleNamespace(check=mock.Mock())}):
            release.package(args)
        return args.output

    def test_complete_distribution_has_matching_checksums_and_materials(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = self.package(Path(temporary))
            manifest = json.loads((output / "release.json").read_text())
            self.assertEqual("1.2.3", manifest["version"])
            self.assertIn("firmwareMaterials", manifest)
            self.assertIn("mobileNotices", manifest)
            for line in (output / "SHA256SUMS").read_text().splitlines():
                digest, name = line.split("  ")
                self.assertEqual(digest, hashlib.sha256((output / name).read_bytes()).hexdigest())
            self.assertEqual(6, len(list(output.iterdir())))

    def test_rejects_mismatched_source_version_hash_and_dirty_materials(self):
        for identity in ({"commit": "c" * 40}, {"version": "1.2.4"},
                         {"androidVersionCode": 5}, {"localDirtyBuild": True},
                         {"firmwareSha256": "0" * 64}):
            with self.subTest(identity=identity), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaisesRegex(ValueError, "do not match"):
                    self.package(Path(temporary), identity)


if __name__ == "__main__":
    unittest.main()
