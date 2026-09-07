import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { PWA_APPLE_ICON, PWA_ICONS } from "@/lib/pwa-icons";

describe("manifesto instalavel", () => {
  it("abre o painel em modo standalone com PNGs 192, 512 e mascarável", () => {
    const data = manifest();
    expect(data.name).toBe("Everflair");
    expect(data.short_name).toBe("Everflair");
    expect(data.theme_color).toBe("#131315");
    expect(data.background_color).toBe("#131315");
    expect(data.start_url).toBe("/");
    expect(data.display).toBe("standalone");
    expect(data.lang).toBe("pt-BR");
    expect(data.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", type: "image/png", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "maskable" }),
    ]));
  });

  it.each([
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-512.png", 512],
    [new URL(PWA_APPLE_ICON, "https://example.test").pathname.slice(1), 180],
  ])("mantém %s íntegro, quadrado e sem transparência", async (filename, size) => {
    const image = sharp(resolve(process.cwd(), "public", filename));
    const metadata = await image.metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(size);
    expect(metadata.height).toBe(size);
    expect(metadata.hasAlpha).toBe(false);

    // The install tile must be opaque graphite, with a visible mark wholly
    // inside the OS mask's safe circle (40% of the full width).
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([19, 19, 21]);
    let markPixels = 0;
    let maxMarkRadius = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels;
        if (data[offset] > 70) {
          markPixels++;
          maxMarkRadius = Math.max(maxMarkRadius,
            Math.hypot(x - (info.width - 1) / 2, y - (info.height - 1) / 2));
        }
      }
    }
    expect(markPixels).toBeGreaterThan(size * size * 0.08);
    expect(maxMarkRadius).toBeLessThan(info.width * 0.4);
  });

  it("atualiza o cache offline e inclui os ícones de instalação", () => {
    const serviceWorker = readFileSync(resolve(process.cwd(), "public", "sw.js"), "utf8");

    expect(serviceWorker).toContain('const CACHE = "everflair-shell-v5"');
    for (const src of [...PWA_ICONS.map(icon => icon.src), PWA_APPLE_ICON]) {
      expect(serviceWorker).toContain(JSON.stringify(src));
    }
    expect(serviceWorker).toContain("self.skipWaiting()");
    expect(serviceWorker).toContain("self.clients.claim()");
  });
});
