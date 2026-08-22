import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const LANDING_IMAGE_MASTERS = [
  "salon-hero-aesthetics-v1.webp",
  "salon-hero-aesthetics-v2.webp",
  "salon-hero-barber-v2.webp",
  "salon-hero-beard-v1.webp",
  "salon-hero-male-haircut-v1.webp",
  "salon-hero-manicure-v1.webp",
  "salon-hero-massage-v1.webp",
  "salon-hero-massage-v2.webp",
  "salon-hero-stylist-v1.webp",
  "salon-hero-stylist-v2.webp",
] as const;

describe("masters fotográficos da landing", () => {
  it.each(LANDING_IMAGE_MASTERS)(
    "preserva resolução e fonte sem compressão destrutiva: %s",
    async (filename) => {
      const filepath = join(process.cwd(), "public", "images", filename);
      const contents = readFileSync(filepath);
      const { size } = statSync(filepath);

      expect(contents.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(contents.subarray(8, 12).toString("ascii")).toBe("WEBP");
      const metadata = await sharp(filepath).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;

      expect(width).toBeGreaterThanOrEqual(1_500);
      expect(height).toBeGreaterThanOrEqual(850);
      expect(size).toBeGreaterThanOrEqual(30_000);
    },
  );
});
