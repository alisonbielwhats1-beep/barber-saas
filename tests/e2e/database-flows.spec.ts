import { expect, test } from "@playwright/test";

test.describe("@database jornadas críticas no PostgreSQL descartável", () => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Exige o banco descartável preparado pelo CI.");

  test("proprietário entra e vê apenas os clientes do seu estabelecimento", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/login");
    await page.getByLabel("Email").fill("dono@lunahair.com");
    await page.getByLabel("Senha", { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
    await page.goto("/clientes");
    await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
    await expect(page.getByText("Beatriz Lima")).toBeVisible();
    await expect(page.getByText("Matheus Carvalho")).toHaveCount(0);
  });

  test("cliente cria conta, volta à home e conclui um agendamento", async ({ page }) => {
    test.setTimeout(120_000);
    const email = `e2e-${Date.now()}-${test.info().workerIndex}@example.test`;

    await page.goto("/book/luna-hair/welcome");
    await expect(page.getByRole("link", { name: "Entrar na minha conta" })).toBeVisible();
    await page.getByRole("link", { name: "Criar uma conta" }).click();
    await page.getByLabel("Nome completo").fill("Cliente E2E");
    await page.getByLabel(/WhatsApp/).fill("11912345678");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill("senha-e2e-123");
    await page.getByLabel("Confirmar senha").fill("senha-e2e-123");
    await page.getByRole("button", { name: "Criar conta" }).click();

    await expect(page).toHaveURL(/\/book\/luna-hair$/);
    // No `next dev`, a compilação da rota pesada pode manter o evento `load`
    // aberto por vários segundos. A navegação é comprovada no commit e a tela
    // pronta pela asserção do título logo abaixo.
    await page.getByRole("link", { name: "Agendar agora", exact: true }).first().click({
      noWaitAfter: true,
    });
    await page.waitForURL(/\/book\/luna-hair\/agendar$/, {
      timeout: 45_000,
      waitUntil: "commit",
    });
    await expect(page.getByRole("heading", { name: "Escolha os serviços" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /Corte feminino/ }).click();
    await page.getByRole("button", { name: "Continuar com 1 serviço" }).click();
    await page.getByRole("button", { name: /Camila/ }).click();

    const dateButtons = page.locator('button[aria-label*=" de "]');
    let foundSlot = false;
    for (let index = 0; index < await dateButtons.count(); index += 1) {
      const dateButton = dateButtons.nth(index);
      if (await dateButton.isDisabled()) continue;
      await dateButton.click();
      const slot = page.getByRole("button", { name: /^Horário \d{2}:\d{2}/ }).first();
      try {
        await slot.waitFor({ state: "visible", timeout: 2_500 });
        await slot.click();
        foundSlot = true;
        break;
      } catch {
        // Procura o próximo dia útil quando o atual não tem disponibilidade.
      }
    }

    expect(foundSlot).toBe(true);
    await page.getByRole("button", { name: "Revisar reserva" }).click();
    await page.getByRole("button", { name: "Confirmar reserva" }).click();
    await expect(page.getByRole("heading", { name: "Reserva confirmada" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver minhas reservas" })).toBeVisible();
  });
});
