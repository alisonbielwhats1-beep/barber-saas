import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
import {
  addCalendarDays,
  dateKeyInTimeZone,
  localDateTimeToUtc,
} from "../../src/lib/time";

test("@database baixa por dia com extras, ontem, seleção e recibo na mesma tela", async ({
  page,
}) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Banco descartável obrigatório");
  test.setTimeout(180000);
  assertSafeDatabaseOperation(process.env, { operation: "receipts023-e2e" });
  const db = new PrismaClient();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const salon = await db.salon.findUniqueOrThrow({
      where: { slug: "luna-hair" },
    });
    const service = await db.service.findFirstOrThrow({
      where: { salonId: salon.id, active: true },
      include: { professionals: true },
    });
    const suffix = crypto.randomUUID().slice(0, 8);
    const date = addCalendarDays(
      dateKeyInTimeZone(new Date(), salon.timezone),
      -1,
    );
    const clients = await Promise.all(
      ["Receber", "Deixar pendente"].map((name) =>
        db.clientProfile.create({
          data: { salonId: salon.id, name: `${name} ${suffix}` },
        }),
      ),
    );
    const appointments = await Promise.all(
      clients.map((c) =>
        db.appointment.create({
          data: {
            salonId: salon.id,
            clientId: c.id,
            professionalId: service.professionals[0]!.professionalId,
            serviceId: service.id,
            startAt: localDateTimeToUtc(`${date}T10:00`, salon.timezone),
            endAt: localDateTimeToUtc(`${date}T11:00`, salon.timezone),
            status: "COMPLETED",
            priceCents: 5000,
          },
        }),
      ),
    );
    await page.goto("/login");
    await page.getByLabel("Email").fill("dono@lunahair.com");
    await page.getByLabel("Senha", { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30000 });
    await page.goto("/financeiro");
    await page.getByText("Recebimentos, despesas e detalhamento", {exact:true}).click();
    await expect(
      page.getByRole("heading", { name: "Recebimentos por dia" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Fechamento", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Pagamentos", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: `Abrir recebimentos de ${date.split("-").reverse().join("/")}`,
      })
      .click();
    const dialog = page.getByRole("dialog", { name: /Recebimentos/ });
    await expect(dialog.getByLabel("Data do recebimento")).toHaveValue(date);
    await dialog.getByRole("button", { name: "Limpar seleção" }).click();
    await dialog
      .getByRole("checkbox", {
        name: `Selecionar ${clients[0]!.name}`,
        exact: true,
      })
      .check();
    const row = dialog.locator("article").filter({ hasText: clients[0]!.name });
    await row.getByText(/Adicionar serviços realizados/).click();
    await row
      .getByRole("combobox", {
        name: `Adicionar serviço para ${clients[0]!.name}`,
      })
      .selectOption(service.id);
    await row.getByLabel("Acréscimo (R$)").fill("15,50");
    await row
      .getByLabel(`Motivo do acréscimo de ${clients[0]!.name}`)
      .fill("Acabamento combinado");
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
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
        path: test.info().outputPath(`recebimentos-${width}.png`),
      });
    }
    await dialog
      .getByRole("button", { name: /Dar baixa em 1 atendimento/ })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "1 recebimento(s) registrado(s)",
    );
    const paid = await db.payment.findUniqueOrThrow({
      where: { appointmentId: appointments[0]!.id },
    });
    expect(paid.amountCents).toBe(6550 + service.priceCents);
    expect(dateKeyInTimeZone(paid.paidAt, salon.timezone)).toBe(date);
    expect(
      await db.payment.findUnique({
        where: { appointmentId: appointments[1]!.id },
      }),
    ).toBeNull();
    await dialog.getByRole("button", { name: "Fechar janela" }).click();
    await page
      .getByRole("button", {
        name: `Abrir recebimentos de ${date.split("-").reverse().join("/")}`,
      })
      .click();
    await dialog.getByText(/Já recebidos neste dia/).click();
    const paidRow = dialog
      .locator("details > div")
      .filter({ hasText: clients[0]!.name });
    await paidRow.getByRole("button", { name: "Ver recibo" }).click();
    const receipt = page.getByRole("dialog", { name: "Recibo do atendimento" });
    await expect(
      receipt.getByText("Acréscimo · Acabamento combinado"),
    ).toBeVisible();
    await expect(
      receipt.getByText("Total recebido", { exact: true }),
    ).toBeVisible();
    await receipt.screenshot({
      path: test.info().outputPath("recibo-extras.png"),
    });
    await page.goto("/agenda");
    await page.getByLabel("Colorir agenda por").selectOption("category");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.entries(localStorage).some(
            ([key, value]) =>
              key.startsWith("agenda-colors:v1:") && value === "category",
          ),
        ),
      )
      .toBe(true);
    await page.reload();
    await expect(page.getByLabel("Colorir agenda por")).toHaveValue("category");
    await page.goto("/hoje");
    await expect(page.getByLabel("Colorir agenda por")).toHaveValue("category");
    expect(errors).toEqual([]);
  } finally {
    await db.$disconnect();
  }
});
