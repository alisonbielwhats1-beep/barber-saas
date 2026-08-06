import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_ROLES,
  FINANCIAL_ROLES,
  MANAGEMENT_ROLES,
  MARKETING_ROLES,
} from "../role-permissions";

describe("matriz de permissões do painel", () => {
  it("mantém os conjuntos de papéis explícitos", () => {
    expect(MANAGEMENT_ROLES).toEqual(["OWNER", "MANAGER"]);
    expect(FINANCIAL_ROLES).toEqual(["SUPER_ADMIN", "OWNER", "MANAGER"]);
    expect(DASHBOARD_ROLES).toEqual([
      "SUPER_ADMIN",
      "OWNER",
      "MANAGER",
      "RECEPTIONIST",
    ]);
    expect(MARKETING_ROLES).toEqual(["OWNER", "MANAGER", "RECEPTIONIST"]);
  });

  it("faz os menus consumirem a matriz central, sem listas locais divergentes", () => {
    const sidebar = readFileSync(
      join(process.cwd(), "src/app/(admin)/sidebar-nav.tsx"),
      "utf8",
    );
    const mobile = readFileSync(
      join(process.cwd(), "src/app/(admin)/mobile-nav.tsx"),
      "utf8",
    );
    const palette = readFileSync(
      join(process.cwd(), "src/app/(admin)/command-palette.tsx"),
      "utf8",
    );

    for (const source of [sidebar, mobile, palette]) {
      expect(source).toContain("DASHBOARD_ROLES");
      expect(source).toContain("MANAGEMENT_ROLES");
    }
    expect(sidebar).toContain("roles: FINANCIAL_ROLES");
    expect(sidebar).toContain("roles: MARKETING_ROLES");
    expect(palette).toContain("roles: FINANCIAL_ROLES");
    expect(palette).toContain("roles: MARKETING_ROLES");
  });

  it("protege também as URLs diretas das páginas sensíveis", () => {
    const guardedRoutes = [
      ["src/app/(admin)/produtos/page.tsx", "requireRole(MANAGEMENT_ROLES)"],
      ["src/app/(admin)/pacotes/page.tsx", "requireRole(MANAGEMENT_ROLES)"],
      ["src/app/(admin)/configuracoes/page.tsx", "requireRole(MANAGEMENT_ROLES)"],
      ["src/app/(admin)/marketing/page.tsx", "requireRole(MARKETING_ROLES)"],
      ["src/app/(admin)/dashboard/page.tsx", "requireRole(DASHBOARD_ROLES)"],
    ] as const;

    for (const [relativePath, guard] of guardedRoutes) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).toContain(guard);
    }
  });
});
