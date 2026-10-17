import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pngjs from "pngjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(path.join(root, "mobile/assets/pixies-icon.svg"), "utf8");
const android = path.join(root, "mobile/android/app/src/main/res");
const ios = path.join(root, "mobile/ios/Pixies/Images.xcassets/AppIcon.appiconset");
function write(name, data) {
  mkdirSync(path.dirname(name), { recursive: true });
  writeFileSync(name, data);
}
function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}
const foreground = source.replace(/<rect id="background"[^>]+\/>/, "");
const round = source
  .replace(/(<svg[^>]+>)/, '$1<defs><clipPath id="round"><circle cx="512" cy="512" r="512"/></clipPath></defs><g clip-path="url(#round)">')
  .replace("</svg>", "</g></svg>");
for (const [density, size] of [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]]) {
  write(path.join(android, `mipmap-${density}/ic_launcher.png`), render(source, size));
  write(path.join(android, `mipmap-${density}/ic_launcher_round.png`), render(round, size));
  write(path.join(android, `mipmap-${density}/ic_launcher_foreground.png`), render(foreground, size * 108 / 48));
}
for (const version of [26, 33]) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/pixies_icon_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
${version === 33 ? '    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>\n' : ""}</adaptive-icon>
`;
  for (const name of ["ic_launcher", "ic_launcher_round"]) {
    write(path.join(android, `mipmap-anydpi-v${version}/${name}.xml`), xml);
  }
}
write(path.join(android, "values/pixies_icon.xml"),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="pixies_icon_background">#101b34</color></resources>\n');
write(path.join(android, "drawable/ic_launcher_monochrome.xml"),
  '<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="1024" android:viewportHeight="1024"><path android:fillColor="#ffffff" android:pathData="M512,208 Q548,468 784,512 Q548,548 512,816 Q476,548 240,512 Q476,468 512,208Z"/></vector>\n');
const contents = JSON.parse(readFileSync(path.join(ios, "Contents.json"), "utf8"));
for (const image of contents.images) {
  const size = Number(image.size.split("x")[0]) * Number(image.scale.replace("x", ""));
  image.filename = `pixies-${size}.png`;
  const raster = pngjs.PNG.sync.read(render(source, size));
  write(path.join(ios, image.filename), pngjs.PNG.sync.write(raster, { colorType: 2, inputColorType: 6 }));
}
write(path.join(ios, "Contents.json"), JSON.stringify(contents, null, 2) + "\n");
console.log("Generated Android legacy/round/adaptive/monochrome and iOS icons.");
