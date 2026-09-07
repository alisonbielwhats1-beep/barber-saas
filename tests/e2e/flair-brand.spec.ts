import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("@static Flair mantém contraste e lilás discreto na landing", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Os três motores já verificam as rotas públicas.");
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    for (const name of ["Salão de beleza", "Barbearia", "Espaço misto"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".mk-header .ef-logo")).toBeVisible();
      const mask = await page.locator(".mk-header .ef-logo").evaluate(el => getComputedStyle(el).maskImage);
      expect(mask).toContain("everflair-flair-logo.png");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`flair-landing-${width}-${name}.png`), animations: "disabled" });
    }
  }
  expect(errors).toEqual([]);
});

test("@database Flair abre o app do cliente independentemente do painel", async ({ page }) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente PostgreSQL descartável do CI.");
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/login");
  await expect(page.locator('.ef-intro[data-audience="admin"]')).toBeAttached();
  await page.clock.runFor(1400);
  await page.goto("/book/luna-hair/welcome");
  const intro = page.locator('.ef-intro[data-audience="client"]');
  await expect(intro).toBeAttached();
  await page.evaluate(() => document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 600; }));
  await page.screenshot({ path: test.info().outputPath("flair-entrada-cliente.png") });
  await page.clock.runFor(1400);
  await expect(intro).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Entrar na minha conta" })).toBeVisible();
  await page.getByRole("link", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL(/\/book\/luna-hair\/login/);
  await expect(page.locator(".ef-intro")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.locator(".ef-intro")).toHaveCount(0);
});
