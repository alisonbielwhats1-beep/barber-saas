import { resolve } from "node:path";
import sharp from "sharp";

const publicDir = resolve(process.cwd(), "public");
const source = resolve(publicDir, "icon-maskable.svg");
const variants = [
  { filename: "apple-touch-icon-180.png", size: 180 },
  { filename: "icon-192.png", size: 192 },
  { filename: "icon-512.png", size: 512 },
  { filename: "icon-maskable-512.png", size: 512 },
];

async function main() {
  await Promise.all(
    variants.map(({ filename, size }) =>
      sharp(source)
        .resize(size, size)
        .flatten({ background: "#2ecc8b" })
        .png({ compressionLevel: 9 })
        .toFile(resolve(publicDir, filename)),
    ),
  );
}

void main();
