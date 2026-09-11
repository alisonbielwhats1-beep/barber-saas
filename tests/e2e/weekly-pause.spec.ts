import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
import { addCalendarDays, dateKeyInTimeZone, weekdayOfDateKey } from "../../src/lib/time";

test.describe("@database pausas recorrentes", () => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente banco descartável.");
  test("configura almoço por dias no celular e verifica disponibilidade semanal e temporária", async ({ page }) => {
    test.setTimeout(180_000);
    assertSafeDatabaseOperation(process.env, { operation: "e2e-weekly-pause" });
    const db = new PrismaClient();
    const salon = await db.salon.findUniqueOrThrow({ where: { slug: "luna-hair" } });
    const suffix = crypto.randomUUID();
    const name = `Alex · Teste ${suffix.slice(0, 4)}`;
    const user = await db.user.create({ data: { name, email: `${suffix}@example.test`, passwordHash: "not-a-login" } });
    const pro = await db.professional.create({ data: { salonId: salon.id, userId: user.id } });
    const service = await db.service.create({ data: { salonId: salon.id, name: "Serviço teste de pausa", durationMin: 30, priceCents: 5000, professionals: { create: { professionalId: pro.id } } } });
    await db.workingHours.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ salonId: salon.id, professionalId: pro.id, weekday, startMinutes: 540, endMinutes: 1260 })) });
    let monday = addCalendarDays(dateKeyInTimeZone(new Date(), salon.timezone), 7);
    while (weekdayOfDateKey(monday) !== 1) monday = addCalendarDays(monday, 1);
    const saturday = addCalendarDays(monday, 5);
    const sunday = addCalendarDays(monday, 6);
    const slots = async (date: string) => {
      const response = await page.request.get(`/api/availability?salonId=${salon.id}&professionalId=${pro.id}&serviceId=${service.id}&date=${date}`);
      expect(response.status()).toBe(200); return (await response.json()).slots as string[];
    };
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/login");
      await page.getByLabel("Email").fill("dono@lunahair.com");
      await page.getByLabel("Senha", { exact: true }).fill("demo1234");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
      await page.goto(`/agenda?date=${monday}`);
      await page.getByRole("button", { name: "Abrir ações rápidas da agenda" }).click();
      await page.getByRole("menuitem", { name: "Pausa recorrente", exact: true }).click();
      const dialog = page.getByRole("dialog");
      for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.uncheck();
      await dialog.getByLabel(name, { exact: true }).check();
      await dialog.getByRole("button", { name: "Segunda a sexta", exact: true }).click();
      await dialog.getByLabel("Início da pausa").fill("12:30");
      await dialog.getByLabel("Fim da pausa").fill("14:30");
      await dialog.getByRole("button", { name: "Revisar pausa", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Confirmar pausa semanal" })).toBeVisible();
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
        await page.setViewportSize(viewport);
        expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
        expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        await page.evaluate(() => { const label = document.createElement("div"); label.id = "test-evidence-label"; label.textContent = "AMBIENTE DE TESTES · DADOS FICTÍCIOS"; label.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;text-align:center;background:#fff;color:#111;font:12px sans-serif;padding:6px"; document.body.append(label); });
        await page.screenshot({ path: test.info().outputPath(`weekly-pause-test-${viewport.width}.png`), animations: "disabled" });
        await page.locator("#test-evidence-label").evaluate(el => el.remove());
      }
      await dialog.getByRole("button", { name: "Confirmar pausa semanal" }).click();
      await expect(dialog.getByRole("status")).toContainText("Pausa semanal salva");
      expect(await slots(monday)).not.toContain("12:30");
      expect(await slots(monday)).toContain("14:30");
      expect(await slots(saturday)).toContain("12:30");
      await dialog.getByRole("button", { name: "Concluir" }).click();
      await expect(page.getByRole("button", { name: "Abrir ações rápidas da agenda" })).toBeFocused();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Abrir ações rápidas da agenda" }).click();
      await page.getByRole("menuitem", { name: /Novo bloqueio de horário/ }).click();
      for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.uncheck();
      await dialog.getByLabel(name, { exact: true }).check();
      await dialog.getByLabel("Hora de início", { exact: true }).fill("12:30");
      await dialog.getByLabel("Data de início", { exact: true }).fill(monday);
      await dialog.getByLabel("Data de fim", { exact: true }).fill(monday);
      await dialog.getByLabel("Hora de fim", { exact: true }).fill("14:30");
      await dialog.getByLabel("Repetir", { exact: true }).selectOption("days");
      await dialog.getByRole("button", { name: "Sábado e domingo" }).click();
      await dialog.getByLabel("Repetir até").fill(sunday);
      await dialog.getByLabel("Motivo").fill("Almoço temporário de teste");
      await dialog.getByRole("button", { name: "Revisar bloqueio" }).click();
      await dialog.getByRole("button", { name: "Confirmar bloqueio" }).click();
      await expect(dialog.getByRole("status")).toContainText("Disponibilidade bloqueada");
      expect(await slots(saturday)).not.toContain("12:30");
      expect(await slots(sunday)).not.toContain("12:30");
      expect(await slots(addCalendarDays(saturday, 7))).toContain("12:30");
      expect(await db.timeOff.count({ where: { professionalId: pro.id } })).toBe(2);
    } finally {
      await db.timeOff.deleteMany({ where: { professionalId: pro.id } });
      await db.professionalService.deleteMany({ where: { professionalId: pro.id } });
      await db.workingHours.deleteMany({ where: { professionalId: pro.id } });
      await db.service.delete({ where: { id: service.id } });
      await db.professional.delete({ where: { id: pro.id } });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  });
});
