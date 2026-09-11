import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
import { withSalon } from "../../src/lib/prisma-tenant";

test.describe("@database listas mobile compactas", () => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente banco descartável.");
  test("listas no topo, filtros, nomes longos e desempenho nas três larguras", async ({ page }) => {
    test.setTimeout(300_000);
    assertSafeDatabaseOperation(process.env, { operation: "mobile-lists-fixture" });
    const db = new PrismaClient();
    const email = `mobile-${crypto.randomUUID()}@example.test`;
    const password = "mobile-synthetic-password";
    const professionalName = "Mariana de Albuquerque Ferreira dos Santos";
    try {
      const user = await db.user.create({ data: { name: professionalName, email, passwordHash: await bcrypt.hash(password, 10), passwordSetAt: new Date() } });
      const salon = await db.salon.create({ data: { name: "Estúdio Mobile · teste", slug: `mobile-${crypto.randomUUID()}`, accessStatus: "APPROVED" } });
      await withSalon(salon.id, async tx => {
        await tx.membership.create({ data: { salonId: salon.id, userId: user.id, role: "OWNER" } });
        const pro = await tx.professional.create({ data: { salonId: salon.id, userId: user.id } });
        const client = await tx.clientProfile.create({ data: { salonId: salon.id, name: "Ana Carolina de Albuquerque", phone: "11912345678" } });
        for (let i = 0; i < 12; i++) {
          const service = await tx.service.create({ data: { salonId: salon.id, name: `Serviço ${String(i).padStart(2, "0")} · tratamento e finalização`, category: `Categoria ${i} com nome comprido`, durationMin: 60, priceCents: 18000, priceType: "FROM", priceNote: "O valor pode variar conforme o comprimento do cabelo.", professionals: { create: { professionalId: pro.id } } } });
          if (i === 0) {
            const endAt = new Date(Date.now() - 86400000);
            const appointment = await tx.appointment.create({ data: { salonId: salon.id, clientId: client.id, professionalId: pro.id, serviceId: service.id, startAt: new Date(endAt.getTime() - 3600000), endAt, priceCents: 18000, status: "COMPLETED" } });
            await tx.clientReview.create({ data: { salonId: salon.id, appointmentId: appointment.id, clientId: client.id, rating: 5, comment: "Atendimento cuidadoso e resultado excelente." } });
          }
        }
      });
    } finally { await db.$disconnect(); }
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30000 });
    for (const theme of ["dark", "light"]) {
      if (theme === "light") await page.getByRole("button", { name: "Mudar para tema claro" }).click();
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        for (const [route, label] of [["clientes", "Lista de clientes"], ["servicos", "Lista de serviços"], ["profissionais", "Lista de profissionais"], ["avaliacoes", "Lista de avaliações"]]) {
          await page.goto(`/${route}`);
          const list = page.getByLabel(label, { exact: true });
          await expect(list).toBeVisible();
          const box = await list.boundingBox();
          expect(box!.y).toBeLessThan(320);
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
          expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
          await page.screenshot({ path: test.info().outputPath(`mobile-${route}-${width}-${theme}.png`), animations: "disabled" });
          if (route === "clientes") {
            await page.getByLabel("Buscar cliente ou telefone").fill("inexistente");
            await expect(page.getByText("Nenhum cliente neste filtro.")).toBeVisible();
            await page.getByLabel("Buscar cliente ou telefone").fill("Ana");
            await page.getByRole("button", { name: "Filtros", exact: true }).click();
            await page.getByLabel("Filtrar clientes").selectOption("birthday");
            await expect(page.getByText("Nenhum cliente neste filtro.")).toBeVisible();
            await page.getByLabel("Filtrar clientes").selectOption("all");
            await expect(list.getByText("Ana Carolina de Albuquerque")).toBeVisible();
          }
          if (route === "servicos") {
            await expect(list.getByText(/A partir de/)).toHaveCount(12);
            await page.getByRole("button", { name: "Filtros", exact: true }).click();
            await page.getByLabel("Categoria do serviço").selectOption("Categoria 2 com nome comprido");
            await expect(list.getByText(/A partir de/)).toHaveCount(1);
            await page.getByRole("button", { name: "Filtrado", exact: true }).click();
            await expect(page.getByLabel("Categoria do serviço")).not.toBeVisible();
            await list.getByRole("button", { name: /Mais opções/ }).click();
            await expect(page.getByRole("menuitem", { name: "Editar", exact: true })).toBeVisible();
            await page.keyboard.press("Escape");
          }
          if (route === "profissionais") {
            await expect(list.getByText(professionalName, { exact: true })).toBeVisible();
            await expect(list.getByText("Ticket médio")).not.toBeVisible();
            await list.getByRole("button", { name: "Desempenho", exact: true }).click();
            await expect(list.getByText("Ticket médio")).toBeVisible();
            await list.getByRole("button", { name: "Desempenho", exact: true }).click();
            await page.getByLabel("Buscar profissional").fill("inexistente");
            await expect(page.getByText("Nenhum profissional encontrado.")).toBeVisible();
          }
          if (route === "avaliacoes") {
            await expect(list.getByText(/Atendimento cuidadoso/)).toBeVisible();
            await page.getByLabel("Filtrar avaliações").selectOption("HIDDEN");
            await expect(page.getByText("Nenhuma avaliação neste filtro")).toBeVisible();
          }
        }
      }
    }
    expect(errors).toEqual([]);
  });
});
