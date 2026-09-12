import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import AxeBuilder from "@axe-core/playwright";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
import { addCalendarDays, dateKeyInTimeZone, zonedDateTimeToUtc } from "../../src/lib/time";

test("@database telefone pendente e remarcações preservam vagas e outros clientes", async ({ page }) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente dados sintéticos.");
  test.setTimeout(180_000);
  assertSafeDatabaseOperation(process.env, { operation: "client-phone-reschedule-browser" });
  const db = new PrismaClient();
  const suffix = crypto.randomUUID();
  const salon = await db.salon.findUniqueOrThrow({ where: { slug: "luna-hair" } });
  const client = await db.clientProfile.create({ data: { salonId: salon.id, name: `Telefone CI ${suffix}`, email: `${suffix}@example.test`, passwordHash: await bcrypt.hash("synthetic-password", 10) } });
  const other = await db.clientProfile.create({ data: { salonId: salon.id, name: `Vizinho CI ${suffix}` } });
  const user = await db.user.create({ data: { name: "Profissional isolado", email: `pro-${suffix}@example.test`, passwordHash: "fixture" } });
  const pro = await db.professional.create({ data: { salonId: salon.id, userId: user.id } });
  const service = await db.service.create({ data: { salonId: salon.id, name: `Serviço CI ${suffix}`, priceCents: 5000, durationMin: 30, professionals: { create: { professionalId: pro.id } } } });
  let date = addCalendarDays(dateKeyInTimeZone(new Date(), salon.timezone), 7);
  while (new Date(`${date}T12:00:00Z`).getUTCDay() !== 0) date = addCalendarDays(date, 1);
  await db.professionalOpening.create({ data: { salonId: salon.id, professionalId: pro.id, dateKey: date, startMinutes: 540, endMinutes: 1080, reason: "Teste sintético" } });
  const make = (clientId: string, time: string) => db.appointment.create({ data: { salonId: salon.id, professionalId: pro.id, clientId, serviceId: service.id, status: "CONFIRMED", priceCents: 5000, startAt: zonedDateTimeToUtc(date, time, salon.timezone), endAt: new Date(zonedDateTimeToUtc(date, time, salon.timezone).getTime() + 30 * 60_000) } });
  const own = await make(client.id, "12:00");
  const neighbor = await make(other.id, "11:00");
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/book/luna-hair/login");
    await page.getByLabel("E-mail").fill(client.email!);
    await page.getByLabel("Senha", { exact: true }).fill("synthetic-password");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    const alert = page.getByRole("region", { name: "Telefone pendente" });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await alert.getByLabel("WhatsApp com DDD").fill("11987654321");
    await alert.getByRole("button", { name: "Salvar telefone" }).click();
    await expect(alert).toHaveCount(0);
    expect((await db.clientProfile.findUniqueOrThrow({ where: { id: client.id } })).phone).toBe("11987654321");
    const query = new URLSearchParams({ salonId: salon.id, professionalId: pro.id, serviceId: service.id, date });
    const available = async (id?: string) => {
      const response = await page.request.get(`/api/availability?${query}${id ? `&rescheduleId=${id}` : ""}`);
      expect(response.status()).toBe(200);
      return response.json();
    };
    expect((await available()).slots).not.toContain("12:00");
    expect((await available(own.id)).slots).toContain("12:00");
    expect((await available(own.id)).slots).not.toContain("11:00");
    expect((await page.request.get(`/api/availability?${query}&rescheduleId=${neighbor.id}`)).status()).toBe(404);
    const move = async (time: string, version: number) => page.request.post("/api/client/reschedule", { data: { salonSlug: salon.slug, appointmentId: own.id, professionalId: pro.id, startLocal: `${date}T${time}`, expectedVersion: version, idempotencyKey: crypto.randomUUID() } });
    expect((await move("10:30", 1)).status()).toBe(200);
    expect((await available()).slots).toContain("12:00");
    expect((await move("11:00", 2)).status()).toBe(409);
    expect((await move("09:30", 2)).status()).toBe(200);
    expect((await available()).slots).toContain("10:30");
    expect(await db.appointment.findUniqueOrThrow({ where: { id: neighbor.id } })).toEqual(neighbor);
    expect(await db.appointment.count({ where: { salonId: salon.id, clientId: client.id } })).toBe(1);
    await page.goto("/login");
    await page.getByLabel("Email").fill("dono@lunahair.com");
    await page.getByLabel("Senha", { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
    await page.goto("/clientes");
    await page.getByPlaceholder(/Buscar/).fill(client.name);
    await page.getByLabel("Lista de clientes").getByRole("button").first().click();
    await expect(page.getByRole("dialog")).toContainText("11987654321");
    await page.goto(`/agenda?date=${date}`);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator(`[data-appointment-professional="${pro.id}"]`).first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`agenda-colorida-${width}.png`) });
      expect((await new AxeBuilder({ page }).include(".agenda-grid").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    }
  } finally {
    // A fixture e seus eventos ficam no banco descartável até o descarte do job.
    await db.$disconnect();
  }
});
