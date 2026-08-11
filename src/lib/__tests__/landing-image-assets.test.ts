import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LANDING_IMAGE_MASTERS = [
  "salon-hero-aesthetics-v1-hq.png",
  "salon-hero-aesthetics-v2-hq.png",
  "salon-hero-barber-v2-hq.png",
  "salon-hero-beard-v1-hq.png",
  "salon-hero-male-haircut-v1-hq.png",
  "salon-hero-manicure-v1-hq.png",
  "salon-hero-massage-v1-hq.png",
  "salon-hero-massage-v2-hq.png",
  "salon-hero-stylist-v1-hq.png",
  "salon-hero-stylist-v2-hq.png",
] as const;

describe("masters fotográficos da landing", () => {
  it.each(LANDING_IMAGE_MASTERS)(
    "preserva resolução e fonte sem compressão destrutiva: %s",
    (filename) => {
      const filepath = join(process.cwd(), "public", "images", filename);
      const contents = readFileSync(filepath);
      const { size } = statSync(filepath);

      expect(contents.subarray(1, 4).toString("ascii")).toBe("PNG");

      const width = contents.readUInt32BE(16);
      const height = contents.readUInt32BE(20);

      expect(width).toBeGreaterThanOrEqual(1_500);
      expect(height).toBeGreaterThanOrEqual(850);
      expect(size).toBeGreaterThanOrEqual(1_000_000);
    },
  );
});
