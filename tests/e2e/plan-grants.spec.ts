import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";

test.describe("@database administrative plan courtesy", () => {
  test.skip(!process.env.RUN_DATABASE_E2E || process.env.PLATFORM_PLAN_GRANTS_ENABLED !== "true", "Disposable database and courtesy flag required.");
  test("reviews modern terms, grants and shows the same expiry in HQ on mobile and desktop", async ({ page }) => {
    test.setTimeout(240000);
    assertSafeDatabaseOperation(process.env, { operation: "grant-browser-fixture" });
    const db = new PrismaClient();
    const email = crypto.randomUUID()+"@grant.example.test", password = "synthetic-grant-browser-2026";
    const name = "Synthetic courtesy " + crypto.randomUUID().slice(0,8);
    const through = new Date(Date.now()+5*86400000).toISOString().slice(0,10);
    try {
      await db.user.create({ data: { email, name: "Synthetic admin", platformRole: "SUPER_ADMIN", passwordHash: await bcrypt.hash(password,10), passwordSetAt: new Date() } });
      const salon = await db.salon.create({ data: { name, slug: crypto.randomUUID(), accessStatus: "APPROVED" } });
      const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
      await page.goto("/login");
      await page.getByLabel("Email").fill(email); await page.getByLabel("Senha", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page).toHaveURL(/\/plataforma/, { timeout: 30000 });
      await page.goto("/plataforma/solicitacoes");
      const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
      await card.getByRole("button", { name: "Plano e cortesia" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Plano", { exact: true })).toHaveValue("INDIVIDUAL");
      await expect(dialog).toContainText("39,90");
      await expect(dialog.getByRole("option")).toHaveCount(4);
      await dialog.getByLabel("Grátis até (inclusive)").fill(through);
      await dialog.getByLabel("Motivo da cortesia").fill("Synthetic browser review");
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(false);
        await expect(dialog.getByRole("button", { name: "Confirmar cortesia" })).toBeVisible();
        await page.screenshot({ path: test.info().outputPath(`grant-${width}.png`), fullPage: true });
      }
      await dialog.getByRole("button", { name: "Confirmar cortesia" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(card).toContainText("Individual · cortesia até");
      expect(await db.salonPlanGrant.count({ where: { salonId: salon.id } })).toBe(1);
      expect(await db.billingSubscription.count({ where: { salonId: salon.id } })).toBe(0);
      await page.goto("/hq/customers?q="+encodeURIComponent(name));
      await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Individual · cortesia");
      await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Cortesia até:");
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page.getByText(/Cortesia administrativa até/)).toBeVisible();
      expect(errors).toEqual([]);
    } finally { await db.$disconnect(); }
  });
});
