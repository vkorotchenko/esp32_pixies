import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[2]


def dimensions(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not PNG: {path}")
    return struct.unpack(">II", data[16:24]), data[25]


class IconsTests(unittest.TestCase):
    def test_every_ios_declared_icon_has_exact_size_and_no_alpha_channel(self):
        directory = ROOT / "mobile/ios/Pixies/Images.xcassets/AppIcon.appiconset"
        for image in json.loads((directory / "Contents.json").read_text())["images"]:
            size = int(float(image["size"].split("x")[0]) * float(image["scale"][:-1]))
            shape, color_type = dimensions(directory / image["filename"])
            self.assertEqual((size, size), shape)
            self.assertEqual(2, color_type, "iOS icons must be opaque RGB, not RGBA")

    def test_android_density_sizes_and_adaptive_assets(self):
        directory = ROOT / "mobile/android/app/src/main/res"
        for density, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96),
                              ("xxhdpi", 144), ("xxxhdpi", 192)):
            for name in ("ic_launcher", "ic_launcher_round"):
                self.assertEqual((size, size), dimensions(directory / f"mipmap-{density}/{name}.png")[0])
            foreground = int(size * 108 / 48)
            self.assertEqual((foreground, foreground),
                             dimensions(directory / f"mipmap-{density}/ic_launcher_foreground.png")[0])
        for api in (26, 33):
            self.assertTrue((directory / f"mipmap-anydpi-v{api}/ic_launcher.xml").is_file())


if __name__ == "__main__":
    unittest.main()
