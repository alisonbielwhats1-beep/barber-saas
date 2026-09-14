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
    ).toBeVisible();
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
    await page
      .getByRole("button", {
        name: "Adicionar serviços com profissionais diferentes",
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Uma visita, vários serviços",
    });
    await dialog.getByRole('combobox', {name:'Cliente', exact:true}).selectOption(client.id);
    await dialog.getByLabel("Início", { exact: true }).fill("21:00");
    await dialog
      .getByRole('combobox', {name:'Serviço 1', exact:true})
      .selectOption(services[0]!.id);
    await dialog
      .getByRole("button", { name: "Adicionar outro serviço" })
      .click();
    await dialog
      .getByRole('combobox', {name:'Serviço 2', exact:true})
      .selectOption(services[1]!.id);
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
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 });
    await page.goto(`/agenda?date=${dayoff}`);
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
