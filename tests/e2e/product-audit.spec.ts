import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";

test.describe("@database revisão visual e acessibilidade", () => {
  test.describe.configure({ retries: 0 });
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente ambiente isolado.");
  test("revisa todas as áreas do estabelecimento nos dois temas e tamanhos", async ({ page }) => {
    test.setTimeout(900_000);
    assertSafeDatabaseOperation(process.env, { operation: "product-audit-browser" });
    const runtime: string[] = []; page.on("pageerror", e => runtime.push(e.message));
    await page.goto("/login");
    await page.getByLabel("Email").fill("dono@lunahair.com");
    await page.getByLabel("Senha", { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
    const issues: { route: string; mode: string; violations: unknown[]; overflow: number }[] = [];
    const routes = ["hoje", "dashboard", "agenda", "clientes", "profissionais", "servicos", "financeiro", "relatorios", "produtos", "fechamento", "portfolio", "notificacoes", "compartilhar", "avaliacoes", "pacotes", "configuracoes", "marketing", "pagamentos"];
    for (const mode of ["desktop-light", "mobile-dark"]) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      // Change the persisted theme through the actual user control.
      const toggle = page.getByRole("button", { name: mode.endsWith("light") ? "Mudar para tema claro" : "Mudar para tema escuro" });
      if (await toggle.isVisible()) await toggle.click();
      await page.setViewportSize(mode.startsWith("desktop") ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
      for (const route of routes) {
        await test.step(`${mode}: ${route}`, async () => {
        await page.goto(`/${route}`, { timeout: 90_000 });
        await expect(page.locator("main")).toBeVisible();
        await page.locator("main h1").first().waitFor({ state: "visible", timeout: 45_000 });
        await page.screenshot({ path: test.info().outputPath(`${mode}-${route}.png`), fullPage: true, animations: "disabled", timeout: 30_000 });
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
        if (results.violations.length || overflow > 1) issues.push({ route, mode, violations: results.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), overflow });
        await test.info().attach(`${mode}-${route}-audit.json`, { body: JSON.stringify({ violations: results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), overflow }, null, 2), contentType: "application/json" });
        });
      }
    }
    await test.info().attach("audit-issues.json", { body: JSON.stringify({ issues, runtime }, null, 2), contentType: "application/json" });
    expect(runtime).toEqual([]);
    expect(issues).toEqual([]);
  });
});
