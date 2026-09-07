import { expect, test, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";

const routes = ["hoje", "dashboard", "agenda", "clientes", "profissionais", "servicos", "financeiro", "relatorios", "produtos", "fechamento", "portfolio", "notificacoes", "compartilhar", "avaliacoes", "pacotes", "configuracoes", "marketing", "pagamentos"];

for (const mode of ["desktop-light", "mobile-dark"]) {
  test.describe(`@database revisão visual ${mode}`, () => {
    test.describe.configure({ retries: 0 });
    test.skip(!process.env.RUN_DATABASE_E2E, "Somente ambiente isolado.");
    let state: Awaited<ReturnType<BrowserContext["storageState"]>>;
    test.beforeAll(async ({ browser }) => {
      test.setTimeout(90_000);
      assertSafeDatabaseOperation(process.env, { operation: "product-audit-browser" });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        const page = await context.newPage();
        await page.goto(`${process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100"}/login`);
        await page.getByLabel("Email").fill("dono@lunahair.com");
        await page.getByLabel("Senha", { exact: true }).fill("demo1234");
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
        if (mode.endsWith("light")) {
          await page.getByRole("button", { name: "Mudar para tema claro" }).click({ timeout: 15_000 });
          await expect(page.locator("html")).toHaveAttribute("data-theme", "admin-light");
        }
        state = await context.storageState();
      } finally { await context.close(); }
    });

    for (const route of routes) {
      test(`${route}: contraste, distribuição e acessibilidade`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.context().addCookies(state.cookies);
        // Restore the preference chosen through the real theme control above.
        await page.addInitScript(origins => {
          for (const item of origins.find(o => o.origin === location.origin)?.localStorage ?? []) localStorage.setItem(item.name, item.value);
        }, state.origins);
        await page.setViewportSize(mode.startsWith("desktop") ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        const runtime: string[] = [];
        page.on("pageerror", e => runtime.push(e.message));
        await page.goto(`/${route}`, { timeout: 60_000 });
        await expect(page.locator("main h1").first()).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("main .animate-shimmer")).toHaveCount(0, { timeout: 30_000 });
        await page.screenshot({ path: test.info().outputPath(`${mode}-${route}.png`), animations: "disabled", timeout: 20_000 });
        const results = await test.step("Examinar acessibilidade", () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(), { timeout: 45_000 });
        const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
        const violations = results.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }));
        await test.info().attach("audit-issues.json", { body: JSON.stringify({ route, mode, violations, overflow, runtime }, null, 2), contentType: "application/json" });
        const main = page.locator("main");
        if (await main.evaluate(el => el.scrollHeight > el.clientHeight + 20)) {
          await main.evaluate(el => { el.scrollTop = el.scrollHeight; });
          await page.screenshot({ path: test.info().outputPath(`${mode}-${route}-bottom.png`), animations: "disabled", timeout: 20_000 });
        }
        expect(runtime).toEqual([]);
        expect(overflow).toBeLessThanOrEqual(1);
        expect(violations).toEqual([]);
      });
    }
  });
}
