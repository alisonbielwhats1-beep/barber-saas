import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("configuração do otimizador de imagens", () => {
  it("usa o host Supabase configurado e limita o caminho ao bucket público", () => {
    const source = readFileSync(resolve(process.cwd(), "next.config.mjs"), "utf8");

    expect(source).toContain("process.env.SUPABASE_URL");
    expect(source).toContain('pathname: "/storage/v1/object/public/salon-assets/**"');
    expect(source).not.toContain('hostname: "*.supabase.co"');
    expect(source).toContain("qualities: [75, 85, 95]");
  });

  it("publica cabeçalhos defensivos sem liberar frame ou objeto externo", () => {
    const source = readFileSync(resolve(process.cwd(), "next.config.mjs"), "utf8");

    expect(source).toContain('key: "Content-Security-Policy"');
    expect(source).toContain('key: "Strict-Transport-Security"');
    expect(source).toContain('"object-src \'none\'"');
    expect(source).toContain('"frame-ancestors \'self\'"');
    expect(source).toContain('"base-uri \'self\'"');
  });
});
