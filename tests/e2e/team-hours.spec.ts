import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
import { addCalendarDays, dateKeyInTimeZone, weekdayOfDateKey } from "../../src/lib/time";

test.describe("@database expediente compartilhado", () => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente banco descartável.");
  test("salva em celular e publica os mesmos intervalos, pausas e limite no cliente", async ({ page }) => {
    test.setTimeout(180_000);
    assertSafeDatabaseOperation(process.env, { operation: "e2e-team-hours" });
    const db = new PrismaClient();
    const suffix = crypto.randomUUID();
    const name = `Alex · Teste ${suffix.slice(0, 6)}`;
    const salon = await db.salon.findUniqueOrThrow({ where: { slug: "luna-hair" } });
    const date = addCalendarDays(dateKeyInTimeZone(new Date(), salon.timezone), 7);
    const weekday = weekdayOfDateKey(date);
    const user = await db.user.create({ data: { name, email: `${suffix}@example.test`, passwordHash: "not-a-login" } });
    const pro = await db.professional.create({ data: { salonId: salon.id, userId: user.id } });
    const service = await db.service.create({ data: { salonId: salon.id, name: "Serviço de jornada CI", durationMin: 30, priceCents: 5000, professionals: { create: { professionalId: pro.id } } } });
    await db.workingHours.create({ data: { salonId: salon.id, professionalId: pro.id, weekday, startMinutes: 540, endMinutes: 1080 } });
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/login");
      await page.getByLabel("Email").fill("dono@lunahair.com");
      await page.getByLabel("Senha", { exact: true }).fill("demo1234");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
      await page.goto("/configuracoes#jornadas");
      const manager = page.locator("#jornadas");
      await expect(manager).toBeVisible();
      await manager.getByLabel("Abertura do salão", { exact: true }).fill("09:00");
      await manager.getByLabel(/Fechamento do salão/).fill("21:00");
      await manager.getByLabel("Também substituir os horários dos profissionais").check();
      await manager.getByLabel(`Substituir horário de ${name}`, { exact: true }).check();
      await manager.getByLabel("Incluir a mesma pausa em todos os dias de trabalho selecionados").check();
      await manager.getByLabel("Início da pausa").fill("12:30");
      await manager.getByLabel("Fim da pausa").fill("15:00");
      await manager.getByRole("button", { name: "Revisar horário e equipe" }).click();
      await expect(manager.getByText(/09:00–12:30 · 15:00–21:00/)).toBeVisible();
      await manager.getByRole("button", { name: "Confirmar e substituir horários" }).click();
      await expect(manager.getByRole("status")).toContainText("jornadas selecionadas foram atualizados", { timeout: 20_000 });
      const hours = await db.workingHours.findMany({ where: { salonId: salon.id, professionalId: pro.id }, orderBy: { startMinutes: "asc" } });
      expect(hours.map(h => [h.weekday, h.startMinutes, h.endMinutes])).toEqual([[weekday, 540, 750], [weekday, 900, 1260]]);
      const response = await page.request.get(`/api/availability?salonId=${salon.id}&professionalId=${pro.id}&serviceId=${service.id}&date=${date}`);
      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.slots).toContain("18:00"); expect(data.slots).toContain("20:30");
      for (const time of ["12:15", "12:30", "14:30", "20:45"]) expect(data.slots).not.toContain(time);
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
        await page.setViewportSize(viewport);
        await manager.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        expect((await new AxeBuilder({ page }).include("#jornadas").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
        await page.evaluate(() => { const label = document.createElement("div"); label.id = "test-evidence-label"; label.textContent = "AMBIENTE DE TESTES · DADOS FICTÍCIOS"; label.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;text-align:center;background:#fff;color:#111;font:12px sans-serif;padding:6px"; document.body.append(label); });
        await page.screenshot({ path: test.info().outputPath(`team-hours-${viewport.width}.png`), animations: "disabled" });
        await page.locator("#test-evidence-label").evaluate(el => el.remove());
      }
    } finally {
      await db.salon.update({ where: { id: salon.id }, data: { openMinutes: salon.openMinutes, closeMinutes: salon.closeMinutes } });
      await db.professionalService.deleteMany({ where: { professionalId: pro.id } });
      await db.workingHours.deleteMany({ where: { professionalId: pro.id } });
      await db.service.delete({ where: { id: service.id } });
      await db.professional.delete({ where: { id: pro.id } });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  });
});
