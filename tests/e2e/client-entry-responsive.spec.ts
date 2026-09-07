import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("@database entrada do cliente mantém marca e controles inteiros em telas estreitas e baixas", async ({ page }) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente PostgreSQL descartável do CI.");
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    for (const route of ["welcome", "login", "cadastro", ""]) {
      await page.goto(`/book/luna-hair${route ? `/${route}` : ""}`);
      const logo = page.locator(".client-brand-logo");
      await expect(logo).toBeVisible();
      const bounds = await logo.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      await expect(page.getByRole("button", { name: /Ampliar logo/ })).toHaveCount(0);
      await expect(page.locator('a[href*="/agendar?service="] img')).toHaveCount(0);
      if (route === "login" || route === "cadastro") {
        const fontSize = await page.locator('input[type="email"]').evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
        expect(fontSize).toBeGreaterThanOrEqual(16);
      }
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
      if (width <= 390) await page.screenshot({ path: test.info().outputPath(`cliente-${route || "home"}-${width}.png`), fullPage: true });
    }
  }
});
