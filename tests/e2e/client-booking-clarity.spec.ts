import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("@database catálogo sem login mantém escolha, contraste e leitura nos dois temas", async ({ page }) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente PostgreSQL descartável.");
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/book/luna-hair/agendar");
    for (const mode of ["light", "dark"]) {
      const target = mode === "light" ? "Usar tema claro" : "Usar tema escuro";
      const toggle = page.getByRole("button", { name: target });
      if (await toggle.count()) await toggle.click();
      await expect(page.locator(".client-app")).toHaveAttribute("data-theme", `salon-${mode}`);
      await expect(page.getByRole("heading", { name: "Escolha os serviços" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Selecione um serviço para continuar" })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      const row = page.locator(".client-service-row").first();
      // Long names/descriptions retain natural height, without clipping or line clamps.
      expect(await row.evaluate(element => element.scrollHeight <= element.clientHeight + 2)).toBe(true);
      const tray = await page.locator("[data-booking-tray]").boundingBox();
      expect(tray!.x).toBeGreaterThanOrEqual(0);
      expect(tray!.x + tray!.width).toBeLessThanOrEqual(width + 1);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`catalogo-${width}-${mode}.png`) });
    }
  }
  await page.getByRole("button", { name: /Corte feminino/ }).click();
  await page.getByRole("button", { name: /Escolher (profissional|horário)/ }).click();
  await page.getByRole("button", { name: /Camila/ }).click();
  const dates = page.locator('button[aria-label*=" de "]');
  let chosen = false;
  for (let index = 0; index < await dates.count(); index += 1) {
    const date = dates.nth(index);
    if (await date.isDisabled()) continue;
    await date.click();
    const slot = page.getByRole("button", { name: /^Horário \d{2}:\d{2}/ }).first();
    try { await slot.waitFor({ state: "visible", timeout: 1500 }); await slot.click(); chosen = true; break; }
    catch { /* Try the next working day in the synthetic calendar. */ }
  }
  expect(chosen).toBe(true);
  await page.getByRole("button", { name: "Revisar reserva" }).click();
  await expect(page.getByRole("dialog")).toHaveAttribute("data-theme", "salon-dark");
  await expect(page.getByText(/Suas escolhas serão mantidas/)).toBeVisible();
  await page.getByRole("button", { name: "Entrar e continuar" }).click();
  await expect(page).toHaveURL(/\/book\/luna-hair\/login\?returnTo=/);
  const returnTo = new URL(page.url()).searchParams.get("returnTo")!;
  expect(returnTo).toMatch(/services=.+&pro=.+&date=.+&slot=/);
  await page.reload();
  await expect(page.locator(".client-app")).toHaveAttribute("data-theme", "salon-dark");
  expect(errors).toEqual([]);
});
