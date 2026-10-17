"""Retain release source, firmware relink inputs, and installed mobile notices."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile
from release import ROOT, TARGET, read_version, run


def private(path):
    return any(part == ".env" or part.startswith(".env.") for part in path.parts) or (
        path.suffix.lower() in (".p12", ".pfx", ".jks", ".keystore") and
        path.as_posix() != "mobile/android/app/debug.keystore")


def add_tree(archive, directory, prefix, objects_only=False):
    if not directory.is_dir():
        raise ValueError(f"Missing release materials: {directory}")
    count = 0
    for path in sorted(directory.rglob("*")):
        relative = path.relative_to(directory)
        if path.is_symlink() or private(relative) or ".git" in relative.parts:
            continue
        if path.is_file() and (not objects_only or path.suffix in (".o", ".a", ".elf", ".map", ".bin", ".ld")):
            archive.write(path, f"{prefix}/{relative.as_posix()}")
            count += 1
    if not count:
        raise ValueError(f"No release materials found: {directory}")


def firmware(output, pio, allow_dirty):
    dirty = bool(run("git", "status", "--porcelain", "--untracked-files=no"))
    if dirty and not allow_dirty:
        raise ValueError("Commit source before packaging public build materials")
    build = ROOT / ".pio/build" / TARGET
    framework = Path(os.environ.get("PLATFORMIO_CORE_DIR", Path.home() / ".platformio")) / "packages/framework-arduinoespressif32"
    packages = subprocess.check_output([pio, "pkg", "list", "-e", TARGET], cwd=ROOT, text=True)
    paths = run("git", "ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0")
    roots = {"boards", "include", "lib", "src", "scripts", "test", "web", "docs", "mobile", ".github"}
    files = {"Makefile", "version.json", "android-signing.sha256", "platformio.ini", "partitions.csv",
             "package.json", "package-lock.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", ".gitignore"}
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(set(paths)):
            path = Path(name)
            if name and (path.parts[0] in roots or name in files) and not private(path):
                if (ROOT / path).is_symlink():
                    raise ValueError(f"Unexpected source symlink: {path}")
                archive.write(ROOT / path, f"source/{name}")
        add_tree(archive, build, "firmware-objects", objects_only=True)
        add_tree(archive, ROOT / ".pio/libdeps" / TARGET, "firmware-libraries")
        add_tree(archive, framework, "arduino-framework")
        archive.writestr("resolved-platformio-packages.txt", packages)
        archive.writestr("build-identity.json", json.dumps({
            **read_version(), "commit": run("git", "rev-parse", "HEAD"),
            "localDirtyBuild": dirty,
            "firmwareSha256": hashlib.sha256((build / "firmware.bin").read_bytes()).hexdigest(),
        }, indent=2))
        archive.writestr("README.txt",
            "See source/README.md and THIRD_PARTY_NOTICES.md. All Pixies source is included.\n"
            "Firmware objects, archives, ELF/map, unchanged library sources and the complete\n"
            "installed Arduino framework/SDK are retained for replacement and relinking.\n"
            "Install PlatformIO Core 6.2.0 and the exact packages listed in\n"
            "resolved-platformio-packages.txt. From source/, run make firmware, replace\n"
            ".pio/libdeps/esp32s3_n16r8 with firmware-libraries (including your changes),\n"
            "and run make firmware again. Restore arduino-framework to PlatformIO's\n"
            "framework-arduinoespressif32 package directory for the exact SDK inputs.\n"
            "Firmware is not signature-locked: install the resulting application using\n"
            "authenticated browser OTA or USB. USB recovery requires no signing key.\n"
            "No private Android release key is included or needed to rebuild firmware.\n")


def mobile(output):
    modules = ROOT / "mobile/node_modules"
    if not modules.is_dir():
        raise ValueError("Restore mobile dependencies before packaging their notices")
    count = 0
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(modules.rglob("*")):
            name = path.name.lower()
            if path.is_file() and not path.is_symlink() and name.startswith(("license", "licence", "notice", "copying")):
                if any(part in ("build", ".gradle", ".cxx") for part in path.relative_to(modules).parts):
                    continue
                archive.write(path, path.relative_to(modules).as_posix())
                count += 1
        if not count:
            raise ValueError("Installed mobile dependency notices are missing")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("firmware", "mobile"))
    parser.add_argument("--pio", default=str(Path.home() / ".platformio/penv/bin/platformio"))
    parser.add_argument("--allow-dirty", action="store_true")
    args = parser.parse_args()
    directory = ROOT / "dist/materials"
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / f"pixies-{args.kind}-materials.zip"
    if args.kind == "firmware":
        firmware(output, args.pio, args.allow_dirty)
    else:
        mobile(output)
    print(f"Retained {args.kind} release materials: {output}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Release materials failed: {error}")
