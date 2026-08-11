import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("frontend audit source regressions", () => {
  it("keeps login credentials out of a GET fallback and exposes accessible fields", () => {
    const login = source("src/app/(auth)/login/login-form.tsx");

    expect(login).toContain('<form method="post"');
    expect(login).toContain('autoComplete="email"');
    expect(login).toContain('autoComplete="current-password"');
    expect(login).toContain("aria-invalid");
    expect(login).toContain("Mostrar senha");
  });

  it("prevents the admin content from forcing horizontal overflow", () => {
    const layout = source("src/app/(admin)/layout.tsx");

    expect(layout).toMatch(/<main[^>]+min-w-0/);
    expect(layout).toMatch(/<main[^>]+overflow-x-hidden/);
  });

  it("keeps every period option reachable and touch-friendly on mobile", () => {
    const rangeFilter = source("src/app/(admin)/dashboard/range-filter.tsx");

    expect(rangeFilter).toContain("overflow-x-auto");
    expect(rangeFilter).toContain("whitespace-nowrap");
    expect(rangeFilter).toContain("min-h-11");
    expect(rangeFilter).toContain("aria-pressed");
  });

  it("offers the primary product action inside the empty state", () => {
    const products = source("src/app/(admin)/produtos/page.tsx");

    expect(products).toContain("Comece seu catálogo");
    expect(products).toMatch(/ProductForm[\s\S]+trigger=/);
  });
});
