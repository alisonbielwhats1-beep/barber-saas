import { expect, test } from "@playwright/test";

test("@database ações fixas respeitam o recorte em paisagem", async ({ page }) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Somente dados fictícios.");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("dono@lunahair.com");
  await page.getByLabel("Senha", { exact: true }).fill("demo1234");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
  await page.getByRole("link", { name: "Agenda", exact: true }).click();
  const action = page.getByRole("button", { name: "Abrir ações rápidas da agenda" });
  await expect(action).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--safe-left", "44px");
    document.documentElement.style.setProperty("--safe-right", "44px");
  });
  const box = (await action.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(800);
  await page.screenshot({ path: test.info().outputPath("agenda-paisagem-area-segura.png") });
});

test("@static cabeçalho institucional mantém controles na área segura", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/contato");
    const top = viewport.width === 390 ? 59 : 0;
    const side = viewport.width === 844 ? 44 : 0;
    await page.evaluate(({ top, side }) => {
      document.documentElement.style.setProperty("--safe-top", `${top}px`);
      document.documentElement.style.setProperty("--safe-left", `${side}px`);
      document.documentElement.style.setProperty("--safe-right", `${side}px`);
    }, { top, side });
    const controls = page.locator("header a:visible, header button:visible");
    for (const control of await controls.all()) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(top);
      expect(box.x).toBeGreaterThanOrEqual(side);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - side);
    }
  }
});

test("@database excluir da lista, restaurar e fechar formulário com teclado", async ({ page }) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Dados fictícios em banco descartável.");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("dono@lunahair.com");
  await page.getByLabel("Senha", { exact: true }).fill("demo1234");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 60_000 });
  await page.goto("/clientes");
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Novo cliente" });
  await expect(form).toBeVisible();
  expect(await form.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, "height", { configurable: true, value: 280 });
    Object.defineProperty(viewport, "offsetTop", { configurable: true, value: 70 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect.poll(async () => (await form.boundingBox())!.height).toBeLessThanOrEqual(264);
  await form.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const close = form.getByRole("button", { name: "Fechar janela" });
  await expect(close).toBeInViewport();
  const closeBox = (await close.boundingBox())!;
  expect(closeBox.y).toBeGreaterThanOrEqual(70);
  expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(350);
  await form.screenshot({ path: test.info().outputPath("formulario-teclado-simulado.png") });
  await close.click();
  await expect(form).not.toBeVisible();
  await page.reload();
  const row = page.getByLabel("Lista de clientes").locator("button").first();
  const label = await row.locator("p").first().innerText();
  await row.click();
  await page.getByRole("button", { name: "Excluir da lista", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar exclusão da lista" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Ver clientes excluídos" }).click();
  await page.getByLabel("Lista de clientes").locator("button").filter({ hasText: label }).first().click();
  await page.getByRole("button", { name: "Restaurar à lista", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar restauração" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Lista de clientes").locator("button").filter({ hasText: label })).toHaveCount(0);
});

test("@static entrada da landing respeita área segura em retrato e paisagem", async ({ page }) => {
  await page.goto("/");
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-top", "59px");
      document.documentElement.style.setProperty("--safe-left", "16px");
      document.documentElement.style.setProperty("--safe-right", "16px");
    });
    const entry = page.locator("header").getByRole("link", { name: "Entrar", exact: true });
    await expect(entry).toBeVisible();
    const box = (await entry.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(59);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 16);
    await page.screenshot({ path: test.info().outputPath(`landing-${viewport.width}.png`) });
  }
});

test("@database matriz de enquadramento das telas públicas e do estabelecimento", async ({ page }) => {
  test.skip(!process.env.RUN_DATABASE_E2E, "Dados fictícios em banco descartável.");
  test.setTimeout(480_000);
  const findings: unknown[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  const inspect = async (route: string) => {
    const response = await page.goto(route, { timeout: 60_000 });
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.locator("main, #main-content").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("main .animate-shimmer")).toHaveCount(0, { timeout: 30_000 });
    for (const size of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      const overflow = await page.evaluate(() => {
        const el = document.querySelector("main") ?? document.documentElement;
        return el.scrollWidth - el.clientWidth;
      });
      if (overflow > 1) findings.push({ route, size, overflow });
      const clipped = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("main button, main input, main select, main a")).filter(el => {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height || getComputedStyle(el).visibility === "hidden" || (box.left >= -1 && box.right <= innerWidth + 1)) return false;
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) return false;
        }
        return true;
      }).map(el => ({ tag: el.tagName, text: el.textContent?.trim().slice(0, 50), label: el.getAttribute("aria-label") })));
      if (clipped.length) findings.push({ route, size, clipped });
    }
  };
  for (const route of ["/login", "/signup", "/recuperar-senha", "/termos", "/privacidade", "/contato", "/book/luna-hair/welcome", "/book/luna-hair/login", "/book/luna-hair/cadastro", "/book/luna-hair/recuperar-senha", "/book/luna-hair", "/book/luna-hair/agendar", "/book/luna-hair/produtos", "/book/luna-hair/portfolio", "/book/luna-hair/avaliacoes"])
    await inspect(route);
  await page.goto("/book/luna-hair/cadastro");
  await page.getByLabel("Nome completo").fill("Cliente da matriz responsiva");
  await page.getByLabel("E-mail", { exact: true }).fill(`responsive-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("Senha", { exact: true }).fill("responsive-test-2026");
  await page.getByLabel("Confirmar senha", { exact: true }).fill("responsive-test-2026");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(page).not.toHaveURL(/\/cadastro/, { timeout: 30_000 });
  for (const route of ["minhas", "notificacoes", "carrinho"]) await inspect(`/book/luna-hair/${route}`);
  await page.goto("/login");
  await page.getByLabel("Email").fill("dono@lunahair.com");
  await page.getByLabel("Senha", { exact: true }).fill("demo1234");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(hoje|dashboard)$/, { timeout: 30_000 });
  for (const route of ["hoje", "dashboard", "agenda", "clientes", "profissionais", "servicos", "financeiro", "relatorios", "produtos", "fechamento", "portfolio", "notificacoes", "compartilhar", "avaliacoes", "pacotes", "configuracoes", "marketing", "pagamentos"])
    await inspect(`/${route}`);
  await test.info().attach("enquadramento.json", { body: JSON.stringify(findings, null, 2), contentType: "application/json" });
  expect(findings).toEqual([]);
});
