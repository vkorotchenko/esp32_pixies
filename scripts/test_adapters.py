#!/usr/bin/env python3
"""Sanitized real-adapter tests using installed Arduino-ESP32 2.0.17 methods.

Run `pio test -e native` and install the pinned ESP32 environment first. No
framework source is vendored or edited: exact method definitions are extracted
into an isolated temporary build directory. All native suites also run without
this tool, using the executable compatibility shims in test/stubs.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]


def method(source, signature):
    start = source.index(signature)
    # These pinned definitions end with an unindented closing brace.
    end = source.index("\n}", start) + 2
    return source[start:end] + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--framework", type=pathlib.Path, default=pathlib.Path(
        os.environ.get("PLATFORMIO_CORE_DIR", pathlib.Path.home() / ".platformio")
    ) / "packages/framework-arduinoespressif32")
    parser.add_argument("--prove-regressions", action="store_true",
                        help="also require framing, concat and rollback fault mutations to fail")
    args = parser.parse_args()
    framework = args.framework.resolve()
    package = json.loads((framework / "package.json").read_text())
    version = (framework / "cores/esp32/esp_arduino_version.h").read_text()
    for part, expected in (("MAJOR", 2), ("MINOR", 0), ("PATCH", 17)):
        if not re.search(rf"#define ESP_ARDUINO_VERSION_{part}\s+{expected}\b", version):
            raise SystemExit("Need the project's pinned Arduino-ESP32 2.0.17 framework")
    if "sha.dcc1105b" not in package["version"]:
        raise SystemExit(f"Unexpected pinned framework revision: {package['version']}")
    string_source = (framework / "cores/esp32/WString.cpp").read_text()
    web_source = (framework / "libraries/WebServer/src/WebServer.cpp").read_text()
    definitions = method(string_source, "bool String::concat(const char *cstr, unsigned int length)")
    for signature in (
        "void WebServer::sendHeader(const String& name, const String& value, bool first)",
        "void WebServer::_prepareHeader(String& response, int code, const char* content_type, size_t contentLength)",
        "void WebServer::send(int code, const char* content_type, const String& content)",
        "void WebServer::send_P(int code, PGM_P content_type, PGM_P content, size_t contentLength)",
    ):
        definitions += method(web_source, signature)
    print(f"Framework: {framework} ({package['version']})", flush=True)
    print(f"Unmodified concat/header/send/send_P methods SHA256: "
          f"{hashlib.sha256(definitions.encode()).hexdigest()}", flush=True)
    unity = ROOT / ".pio/libdeps/native/Unity/src"
    arduino_json = ROOT / ".pio/libdeps/native/ArduinoJson/src"
    if not (unity / "unity.c").is_file() or not arduino_json.is_dir():
        raise SystemExit("Install native test dependencies first: platformio test -e native")
    build_root = ROOT / ".pio/build"
    build_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="adapter-sanitized-", dir=build_root) as tmp:
        build = pathlib.Path(tmp)
        pinned = build / "pinned_methods.h"
        pinned.write_text(definitions)
        sanitizer = ["-g", "-O1", "-fno-omit-frame-pointer", "-fsanitize=address,undefined",
                     "-fno-sanitize-recover=all"]
        cc = shlex.split(os.environ.get("CC", "clang"))
        cxx = shlex.split(os.environ.get("CXX", "clang++"))
        subprocess.run(cc + ["-std=c11", *sanitizer, "-I", str(unity), "-c",
                            str(unity / "unity.c"), "-o", str(build / "unity.o")], check=True)
        flags = ["-std=c++17", *sanitizer, "-Wall", "-Wextra", "-Werror"]
        for include in ("test/stubs", "src", "include", "lib/PixiesCore"):
            flags += ["-I", str(ROOT / include)]
        flags += ["-I", str(unity), "-I", str(arduino_json)]
        core = [str(ROOT / f"lib/PixiesCore/{name}.cpp") for name in ("Core", "SettingsJson", "Schedule", "ScheduleJson", "BleProtocol")]

        def run(suite, label, extra=(), expect=None):
            binary = build / label
            command = cxx + flags + list(extra)
            if suite == "http":
                command += [f'-DPIXIES_PINNED_METHODS="{pinned}"']
            command += [str(ROOT / f"test/test_{suite}/test_main.cpp"), *core,
                        str(build / "unity.o"), "-o", str(binary)]
            if sys.platform.startswith("linux"):
                command += ["-lcrypto"]
            print(f"\nBuilding {label} with ASan + UBSan", flush=True)
            subprocess.run(command, cwd=ROOT, check=True)
            environment = dict(os.environ, ASAN_OPTIONS="halt_on_error=1",
                               UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1")
            result = subprocess.run([str(binary)], cwd=ROOT, env=environment,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            if expect:
                if result.returncode == 0 or expect not in result.stdout:
                    print(result.stdout)
                    raise SystemExit(f"Mutation was not detected as expected: {label}")
                # Keep the diagnostic readable; the expected failure is not a
                # test-suite failure and no production files were changed.
                diagnostic = next(line for line in result.stdout.splitlines() if expect in line)
                print(f"Expected failure detected: {label}: {diagnostic}", flush=True)
                if label == "concat-fault":
                    if "READ of size 1025" not in result.stdout:
                        print(result.stdout)
                        raise SystemExit("Expected pinned concat's 1025-byte source read")
                    print("Confirmed pinned concat READ of size 1025 from a 1024-byte stack buffer", flush=True)
            else:
                print(result.stdout, end="", flush=True)
                result.check_returncode()

        run("http", "http-pinned")
        run("network", "network-real-state-machine")
        run("schedule_http", "schedule-real-routes")
        run("control", "schedule-control-and-ble")
        run("schedule", "schedule-pure-and-clock")
        if args.prove_regressions:
            receiver = (ROOT / "src/BoundedWebServer.cpp").read_text()
            framing = build / "framing_mutation.cpp"
            assert receiver.count("_contentLength=CONTENT_LENGTH_NOT_SET;") == 1
            framing.write_text(receiver.replace("_contentLength=CONTENT_LENGTH_NOT_SET;", "_contentLength=0;"))
            run("http", "framing-fault", [f'-DPIXIES_RECEIVER_SOURCE="{framing}"'], ":FAIL:")
            concat = build / "concat_mutation.cpp"
            assert receiver.count("sizeof buf-(upload_?0:1)") == 1
            assert receiver.count("        buf[got]=0;\n") == 1
            concat.write_text(receiver.replace("sizeof buf-(upload_?0:1)", "sizeof buf")
                              .replace("        buf[got]=0;\n", ""))
            run("http", "concat-fault", [f'-DPIXIES_RECEIVER_SOURCE="{concat}"',
                                       "-DPIXIES_BOUNDARY_ONLY"], "stack-buffer-overflow")
            network = (ROOT / "src/NetworkManager.cpp").read_text()
            rollback = build / "rollback_mutation.cpp"
            original = "  WiFi.disconnect(false,false);\n  attempting_="
            assert network.count(original) == 1
            rollback.write_text(network.replace(original,
                                                "  if(wifiSaved) WiFi.disconnect(false,false);\n  attempting_="))
            run("network", "rollback-fault", [f'-DPIXIES_NETWORK_SOURCE="{rollback}"'], ":FAIL:")
        print("\nAdapter sanitizer regressions: PASS (no hardware exercised)", flush=True)


if __name__ == "__main__":
    main()
