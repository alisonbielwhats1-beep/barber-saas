import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import AxeBuilder from "@axe-core/playwright";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
import {
  addCalendarDays,
  dateKeyInTimeZone,
  localDateTimeToUtc,
} from "../../src/lib/time";

test("@database visita conjunta no cliente e no painel, folga e bloqueio após expediente", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente banco descartável.");
  test.setTimeout(360000);
  page.setDefaultTimeout(20000);
  assertSafeDatabaseOperation(process.env, { operation: "multi-visits-e2e" });
  const db = new PrismaClient(),
    suffix = crypto.randomUUID().slice(0, 8),
    password = "synthetic-visits-123";
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const salon = await db.salon.create({
      data: {
        slug: `visita-${suffix}`,
        name: "Studio Visita",
        plan: "PRO",
        accessStatus: "APPROVED",
        bufferMinutes: 0,
      },
    });
    const date = addCalendarDays(
        dateKeyInTimeZone(new Date(), salon.timezone),
        3,
      ),
      dayoff = addCalendarDays(date, 1);
    const owner = await db.user.create({
      data: {
        name: "Anderson",
        email: `owner-${suffix}@example.test`,
        passwordHash,
        memberships: { create: { salonId: salon.id, role: "OWNER" } },
      },
    });
    const user = await db.user.create({
      data: {
        name: "Tati",
        email: `pro-${suffix}@example.test`,
        passwordHash,
        memberships: { create: { salonId: salon.id, role: "PROFESSIONAL" } },
      },
    });
    const pros = await Promise.all(
      [owner, user].map((u) =>
        db.professional.create({ data: { salonId: salon.id, userId: u.id } }),
      ),
    );
    const services = await Promise.all(
      pros.map((p, i) =>
        db.service.create({
          data: {
            salonId: salon.id,
            name: i ? "Unhas" : "Corte",
            durationMin: i ? 60 : 30,
            priceCents: i ? 6000 : 5000,
            professionals: { create: { professionalId: p.id } },
          },
        }),
      ),
    );
    await db.professionalOpening.createMany({
      data: pros.map((p) => ({
        salonId: salon.id,
        professionalId: p.id,
        dateKey: date,
        startMinutes: 540,
        endMinutes: 1140,
        reason: "Abertura sintética",
      })),
    });
    await db.auditLog.create({
      data: {
        salonId: salon.id,
        actorName: "Configuração sintética",
        action: "BOOKING_PREFERENCES_UPDATED",
        entityType: "Salon",
        entityId: salon.id,
        metadata: { simultaneousPairs: [[services[0]!.id, services[1]!.id]] },
      },
    });
    const client = await db.clientProfile.create({
      data: {
        salonId: salon.id,
        name: `Cliente visita ${suffix}`,
        email: `client-${suffix}@example.test`,
        passwordHash,
      },
    });
    const token = await new SignJWT({
      clientId: client.id,
      salonId: salon.id,
      name: client.name,
      email: client.email,
      sessionVersion: client.sessionVersion,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET!));
    await context.addCookies([
      {
        name: "client_token",
        value: token,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/book/${salon.slug}/agendar?services=${services.map((s) => s.id).join(",")}`,
    );
    await page.getByLabel("Dia da visita").fill(date);
    await page
      .getByRole("button", { name: "15:00 até 16:30", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Revisar minha visita", exact: true })
      .click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include("section")
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath(`visita-revisao-${width}.png`),
      });
    }
    await page
      .getByRole("button", { name: "Confirmar visita", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Visita confirmada" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Ver minha visita" }).click();
    await expect(
      page.getByRole("region", { name: "Minha visita", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    expect(
      await db.appointment.count({
        where: { salonId: salon.id, clientId: client.id },
      }),
    ).toBe(2);
    await page.goto(
      `/book/${salon.slug}/agendar?services=${services.map((s) => s.id).join(",")}`,
    );
    await page.getByLabel("Dia da visita").fill(date);
    await page
      .getByLabel("Quando fazer este serviço?")
      .selectOption("together");
    await page
      .getByRole("button", { name: "10:00 até 11:00", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Revisar minha visita", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirmar visita", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Visita confirmada" }),
    ).toBeVisible();
    expect(
      await db.appointment.count({
        where: {
          salonId: salon.id,
          startAt: localDateTimeToUtc(`${date}T10:00`, salon.timezone),
        },
      }),
    ).toBe(2);
    await page.goto("/login");
    await page.getByLabel("Email").fill(owner.email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30000 });
    await page.goto(`/agenda?date=${dayoff}`);
    await page
      .getByRole("button", { name: "Abrir ações rápidas da agenda" })
      .click();
    await page.getByRole("menuitem", { name: /Novo agendamento/ }).click();
    const simple = page.getByRole("dialog");
    await simple.getByLabel("Pesquisar cliente").fill(client.name);
    await simple.getByRole("button").filter({hasText:client.name}).click();
    await simple.getByRole("button", {name:"Alterar data, horário e profissional"}).click();
    await simple.getByLabel("Hora de início").fill("21:00");
    await simple.getByRole("button", {name:"Aplicar",exact:true}).click();
    await simple.getByRole("button", {name:"Continuar",exact:true}).click();
    await simple.getByRole("checkbox").first().check();
    await simple.getByRole("button", {name:"Adicionar outro profissional",exact:true}).click();
    const dialog = page.getByRole("dialog", {
      name: "Novo agendamento",
    });
    await dialog.getByRole("button", { name: "Serviço 1", exact: true }).click();
    await page.getByRole("dialog", { name: "Serviço 1", exact: true }).getByRole("button", { name: /Corte/ }).click();
    await dialog
      .getByRole("button", { name: "Adicionar outro serviço" })
      .click();
    await dialog.getByRole("button", { name: "Serviço 2", exact: true }).click();
    await page.getByRole("dialog", { name: "Serviço 2", exact: true }).getByRole("button", { name: /Unhas/ }).click();
    await dialog.getByText("Exceção de horário", {exact:true}).click();
    await dialog
      .getByLabel("Agendar em folga, intervalo ou fora do expediente")
      .check();
    await dialog
      .getByLabel("Motivo desta exceção")
      .fill("Cliente atendido na folga");
    await dialog
      .getByRole("button", { name: "Revisar visita", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Confirmar todos os serviços" }),
    ).toBeVisible();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[role="dialog"]')
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await dialog.screenshot({
        path: test.info().outputPath(`visita-painel-${width}.png`),
      });
    }
    await dialog
      .getByRole("button", { name: "Confirmar todos os serviços" })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(await db.appointment.count({ where: { salonId: salon.id } })).toBe(
      6,
    );
    await db.timeOff.create({
      data: {
        professionalId: pros[0]!.id,
        startAt: localDateTimeToUtc(`${date}T21:00`, salon.timezone),
        endAt: localDateTimeToUtc(`${date}T23:00`, salon.timezone),
        reason: "Bloqueio após expediente",
      },
    });
    await page.goto(`/agenda?date=${date}`);
    await expect(
      page.getByRole('button', { name: 'Agendar 22:30 com Anderson', exact:true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole('button',{name:/Abrir bloqueio de Anderson, 21:00/}).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath("agenda-bloqueio-23h.png"),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    // Staff move takes effect before the client opens the confirmation.
    await page.getByRole("button", { name: new RegExp(`${client.name}, Corte, .*Anderson.*Abrir detalhes`) }).first().click();
    const editDialog = page.getByRole("dialog");
    await editDialog.getByRole("button", { name: /Editar/ }).click();
    await editDialog.getByLabel("Horário do agendamento").fill("18:30");
    await editDialog.getByRole("button", { name: "Revisar alterações" }).click();
    await editDialog.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(editDialog.getByText(/O novo horário já está reservado/)).toBeVisible();
    await editDialog.getByRole("button", { name: "Concluir", exact: true }).click();
    const pendingMove = await db.rescheduleProposal.findFirstOrThrow({ where: { salonId: salon.id, status: "PENDING" }, include: { appointment: true } });
    expect(pendingMove.appointment.startAt).toEqual(localDateTimeToUtc(`${date}T18:30`, salon.timezone));
    expect(pendingMove.appointment.version).toBe(2);
    await expect(page.getByRole("button", { name: new RegExp(`${client.name}, Corte, 18:30, Anderson`) })).toBeVisible();
    const clientContext = await page.context().browser()!.newContext({ baseURL, viewport: { width: 390, height: 900 } });
    try {
      await clientContext.addCookies([{ name: "client_token", value: token, url: baseURL! }]);
      const clientPage = await clientContext.newPage();
      await clientPage.goto(`/book/${salon.slug}/minhas`);
      await expect(clientPage.getByText("Horário já reservado para você")).toBeVisible();
      await expect(clientPage.getByText(/O horário anterior foi liberado/)).toBeVisible();
      expect((await new AxeBuilder({ page: clientPage }).include('[aria-labelledby="pending-proposals-title"]').withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
      await expect(clientPage.locator(".ef-intro")).toHaveCount(0);
      await clientPage.locator('[aria-labelledby="pending-proposals-title"]').screenshot({ path: test.info().outputPath("remarcacao-reservada-390.png") });
      await clientPage.getByRole("button", { name: "Recusar", exact: true }).click();
      await expect(clientPage.getByRole("dialog")).toContainText("o horário antigo não será restaurado");
      await clientPage.getByRole("button", { name: "Recusar alteração", exact: true }).click();
      await expect(clientPage.getByText("Horário já reservado para você")).toHaveCount(0);
      expect(await db.appointment.findUniqueOrThrow({ where: { id: pendingMove.appointmentId } })).toEqual(pendingMove.appointment);
      await page.reload();
      // First mobile entry: the new guide is dismissible and must not hide the reservation.
      await page.getByRole("button", { name: "Pular tutorial", exact: true }).click();
      const refusedCard = page.getByRole("button", { name: new RegExp(`${client.name}, Corte, 18:30, Anderson`) });
      await expect(refusedCard).toContainText("Alteração recusada");
      await refusedCard.click();
      await expect(page.getByText("Cliente recusou a alteração · entre em contato")).toBeVisible();
    } finally {
      await clientContext.close();
    }
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 });
    await page.goto(`/agenda?date=${dayoff}`);
    await page.getByRole("button", { name: "Pular tutorial", exact: true }).click();
    await page
      .getByRole("button", { name: "Abrir ações rápidas da agenda" })
      .click();
    await page.getByRole("menuitem", { name: /folga/i }).click();
    const block = page.getByRole("dialog", {
      name: "Adicionar folga",
    });
    await expect(
      block.getByRole("checkbox", { name: "Tati", exact: true }),
    ).toBeChecked();
    await expect(
      block.getByRole("checkbox", { name: "Anderson", exact: true }),
    ).toHaveCount(0);
    await block.getByRole("button", { name: "Revisar bloqueio" }).click();
    await block.getByRole("button", { name: "Confirmar bloqueio" }).click();
    await expect(block.getByRole("status")).toContainText(
      "Disponibilidade bloqueada",
    );
    await expect(block.getByText("Cancelar reservas selecionadas")).toHaveCount(
      0,
    );
    expect(
      await db.appointment.count({
        where: { salonId: salon.id, status: "CONFIRMED" },
      }),
    ).toBe(6);
    expect(
      await db.timeOff.count({ where: { professionalId: pros[1]!.id } }),
    ).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await db.$disconnect();
  }
});
