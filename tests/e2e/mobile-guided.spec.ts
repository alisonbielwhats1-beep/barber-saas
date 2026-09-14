import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
import { addCalendarDays, dateKeyInTimeZone } from "../../src/lib/time";

test.use({ hasTouch: true });

test("@database mobile guiado: catálogo grande, tutorial, busca e horários explícitos", async ({
  page,
}) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente banco sintético.");
  test.setTimeout(300000);
  page.setDefaultTimeout(20000);
  assertSafeDatabaseOperation(process.env, { operation: "mobile-guided-e2e" });
  const db = new PrismaClient();
  const suffix = crypto.randomUUID().slice(0, 8);
  const password = "Mobile-local-test-2026!";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const salon = await db.salon.create({
      data: {
        slug: `mobile-${suffix}`,
        name: "Espaço Aurora · Teste",
        plan: "PRO",
        accessStatus: "APPROVED",
        bufferMinutes: 0,
      },
    });
    const passwordHash = await bcrypt.hash(password, 10);
    const owner = await db.user.create({
      data: {
        name: "Alex Teste",
        email: `mobile-${suffix}@example.test`,
        passwordHash,
        memberships: { create: { salonId: salon.id, role: "OWNER" } },
      },
    });
    const teammate = await db.user.create({
      data: {
        name: "Tatiana Teste",
        email: `tati-${suffix}@example.test`,
        passwordHash,
        memberships: { create: { salonId: salon.id, role: "PROFESSIONAL" } },
      },
    });
    const pros = await Promise.all(
      [owner, teammate].map((user) =>
        db.professional.create({
          data: { salonId: salon.id, userId: user.id },
        }),
      ),
    );
    const names = [
      "Barba terapia",
      "Pé e Mão",
      "Alongamento em gel na tips",
      ...Array.from(
        { length: 87 },
        (_, i) => `Serviço de demonstração ${i + 1}`,
      ),
    ];
    const services = await Promise.all(
      names.map((name, i) =>
        db.service.create({
          data: {
            salonId: salon.id,
            name,
            durationMin: i === 1 ? 150 : 45,
            priceCents: i === 1 ? 11000 : 6000,
            professionals: { create: { professionalId: pros[i % 2]!.id } },
          },
        }),
      ),
    );
    await db.workingHours.createMany({
      data: pros.flatMap((pro) =>
        Array.from({ length: 7 }, (_, weekday) => ({
          salonId: salon.id,
          professionalId: pro.id,
          weekday,
          startMinutes: 540,
          endMinutes: 1080,
        })),
      ),
    });
    const client = await db.clientProfile.create({
      data: {
        salonId: salon.id,
        name: "Marina · Cliente de teste",
        phone: "11987654321",
      },
    });
    const date = addCalendarDays(
      dateKeyInTimeZone(new Date(), salon.timezone),
      3,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await page.getByLabel("Email").fill(owner.email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(
      /\/(dashboard|hoje|onboarding\/configuracao)(\?|$)/,
      { timeout: 45000 },
    );
    await page.goto("/onboarding/configuracao?step=1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "O que você oferece?",
    );
    expect(await page.getByLabel("Nome do serviço").count()).toBe(0);
    const audit = async (name: string) => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      for (const dialog of await page.getByRole("dialog").all())
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      // Aguarda a pintura após alternar tema/viewport antes de medir contraste.
      await page.screenshot({
        path: test.info().outputPath(`${name}.png`),
        animations: "disabled",
      });
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    };
    await audit("servicos-dark-390");
    await page.getByLabel("Pesquisar serviços").fill("pe e mao");
    await expect(
      page.getByLabel("Lista de serviços").getByRole("button"),
    ).toHaveCount(1);
    await page.getByLabel("Lista de serviços").getByRole("button").click();
    await expect(page.getByLabel("Nome do serviço")).toHaveValue("Pé e Mão");
    await audit("editar-servico-dark-390");
    await page.getByLabel("Preço (R$)").fill("125,00");
    await page
      .getByRole("button", { name: "Salvar serviço", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (await db.service.findUniqueOrThrow({ where: { id: services[1]!.id } }))
        .priceCents,
    ).toBe(12500);
    await page.getByLabel("Pesquisar serviços").fill("");
    await page.getByRole("button", { name: "Mudar para tema claro" }).click();
    await page.waitForTimeout(350);
    await audit("servicos-light-390");
    await page.goto(`/agenda?date=${date}`);
    const guide = page.getByRole("dialog");
    await expect(guide).toContainText("Sua agenda, um dia de cada vez");
    await audit("tutorial-light-390");
    await guide.getByRole("button", { name: "Próximo", exact: true }).click();
    await expect(guide).toContainText("Do horário à reserva");
    await guide.getByRole("button", { name: "Próximo", exact: true }).click();
    await guide
      .getByRole("button", { name: "Começar a usar", exact: true })
      .click();
    await page.reload();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Mudar para tema escuro" }).click();
    await page.getByRole("button", { name: "Como usar a agenda" }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".agenda-guide-hand")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    await audit("tutorial-dark-390");
    await page.getByRole("button", { name: "Pular tutorial" }).click();
    // Somente dados sintéticos: o enum PRO continua intacto; muda apenas o rótulo.
    for (const theme of ["dark", "light"] as const) {
      await page.setViewportSize({ width: 390, height: 844 });
      if (theme === "light") {
        await page
          .getByRole("button", { name: "Mudar para tema claro" })
          .click();
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          "admin-light",
        );
      }
      for (const width of [320, 390, 844, 1280]) {
        await page.setViewportSize({
          width,
          height: width === 844 ? 390 : 844,
        });
        const shortcut = page.getByRole("link", {
          name: "Plano atual: Essencial. Alterar plano",
          exact: true,
        });
        await expect(shortcut).toBeVisible();
        await expect(shortcut).toHaveAttribute("href", "/configuracoes#plano");
        const bounds = await shortcut.boundingBox();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.y).toBeLessThan(80);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        const mobileHeader = page.getByRole("region", {
          name: "Marca e aparência",
          includeHidden: true,
        });
        if (width < 1024) {
          expect(bounds!.width).toBeLessThanOrEqual(128);
          await expect(mobileHeader).toBeVisible();
          await expect(mobileHeader.getByText("Alterar plano")).toBeVisible();
        } else {
          await expect(mobileHeader).toBeHidden();
        }
        await expect(page.locator(".admin-shell")).toHaveCSS(
          "color",
          theme === "light" ? "rgb(34, 37, 42)" : "rgb(244, 244, 246)",
        );
        await audit(`planos-${theme}-${width}`);
      }
    }
    expect(
      (await db.salon.findUniqueOrThrow({ where: { id: salon.id } })).plan,
    ).toBe("PRO");
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("link", {
        name: "Plano atual: Essencial. Alterar plano",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/configuracoes#plano$/);
    await expect(
      page.getByRole("heading", { name: "Configurações", exact: true }),
    ).toBeVisible();
    await page.goto(`/agenda?date=${date}`);
    await page.getByRole("button", { name: "Mudar para tema escuro" }).click();
    await page
      .getByRole("button", { name: "Abrir ações rápidas da agenda" })
      .click();
    await page.getByRole("menuitem", { name: /Novo agendamento/ }).click();
    await page
      .getByRole("button", {
        name: "Adicionar serviços com profissionais diferentes",
      })
      .click();
    const visit = page.getByRole("dialog", {
      name: "Uma visita, vários serviços",
      exact: true,
    });
    await visit
      .getByRole("combobox", { name: "Cliente", exact: true })
      .selectOption(client.id);
    await visit.getByLabel("Início", { exact: true }).fill("09:00");
    await visit.getByRole("button", { name: "Escolher serviços" }).click();
    await visit.getByRole("button", { name: "Serviço 1", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Serviço 1", exact: true });
    await picker.getByRole("searchbox").fill("barba");
    await picker.getByRole("button", { name: /Barba terapia/ }).click();
    await expect(visit).toContainText("09:00 — 09:45");
    await visit
      .getByRole("button", { name: "Adicionar outro serviço" })
      .click();
    await visit.getByRole("button", { name: "Serviço 2", exact: true }).click();
    await page.getByRole("searchbox").fill("pe e mao");
    await audit("buscar-servico-dark-390");
    await page
      .getByRole("dialog", { name: "Serviço 2", exact: true })
      .getByRole("button", { name: /Pé e Mão/ })
      .click();
    await expect(visit).toContainText("09:45 — 12:15");
    await visit
      .getByRole("button", { name: "Profissional do serviço 2", exact: true })
      .click();
    await page.getByRole("searchbox").fill("tatiana");
    await page
      .getByRole("dialog", { name: "Profissional do serviço 2", exact: true })
      .getByRole("button", { name: "Tatiana Teste", exact: true })
      .click();
    await visit
      .getByRole("button", { name: "Ajustar horário", exact: true })
      .nth(1)
      .click();
    await visit.getByLabel("Início do serviço 2").fill("17:00");
    await visit
      .getByRole("button", { name: "Revisar visita", exact: true })
      .click();
    await expect(visit.getByRole("alert")).toContainText(
      "Serviço 2 · Pé e Mão · Tatiana Teste",
    );
    await expect(visit.getByRole("alert")).toContainText("09:00–18:00");
    await audit("bloqueio-explicado-dark-390");
    const errorBounds = await visit.getByRole("alert").boundingBox();
    const reviewBounds = await visit
      .getByRole("button", { name: "Revisar visita", exact: true })
      .boundingBox();
    expect(errorBounds!.y + errorBounds!.height).toBeLessThanOrEqual(
      reviewBounds!.y,
    );
    await visit.getByLabel("Início do serviço 2").fill("09:00");
    for (const size of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size);
      await visit.getByLabel("Início do serviço 2").scrollIntoViewIfNeeded();
      expect(
        await visit.getByLabel("Início do serviço 2").evaluate((el) => {
          const box = el.getBoundingClientRect();
          return (
            document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            ) === el
          );
        }),
      ).toBe(true);
      await audit(`horarios-dark-${size.width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await visit
      .getByRole("button", { name: "Revisar visita", exact: true })
      .click();
    await expect(
      visit.getByRole("button", { name: "Confirmar todos os serviços" }),
    ).toBeVisible();
    await audit("revisao-dark-390");
    await visit
      .getByRole("button", { name: "Confirmar todos os serviços" })
      .click();
    await expect(visit).toHaveCount(0);
    expect(await db.appointment.count({ where: { salonId: salon.id } })).toBe(
      2,
    );
    expect(errors).toEqual([]);
  } finally {
    await db.$disconnect();
  }
});
