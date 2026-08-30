import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { PWA_APPLE_ICON } from "@/lib/pwa-icons";

describe("manifesto instalavel", () => {
  it("abre o painel em modo standalone com PNGs 192, 512 e mascarável", () => {
    const data = manifest();
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
    [PWA_APPLE_ICON.slice(1), 180],
  ])("mantém %s íntegro, quadrado e sem transparência", async (filename, size) => {
    const image = sharp(resolve(process.cwd(), "public", filename));
    const metadata = await image.metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(size);
    expect(metadata.height).toBe(size);
    expect(metadata.hasAlpha).toBe(false);
  });

  it("atualiza o cache offline e inclui os ícones de instalação", () => {
    const serviceWorker = readFileSync(resolve(process.cwd(), "public", "sw.js"), "utf8");

    expect(serviceWorker).toContain('const CACHE = "salonsaas-shell-v2"');
    expect(serviceWorker).toContain('"/icon-192.png"');
    expect(serviceWorker).toContain('"/icon-512.png"');
    expect(serviceWorker).toContain('"/icon-maskable-512.png"');
    expect(serviceWorker).toContain("self.skipWaiting()");
    expect(serviceWorker).toContain("self.clients.claim()");
  });
});
