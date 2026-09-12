import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("@database pedidos de serviços, fechamento e cadastro", () => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente banco descartável e dados fictícios.");

  test("equipe cria exceção e troca/adiciona serviços no celular", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await page.getByLabel("Email").fill("dono@lunahair.com");
    await page.getByLabel("Senha", { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
    await page.goto(`/agenda?date=${test.info().retry ? "2032-08-06" : "2032-08-05"}`);
    await page.getByRole("button", { name: "Abrir ações rápidas da agenda" }).click();
    await page.getByRole("menuitem", { name: /Novo agendamento/ }).click();
    const form = page.getByRole("dialog", { name: "Novo agendamento" });
    await form.getByLabel("Hora de início").fill("18:30");
    await form.getByRole("button", { name: "Novo cliente", exact: true }).click();
    const client = `Feedback sintético ${Date.now()}`;
    await form.locator('input[name="clientName"]').fill(client);
    await form.getByRole("checkbox", { name: /Corte feminino/ }).check();
    await form.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(form.getByText("Término após o expediente", { exact: true })).toBeVisible();
    await form.getByLabel("Motivo da exceção").fill("Exceção sintética após 19h");
    await form.getByRole("button", { name: "Agendar com término após o expediente" }).click();
    await expect(form).not.toBeVisible();
    await page.getByText(client, { exact: true }).first().click();
    let detail = page.getByRole("dialog", { name: client });
    await detail.getByRole("button", { name: /Editar/ }).click();
    await detail.getByRole("checkbox", { name: /Corte feminino/ }).uncheck();
    await detail.getByRole("checkbox", { name: /Escova modelada/ }).check();
    await detail.getByRole("checkbox", { name: /Hidratação profunda/ }).check();
    await expect(detail.getByText(/1h45/)).toBeVisible();
    await detail.getByRole("button", { name: "Salvar alterações" }).click();
    await detail.getByLabel("Motivo da exceção").fill("Novos serviços combinados");
    await detail.getByRole("button", { name: "Confirmar término após o expediente" }).click();
    await expect(detail.getByText("Agendamento atualizado.")).toBeVisible();
    await detail.getByRole("button", { name: "Concluir" }).click();
    await page.getByText(client, { exact: true }).first().click();
    detail = page.getByRole("dialog", { name: client });
    await expect(detail.getByText("Escova modelada + Hidratação profunda", { exact: true })).toBeVisible();
    await detail.getByRole("button", { name: /Editar/ }).click();
    for (const width of [390, 320, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
      await detail.screenshot({ path: test.info().outputPath(`servicos-edicao-sintetica-${width}.png`) });
    }
    expect(errors).toEqual([]);
  });

  test("cadastro repetido com senha correta recupera acesso; outra senha não entra", async ({ page, context }) => {
    test.setTimeout(90_000);
    const email = `feedback-${Date.now()}@example.test`;
    const fill = async (password: string) => {
      await page.goto("/book/luna-hair/cadastro");
      await page.getByLabel("Nome completo").fill("Cadastro sintético");
      await page.getByLabel("E-mail", { exact: true }).fill(email);
      await page.getByLabel("Senha", { exact: true }).fill(password);
      await page.getByLabel("Confirmar senha", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Criar conta", exact: true }).click();
    };
    await fill("Synthetic1234");
    await expect(page).toHaveURL(/\/book\/luna-hair$/, { timeout: 30_000 });
    await context.clearCookies();
    await fill("WrongPassword1234");
    await expect(page.getByRole("alert").filter({ hasText: "Não foi possível acessar com esta senha" })).toBeVisible();
    expect((await context.cookies()).some(cookie => cookie.name === "client_token")).toBe(false);
    await page.getByLabel("Senha", { exact: true }).fill("Synthetic1234");
    await page.getByLabel("Confirmar senha", { exact: true }).fill("Synthetic1234");
    await page.getByRole("button", { name: "Criar conta", exact: true }).click();
    await expect(page).toHaveURL(/\/book\/luna-hair$/, { timeout: 30_000 });
    expect((await context.cookies()).some(cookie => cookie.name === "client_token")).toBe(true);
  });
});
