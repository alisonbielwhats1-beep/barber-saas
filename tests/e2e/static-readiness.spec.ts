import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const STATIC_ROUTES = [
  "/",
  "/login",
  "/recuperar-senha",
  "/signup",
  "/termos",
  "/privacidade",
  "/contato",
  "/offline",
] as const;

const VIEWPORTS = [
  [320, 568],
  [360, 800],
  [375, 812],
  [390, 844],
  [412, 915],
  [430, 932],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
] as const;

function observeRuntimeFailures(page: Page) {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const request = response.request();
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) {
      failedResponses.push(`${response.status()} ${request.method()} ${response.url()}`);
    }
  });

  return { consoleErrors, failedResponses };
}

async function expectHealthyPage(page: Page) {
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  });

  const brokenImages = await page.locator("img").evaluateAll((images) =>
    images
      .filter(
        (image): image is HTMLImageElement =>
          image instanceof HTMLImageElement && image.complete && image.naturalWidth === 0,
      )
      .map((image) => image.getAttribute("src") ?? "(sem src)"),
  );
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );

  expect(brokenImages).toEqual([]);
  expect(hasHorizontalOverflow).toBe(false);
}

test.describe("@static páginas públicas", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const route of STATIC_ROUTES) {
    test(`${route} não tem erro, imagem quebrada ou violação crítica`, async ({ page }) => {
      const failures = observeRuntimeFailures(page);
      const response = await page.goto(route, { waitUntil: "networkidle" });

      expect(response?.status()).toBe(200);
      await expectHealthyPage(page);

      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        // Estes frames são ilustrações equivalentes a screenshots e já ficam
        // fora da árvore acessível; os controles ao redor continuam auditados.
        .exclude(".landing-phone-mockup")
        .analyze();
      const blockingViolations = accessibility.violations.filter(
        ({ impact }) => impact === "critical" || impact === "serious",
      );

      expect(failures.consoleErrors).toEqual([]);
      expect(failures.failedResponses).toEqual([]);
      expect(
        blockingViolations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, html, any }) => ({
            target,
            html,
            message: any[0]?.message,
          })),
        })),
      ).toEqual([]);
    });
  }

  test("landing respeita todas as larguras-alvo e orientação paisagem", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Matriz completa é executada no Chromium; os três motores cobrem as rotas acima.");
    test.setTimeout(90_000);

    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expectHealthyPage(page);
    }

    for (const [width, height] of [[844, 390], [1024, 768]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expectHealthyPage(page);
    }
  });

  test("manifesto, ícones e fallback offline estão publicáveis", async ({ page, request }) => {
    await page.goto("/");
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBeTruthy();

    const manifestResponse = await request.get(manifestHref!);
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    expect(manifest.display).toBe("standalone");

    for (const icon of manifest.icons) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.ok()).toBe(true);
      expect(iconResponse.headers()["content-type"]).toContain("image/png");
    }

    await expect((await request.get("/offline")).status()).toBe(200);
    await expect((await request.get("/sw.js")).status()).toBe(200);

    const homeResponse = await request.get("/");
    expect(homeResponse.headers()["content-security-policy"]).toContain("object-src 'none'");
    expect(homeResponse.headers()["strict-transport-security"]).toContain("max-age=63072000");
  });

  test("API pública recusa agendamento e fila sem conta", async ({ request }) => {
    const appointment = await request.post("/api/appointments", {
      data: {
        salonId: "salon-inexistente",
        serviceIds: ["service-inexistente"],
        professionalId: "professional-inexistente",
        startLocal: "2026-09-15T12:00",
        idempotencyKey: "2453fc64-922a-4ce8-94f3-27788f9033c2",
        cartItems: [],
      },
    });
    const waitlist = await request.post("/api/waitlist/join", {
      data: {
        salonId: "salon-inexistente",
        appointmentId: "appointment-inexistente",
        professionalId: "professional-inexistente",
        serviceIds: ["service-inexistente"],
      },
    });

    expect(appointment.status()).toBe(401);
    expect(await appointment.json()).toMatchObject({ error: "AUTH_REQUIRED" });
    expect(waitlist.status()).toBe(401);
    expect(await waitlist.json()).toMatchObject({ error: "AUTH_REQUIRED" });
  });
});
