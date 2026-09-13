import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
import { addCalendarDays, dateKeyInTimeZone } from "../../src/lib/time";

test.describe("@database configuração inicial", () => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente banco sintético isolado.");
  test("primeira entrada, pausa, retomada, configuração e link no celular e computador", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    assertSafeDatabaseOperation(process.env, {
      operation: "e2e-initial-setup",
    });
    const db = new PrismaClient();
    const suffix = crypto.randomUUID();
    const email = `setup-${suffix}@example.test`;
    const user = await db.user.create({
      data: {
        email,
        name: "Alex Teste",
        passwordHash: await bcrypt.hash("Setup-test-2026!", 12),
        passwordSetAt: new Date(),
      },
    });
    const salon = await db.salon.create({
      data: {
        name: "Espaço Aurora · Teste",
        slug: `setup-${suffix}`,
        accessStatus: "APPROVED",
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Senha", { exact: true }).fill("Setup-test-2026!");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page).toHaveURL(/\/onboarding\/configuracao/, {
        timeout: 45_000,
      });
      await page
        .getByRole("button", { name: "Fazer depois", exact: true })
        .click();
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
      await page.reload();
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.getByRole("link", { name: "Continuar configuração" }).click();
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByRole("heading", { level: 1 })).toContainText(
          "horários",
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(1);
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.screenshot({
          path: test.info().outputPath(`horarios-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "Salvar e continuar", exact: true })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "O que você oferece?",
      );
      await page.getByLabel("Nome do serviço").fill("Corte teste");
      await page.getByLabel("Duração (min)").fill("30");
      await page.getByLabel("Preço (R$)").fill("45,00");
      await page
        .getByRole("button", { name: "Adicionar serviço", exact: true })
        .click();
      await expect(
        page.getByText("Serviço revisado", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "3. Profissionais", exact: true })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Quem vai atender?",
      );
      // Resume without a step in the URL: the saved tenant state is the source.
      await page.goto("/onboarding/configuracao");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Quem vai atender?",
      );
      await page.getByRole("button", { name: "Eu mesmo atendo" }).click();
      await page.getByLabel("Corte teste", { exact: true }).check();
      await page
        .getByLabel("Usar os horários da primeira etapa nesta agenda")
        .check();
      await page.getByRole("button", { name: "Salvar profissional" }).click();
      await expect(page.getByText("Jornada já configurada")).toBeVisible();
      await page
        .getByRole("button", { name: "4. Aplicativo do cliente", exact: true })
        .click();
      await expect(
        page.getByText("Configuração essencial pronta", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Link do aplicativo do cliente"),
      ).toHaveValue(new RegExp(`/book/${salon.slug}$`));
      await expect(
        page.getByText("Mais → Compartilhar", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Abrir aplicativo/ }),
      ).toHaveAttribute("href", new RegExp(`/book/${salon.slug}$`));
      await page
        .getByLabel("Endereço", { exact: true })
        .fill("Rua das Flores, 100");
      await page.getByLabel("Telefone com DDD").fill("11999998888");
      await page.getByRole("button", { name: "Salvar contato" }).click();
      await expect(page.getByRole("status")).toContainText(
        "Dados de contato salvos",
      );
      for (const theme of ["admin-light", "admin-dark"])
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(
            (value) =>
              document.documentElement.setAttribute("data-theme", value),
            theme,
          );
          // Measure the selected theme after its color transitions settle.
          await page.evaluate(async () => {
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
          });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - innerWidth,
            ),
          ).toBeLessThanOrEqual(1);
          expect(
            (
              await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
                .analyze()
            ).violations,
          ).toEqual([]);
          await page.screenshot({
            path: test.info().outputPath(`compartilhar-${theme}-${width}.png`),
            fullPage: true,
            animations: "disabled",
          });
        }
      const pro = await db.professional.findFirstOrThrow({
        where: { salonId: salon.id },
      });
      const service = await db.service.findFirstOrThrow({
        where: { salonId: salon.id },
      });
      const date = addCalendarDays(
        dateKeyInTimeZone(new Date(), salon.timezone),
        1,
      );
      const candidates = await Promise.all(
        [0, 1].map(async (offset) => {
          const response = await page.request.get(
            `/api/availability?salonId=${salon.id}&professionalId=${pro.id}&serviceId=${service.id}&date=${addCalendarDays(date, offset)}`,
          );
          expect(response.status()).toBe(200);
          return (await response.json()).slots as string[];
        }),
      );
      expect(candidates.flat().length).toBeGreaterThan(0);
      await page
        .getByRole("button", { name: "Concluir configuração", exact: true })
        .click();
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
      await expect(
        page.getByRole("link", { name: "Continuar configuração" }),
      ).toHaveCount(0);
      expect(await db.appointment.count({ where: { salonId: salon.id } })).toBe(
        0,
      );
      expect(errors).toEqual([]);
    } finally {
      await db.salon.delete({ where: { id: salon.id } });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  });
});
