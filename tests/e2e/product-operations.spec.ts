import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
import { dateKeyInTimeZone, zonedDateTimeToUtc } from "../../src/lib/time";

test.describe("@database operação diária e expediente", () => {
  test.use({ actionTimeout: 15_000 });
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente banco descartável.");
  test("registra chegada, libera expediente e bloqueia sem cancelar reservas", async ({ page }) => {
    test.setTimeout(180_000);
    assertSafeDatabaseOperation(process.env, { operation: "e2e-product-fixture" });
    const db = new PrismaClient();
    const suffix = crypto.randomUUID();
    const professionalName = `Profissional CI ${suffix.slice(0, 6)}`;
    const clientName = `Chegada CI ${suffix.slice(0, 6)}`;
    const salon = await db.salon.findUniqueOrThrow({ where: { slug: "luna-hair" } });
    const date = dateKeyInTimeZone(new Date(), salon.timezone);
    const hour = formatInTimeZone(new Date(), salon.timezone, "HH");
    const startTime = `${hour}:00`;
    const endTime = `${hour}:30`;
    const user = await db.user.create({ data: { name: professionalName, email: `${suffix}@example.test`, passwordHash: "fixture-not-a-login" } });
    const professional = await db.professional.create({ data: { salonId: salon.id, userId: user.id } });
    const service = await db.service.create({ data: { salonId: salon.id, name: "Corte teste operacional", durationMin: 30, priceCents: 5000, professionals: { create: { professionalId: professional.id } } } });
    const client = await db.clientProfile.create({ data: { salonId: salon.id, name: clientName } });
    const appointment = await db.appointment.create({ data: { salonId: salon.id, professionalId: professional.id, serviceId: service.id, clientId: client.id, startAt: zonedDateTimeToUtc(date, startTime, salon.timezone), endAt: zonedDateTimeToUtc(date, endTime, salon.timezone), priceCents: 5000, status: "CONFIRMED" } });
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill("dono@lunahair.com");
      await page.getByLabel("Senha", { exact: true }).fill("demo1234");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
      await page.goto("/hoje");
      const card = page.locator("article").filter({ hasText: clientName });
      await card.getByRole("button", { name: "Registrar chegada" }).click();
      await expect(card.getByText(/Chegou às.*aguardando/)).toBeVisible();
      const clientLabel = card.getByText(clientName, { exact: true });
      const clientBox = await clientLabel.boundingBox();
      expect(clientBox?.width).toBeGreaterThan(220);
      expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).checkedInAt).not.toBeNull();
      await page.screenshot({ path: test.info().outputPath("hoje-chegada-desktop.png"), fullPage: true, animations: "disabled" });
      await card.screenshot({ path: test.info().outputPath("acoes-atendimento-dark.png"), animations: "disabled" });
      await page.getByRole("button", { name: "Mudar para tema claro" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "admin-light");
      await card.screenshot({ path: test.info().outputPath("acoes-atendimento-light.png"), animations: "disabled" });
      await page.getByRole("button", { name: "Mudar para tema escuro" }).click();

      await page.goto(`/agenda?date=${date}`);
      await page.getByRole("button", { name: "Liberar expediente extra", exact: true }).click();
      const opening = page.getByRole("dialog");
      await opening.getByLabel("Profissional", { exact: true }).selectOption(professional.id);
      await opening.getByLabel("Motivo").fill(`Abertura CI ${suffix}`);
      await opening.getByRole("button", { name: "Salvar expediente extra" }).click();
      await expect(opening).not.toBeVisible();
      expect(await db.professionalOpening.count({ where: { professionalId: professional.id, dateKey: date } })).toBe(1);

      await page.getByRole("button", { name: "Bloquear horário ou dia" }).click();
      const blocking = page.getByRole("dialog");
      await blocking.getByLabel("Início", { exact: true }).fill(`${date}T${startTime}`);
      await blocking.getByLabel("Fim", { exact: true }).fill(`${date}T${endTime}`);
      await blocking.getByLabel("Motivo").fill(`Reunião CI ${suffix}`);
      await blocking.getByRole("button", { name: "Revisar bloqueio" }).click();
      await expect(blocking.getByRole("status")).toContainText(clientName);
      await page.screenshot({ path: test.info().outputPath("agenda-revisao-bloqueio.png"), fullPage: true, animations: "disabled" });
      await blocking.getByRole("button", { name: "Confirmar bloqueio" }).click();
      await expect(blocking.getByRole("status")).toContainText("Disponibilidade bloqueada");
      expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("CONFIRMED");
      await blocking.getByRole("button", { name: "Concluir", exact: true }).click();
      await page.screenshot({ path: test.info().outputPath("agenda-desktop.png"), fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: "Mudar para tema claro" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "admin-light");
      // Wait for inherited color transitions; changing the root attribute alone
      // can leave button text in its old theme during the screenshot.
      const expectedForeground = await page.locator("body").evaluate(el => getComputedStyle(el).color);
      await expect.poll(() => page.getByRole("button", { name: "Todos profissionais", exact: true }).evaluate(el => getComputedStyle(el).color)).toBe(expectedForeground);
      await page.screenshot({ path: test.info().outputPath("agenda-light-desktop.png"), fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: test.info().outputPath("agenda-mobile.png"), fullPage: true, animations: "disabled" });
    } finally {
      // Somente fixtures identificadas por UUID; os históricos de aplicação são mantidos.
      await db.timeOff.deleteMany({ where: { reason: `Reunião CI ${suffix}` } });
      await db.professionalOpening.deleteMany({ where: { professionalId: professional.id } });
      await db.$disconnect();
    }
  });
});
