import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";
import { submitLoginWithoutErrorFlash } from "./helpers/login-feedback";

for (const width of [390, 1440]) {
  test(`@database login do cliente sem falso erro durante redirect (${width}px)`, async ({ page }) => {
    test.skip(!process.env.RUN_DATABASE_E2E, "Only disposable database");
    test.setTimeout(120_000);
    assertSafeDatabaseOperation(process.env, { operation: "client-login-feedback" });
    const db = new PrismaClient();
    try {
      const suffix = crypto.randomUUID();
      const salon = await db.salon.create({ data: { slug: `login-feedback-${suffix}`, name: "Login sintético", accessStatus: "APPROVED" } });
      const email = `login-${suffix}@example.test`;
      await db.clientProfile.create({ data: { salonId: salon.id, email, name: "Cliente sintético", phone: "11911112222", passwordHash: await bcrypt.hash("SenhaSintetica123", 10) } });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/book/${salon.slug}/login`);
      await page.getByLabel("E-mail", { exact: true }).fill(email);
      await page.getByLabel("Senha", { exact: true }).fill("SenhaIncorreta123");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page.locator('p[role="alert"]')).toContainText("E-mail ou senha incorretos", { timeout: 30_000 });
      await page.getByLabel("Senha", { exact: true }).fill("SenhaSintetica123");
      await submitLoginWithoutErrorFlash(page);
      await expect(page).toHaveURL(new RegExp(`/book/${salon.slug}$`));
    } finally {
      await db.$disconnect();
    }
  });
}
