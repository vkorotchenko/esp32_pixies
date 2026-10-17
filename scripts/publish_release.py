"""Stage a complete verified release, then expose it as latest atomically."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from release import REPO, ROOT, run, sync, validate_progress, version_parts


def command(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    if os.environ.get("GITHUB_REF") != "refs/heads/main":
        raise ValueError("Only main may publish production releases")
    value = sync(check=True)
    version = value["version"]
    tag = f"v{version}"
    source = run("git", "rev-parse", "HEAD")
    if source != os.environ.get("GITHUB_SHA"):
        raise ValueError("Release checkout does not match the workflow source")
    directory = ROOT / "dist/release"
    manifest = json.loads((directory / "release.json").read_text())
    if manifest.get("localDirtyBuild") or manifest["version"] != version or manifest["commit"] != source:
        raise ValueError("Refusing dirty or mismatched release artifacts")
    tags = run("git", "ls-remote", "origin", f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}")
    if tags:
        resolved = tags.splitlines()[-1].split()[0]
        if resolved != source:
            raise ValueError("Tag collision: this version points to another commit")
    releases = json.loads(run("gh", "api", f"repos/{REPO}/releases?per_page=100"))
    existing = next((item for item in releases if item["tag_name"] == tag), None)
    if existing and (not existing["draft"] or existing["target_commitish"] != source):
        raise ValueError("Version is already public or belongs to another source; do not overwrite it")
    previous = None
    for item in releases:
        if not item["draft"] and not item["prerelease"]:
            other = item["tag_name"]
            if other.startswith("v") and version_parts(other[1:]) >= version_parts(version):
                raise ValueError("A same/newer version is already published")
            if other.startswith("v") and (previous is None or version_parts(other[1:]) > version_parts(previous)):
                previous = other[1:]
    if previous is not None:
        url = f"https://github.com/{REPO}/releases/download/v{previous}/release.json"
        with urllib.request.urlopen(url, timeout=30) as response:
            body = response.read(16385)
        if len(body) > 16384:
            raise ValueError("Previous release manifest is too large")
        published = json.loads(body)
        if published["version"] != previous:
            raise ValueError("Previous release manifest does not match its tag")
        validate_progress({"version": published["version"],
                           "androidVersionCode": published["android"]["versionCode"]}, value)
    if not existing:
        command("gh", "release", "create", tag, "--repo", REPO, "--target", source,
                "--draft", "--title", f"Pixies {tag}", "--notes",
                "Shared Android app and ESP32-S3-N16R8 firmware release.\n\n"
                "Verify SHA256SUMS. Firmware updates preserve saved settings. "
                "BLE OTA requires firmware 0.3.0+; earlier firmware needs one USB/browser bootstrap. "
                "Switching from a development-signed Android app requires a one-time reinstall.")
    names = ("pixies-android.apk", "pixies-firmware.bin", "release.json", "SHA256SUMS",
             "pixies-firmware-materials.zip", "pixies-mobile-materials.zip")
    command("gh", "release", "upload", tag, "--repo", REPO, "--clobber",
            *(str(directory / name) for name in names))
    with tempfile.TemporaryDirectory(prefix="pixies-release-verify-") as temporary:
        command("gh", "release", "download", tag, "--repo", REPO, "--dir", temporary)
        for name in names:
            if hashlib.sha256((Path(temporary) / name).read_bytes()).digest() != \
                    hashlib.sha256((directory / name).read_bytes()).digest():
                raise ValueError(f"Uploaded release asset differs: {name}")
    command("gh", "release", "edit", tag, "--repo", REPO, "--draft=false", "--latest")
    url = f"https://github.com/{REPO}/releases/download/{tag}/release.json"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                actual = response.read(16385)
            if actual != (directory / "release.json").read_bytes():
                raise ValueError("Published manifest differs from verified artifacts")
            print(f"Published and verified {tag}: https://github.com/{REPO}/releases/tag/{tag}")
            return
        except (urllib.error.URLError, TimeoutError):
            if attempt == 4:
                raise
            time.sleep(5)
    raise ValueError("Published release could not be verified")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Release publication failed: {error}")
