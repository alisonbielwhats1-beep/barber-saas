import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";

test("@database semana, minutos e seleção sem clientes mesclados ou excluídos", async ({ page }) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente dados sintéticos.");
  test.setTimeout(240_000);
  assertSafeDatabaseOperation(process.env, { operation: "agenda-client-selection-browser" });
  const db = new PrismaClient();
  const suffix = crypto.randomUUID().slice(0, 8);
  const salon = await db.salon.findUniqueOrThrow({ where: { slug: "luna-hair" } });
  const phone = `119${String(parseInt(suffix, 16)).padStart(8, "0").slice(-8)}`;
  const account = await db.clientProfile.create({ data: { salonId: salon.id, name: `AAA Conta ${suffix}`, email: `${suffix}@example.test`, phone, phoneNormalized: phone, passwordHash: "synthetic-account-hash" } });
  const guest = await db.clientProfile.create({ data: { salonId: salon.id, name: `AAA Manual ${suffix}`, phone, phoneNormalized: phone } });
  const hidden = await db.clientProfile.create({ data: { salonId: salon.id, name: `AAA Excluído ${suffix}` } });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await page.getByLabel("Email").fill("dono@lunahair.com");
    await page.getByLabel("Senha", { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
    await page.goto("/clientes");
    await page.getByLabel("Lista de clientes").locator("button").filter({ hasText: guest.name }).click();
    const detail = page.getByRole("dialog");
    await expect(detail.getByText("Conta criada · acesso ao aplicativo", { exact: true })).toBeVisible();
    await expect(detail.getByText("Sem conta criada", { exact: true }).first()).toBeVisible();
    await detail.screenshot({ path: test.info().outputPath("duplicatas-conta-sintetica.png") });
    await detail.getByRole("button", { name: "Manter esta duplicata (recomendado)" }).click();
    const merge = page.getByRole("dialog", { name: "Confirmar mesclagem" });
    await expect(merge.getByText(`Cadastro que ficará: ${account.name}`)).toBeVisible();
    await merge.getByRole("button", { name: "Confirmar mesclagem", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByLabel("Lista de clientes").locator("button").filter({ hasText: hidden.name }).click();
    await page.getByRole("button", { name: "Excluir da lista", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar exclusão da lista" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/agenda?date=2026-09-12");
    const week = page.getByRole("navigation", { name: "Dias da semana da agenda" });
    await expect(week.getByRole("button")).toHaveCount(7);
    await expect(week.getByRole("button").first()).toHaveText(/dom\.?6/);
    await expect(week.getByRole("button").last()).toHaveText(/sáb\.?12/);
    await expect(week.getByRole("button").last()).toHaveAttribute("aria-pressed", "true");
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await week.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      for (const minute of ["08:00", "08:15", "08:30", "08:45"]) await expect(page.locator(`[data-agenda-minute="${minute}"]`)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`agenda-semana-minutos-${width}.png`) });
    }
    await week.getByRole("button").first().click();
    await expect(page).toHaveURL(/date=2026-09-06/);
    await page.getByRole("button", { name: "Abrir ações rápidas da agenda" }).click();
    await page.getByRole("menuitem", { name: /Novo agendamento/ }).click();
    const clients = page.getByLabel("Cliente", { exact: true });
    await expect(clients.locator(`option[value="${account.id}"]`)).toHaveCount(1);
    await expect(clients.locator(`option[value="${guest.id}"]`)).toHaveCount(0);
    await expect(clients.locator(`option[value="${hidden.id}"]`)).toHaveCount(0);
    expect(await db.clientProfile.findUnique({ where: { id: guest.id }, select: { mergedIntoId: true } })).toEqual({ mergedIntoId: account.id });
    expect(await db.clientProfile.findUnique({ where: { id: account.id }, select: { passwordHash: true } })).toEqual({ passwordHash: "synthetic-account-hash" });
  } finally {
    await db.auditLog.deleteMany({ where: { salonId: salon.id, entityId: { in: [account.id, guest.id, hidden.id] } } });
    await db.clientProfile.delete({ where: { id: guest.id } });
    await db.clientProfile.deleteMany({ where: { salonId: salon.id, id: { in: [account.id, hidden.id] } } });
    await db.$disconnect();
  }
});
