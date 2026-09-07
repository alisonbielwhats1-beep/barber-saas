import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
test.describe("@database recursos e cuidados privados", () => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente dados fictícios.");
  test("cadastra recurso, serviço por etapas e anotação com foto privada", async ({ page }) => {
    test.setTimeout(240_000);
    assertSafeDatabaseOperation(process.env, { operation: "product-depth-browser" });
    const db = new PrismaClient(); const suffix = crypto.randomUUID().slice(0, 8);
    try {
      await page.goto("/login"); await page.getByLabel("Email").fill("dono@lunahair.com"); await page.getByLabel("Senha", { exact: true }).fill("demo1234"); await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
      await page.goto("/servicos"); await page.getByText("Salas e equipamentos", { exact: true }).click();
      const resourceName = `Sala CI ${suffix}`;
      await page.getByLabel("Nome", { exact: true }).fill(resourceName); await page.getByRole("button", { name: "Adicionar recurso", exact: true }).click();
      await expect(page.getByText(`${resourceName} · Sala · Ativo`)).toBeVisible();
      await page.getByRole("button", { name: "Novo serviço", exact: true }).click();
      const dialog = page.getByRole("dialog"); await dialog.getByLabel("Nome", { exact: true }).fill(`Tratamento CI ${suffix}`);
      await dialog.getByLabel("Duração (min)", { exact: true }).fill("60"); await dialog.getByLabel("Preço (R$)", { exact: true }).fill("90");
      await dialog.getByLabel("Processamento (min)").fill("20"); await dialog.getByLabel("Finalização (min)").fill("10");
      await dialog.getByLabel("Sala ou equipamento necessário").selectOption({ label: resourceName });
      await dialog.getByRole("button", { name: "Criar", exact: true }).click(); await expect(dialog).not.toBeVisible();
      const salon = await db.salon.findUniqueOrThrow({ where: { slug: "luna-hair" } });
      const service = await db.service.findFirstOrThrow({ where: { salonId: salon.id, name: `Tratamento CI ${suffix}` } });
      expect(service).toMatchObject({ processingMin: 20, finishingMin: 10 }); expect(service.physicalResourceId).toBeTruthy();
      await page.screenshot({ path: test.info().outputPath("servicos-recursos.png"), fullPage: true, animations: "disabled" });
      const professional = await db.professional.findFirstOrThrow({ where: { salonId: salon.id, active: true } });
      const client = await db.clientProfile.create({ data: { salonId: salon.id, name: `Cuidados CI ${suffix}` } });
      const startAt = new Date(Date.now() - 7200000); const endAt = new Date(+startAt + 3600000);
      const appointment = await db.appointment.create({ data: { salonId: salon.id, professionalId: professional.id, clientId: client.id, serviceId: service.id, priceCents: 9000, status: "COMPLETED", startAt, endAt } });
      const date = formatInTimeZone(startAt, salon.timezone, "yyyy-MM-dd");
      await page.goto(`/agenda?date=${date}&appointment=${appointment.id}`);
      await page.getByText("Cuidados e fotos desta visita", { exact: true }).click();
      await page.getByLabel("Procedimentos, produtos e orientações").fill("Procedimento de teste. Retorno em quatro semanas.");
      await page.getByLabel(/Foto privada \(opcional/).setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=", "base64") });
      await page.getByLabel("O cliente autorizou esta foto para o histórico de cuidados.").check();
      await page.getByRole("button", { name: "Registrar cuidados" }).click();
      await expect(page.getByRole("link", { name: "Abrir foto privada" })).toBeVisible();
      const href = await page.getByRole("link", { name: "Abrir foto privada" }).getAttribute("href");
      const photo = await page.request.get(href!); expect(photo.status()).toBe(200); expect(photo.headers()["cache-control"]).toContain("no-store");
      await page.screenshot({ path: test.info().outputPath("cuidados-visita.png"), fullPage: true, animations: "disabled" });
      const anonymous = await page.context().browser()!.newContext();
      expect((await anonymous.request.get(new URL(href!, page.url()).toString())).status()).toBe(404); await anonymous.close();
    } finally { await db.$disconnect(); }
  });
});
