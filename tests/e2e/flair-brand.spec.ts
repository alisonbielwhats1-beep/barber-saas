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

test("@database Flair abre o app do cliente independentemente do painel", async ({ page, request }) => {
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
  await expect(intro).toHaveCSS("background-color", "rgb(17, 27, 25)");
  const light = intro.locator(".ef-intro-light");
  await expect(light).toHaveCSS("animation-name", "ef-client-aurora");
  await expect(light).toHaveCSS("animation-duration", "2.2s");
  await page.evaluate(() => document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 600; }));
  await page.screenshot({ path: test.info().outputPath("flair-entrada-cliente.png") });
  await page.clock.runFor(2200);
  await expect(intro).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Entrar na minha conta" })).toBeVisible();
  await page.getByRole("link", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL(/\/book\/luna-hair\/login/);
  await expect(page.locator(".ef-intro")).toHaveCount(0);
  await page.reload();
  await expect(intro).toBeAttached();
  await page.clock.runFor(2200);
  await expect(intro).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.locator(".ef-intro")).toHaveCount(0);

  // The client keeps its own installed destination but uses the Everflair
  // install tile, including the explicit Apple fallback in the rendered HTML.
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(appleIcon).toContain("apple-touch-icon-180.png?v=flair-dark-1");
  expect((await request.get(appleIcon!)).headers()["content-type"]).toContain("image/png");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/book/luna-hair/manifest.webmanifest");
  const manifest = await (await request.get(manifestHref!)).json();
  expect(manifest.start_url).toBe("/book/luna-hair/welcome");
  expect(manifest.background_color).toBe("#131315");
  expect(manifest.icons.every((icon: { src: string }) => icon.src.includes("v=flair-dark-1"))).toBe(true);
});
