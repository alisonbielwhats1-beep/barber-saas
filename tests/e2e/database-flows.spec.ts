import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

    await expect(page).toHaveURL(/\/book\/luna-hair$/, { timeout: 15_000 });
    // Confirma que a sessão recém-criada sobrevive a uma navegação completa e
    // evita confundir a URL já atualizada com o DOM antigo durante a compilação
    // sob demanda do Next no runner.
    await page.goto("/book/luna-hair", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await expect(page).toHaveURL(/\/book\/luna-hair$/);
    // A rota de agendamento revalida no servidor o cookie, o tenant, o cliente
    // canônico e a versão da sessão. Abrir a URL diretamente evita depender do
    // streaming visual da home no `next dev`; qualquer sessão inválida ainda
    // redireciona para welcome e faz as asserções abaixo falharem.
    await page.goto("/book/luna-hair/agendar", {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(/\/book\/luna-hair\/agendar$/);
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
    await page.getByText("Agendar para outra pessoa", { exact: true }).click();
    await page.getByLabel("Nome da pessoa").fill("Dependente E2E");
    await page.getByLabel("Vínculo", { exact: true }).fill("Filho");
    await page.getByRole("button", { name: "Adicionar pessoa", exact: true }).click();
    await expect(page.getByLabel("Quem será atendido?")).toContainText("Dependente E2E");
    await page.getByText("Lista de espera por período", { exact: true }).click();
    await page.getByRole("button", { name: "Solicitar encaixe no período" }).click();
    await expect(page.getByText("Pedido registrado. Acompanhe a confirmação em seus agendamentos.")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("cliente-dependente-fila.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Revisar reserva" }).click();
    await page.getByRole("button", { name: "Confirmar reserva" }).click();
    await expect(page.getByRole("heading", { name: "Reserva confirmada" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver minhas reservas" })).toBeVisible();
    await page.getByRole("link", { name: "Ver minhas reservas" }).click();
    await expect(page.getByText("Atendimento para Dependente E2E")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.client-reservation[data-status="CONFIRMED"]')).toHaveCSS("background-color", "rgb(18, 61, 46)");
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await page.screenshot({ path: test.info().outputPath("cliente-reserva-confirmada.png"), fullPage: true, animations: "disabled" });
  });
});
