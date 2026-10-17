"""PlatformIO post-build and standalone partition/slot validation."""
import csv
import pathlib
import sys
import struct
import hashlib

if "__file__" in globals():
    ROOT = pathlib.Path(__file__).resolve().parents[1]
else:
    Import("env")
    ROOT = pathlib.Path(env.subst("$PROJECT_DIR"))
FLASH = 16 * 1024 * 1024

def check(image=None):
    rows = []
    with (ROOT / "partitions.csv").open() as handle:
        for row in csv.reader(line for line in handle if not line.lstrip().startswith("#")):
            if not row:
                continue
            name, kind, subtype, offset, size = (v.strip() for v in row[:5])
            rows.append((name, kind, subtype, int(offset, 0), int(size, 0)))
    end = 0x9000
    slots = []
    for name, kind, subtype, offset, size in rows:
        assert offset >= end and size > 0, f"Overlap/invalid: {name}"
        assert offset + size <= FLASH, f"Beyond 16MB: {name}"
        if kind == "app":
            assert offset % 0x10000 == 0, f"App alignment: {name}"
            slots.append((subtype, size))
        end = offset + size
    assert [x[0] for x in slots] == ["ota_0", "ota_1"], "Need two OTA slots"
    assert slots[0][1] == slots[1][1], "OTA slots differ"
    assert any(r[2] == "ota" and r[4] >= 0x2000 for r in rows), "OTA metadata missing"
    if image:
        length = pathlib.Path(image).stat().st_size
        assert 288 <= length <= min(s[1] for s in slots), "Image does not fit OTA slot"
        data = pathlib.Path(image).read_bytes()
        assert data[0] == 0xE9 and 1 <= data[1] <= 16, "Not an ESP application image"
        assert data[3] >> 4 == 4, "Image header is not 16MB flash"
        assert struct.unpack_from("<H", data, 12)[0] == 9, "Image is not ESP32-S3"
        assert data[23] == 1, "Image must include a SHA256 digest"
        assert struct.unpack_from("<I", data, 32)[0] == 0xABCD5432, "Not an app image"
        offset = 24
        for _ in range(data[1]):
            segment_length = struct.unpack_from("<I", data, offset + 4)[0]
            offset += 8 + segment_length
            assert offset <= length, "Truncated segment"
        hash_offset = (offset + 16) // 16 * 16
        assert hash_offset + 32 == length, "Trailing or truncated image data"
        assert hashlib.sha256(data[:hash_offset]).digest() == data[hash_offset:], "Image digest mismatch"
        print(f"Image {length} bytes; OTA slot {slots[0][1]} bytes; flash 16MB: PASS")
    else:
        print(f"Partition layout: two {slots[0][1]} byte OTA slots inside 16MB: PASS")

if __name__ == "__main__":
    check(sys.argv[1] if len(sys.argv) > 1 else None)
elif "__file__" not in globals():
    Import("env")
    def after_build(source, target, env):
        check(env.subst("$BUILD_DIR/${PROGNAME}.bin"))
    env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", after_build)
