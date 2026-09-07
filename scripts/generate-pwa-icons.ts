import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const publicDir = resolve(process.cwd(), "public");
const source = resolve(publicDir, "images/brand/everflair-flair-mark.png");
const variants = [
  { filename: "apple-touch-icon-180.png", size: 180 },
  { filename: "icon-192.png", size: 192 },
  { filename: "icon-512.png", size: 512 },
  { filename: "icon-maskable-512.png", size: 512 },
];

async function main() {
  // One source for the favicon and install icons. The silhouette fits inside
  // the maskable safe circle; flat brand ink ignores raster color variation.
  const alpha = await sharp(source).resize(288, 288, { fit: "contain", background: "#00000000" })
    .extractChannel("alpha").toBuffer();
  const mark = await sharp({ create: { width: 288, height: 288, channels: 3, background: "#69499c" } })
    .joinChannel(alpha).png().toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#f6f3ed"/><image x="112" y="112" width="288" height="288" href="data:image/png;base64,${mark.toString("base64")}"/></svg>`;
  await Promise.all(["icon.svg", "icon-maskable.svg"].map(filename => writeFile(resolve(publicDir, filename), svg)));
  await Promise.all(
    variants.map(({ filename, size }) =>
      sharp(Buffer.from(svg))
        .resize(size, size)
        .flatten({ background: "#f6f3ed" })
        .png({ compressionLevel: 9 })
        .toFile(resolve(publicDir, filename)),
    ),
  );
}

void main();
