import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

test.describe("Supabase Auth + local SMTP recovery", () => {
  test.skip(process.env.RUN_SUPABASE_E2E !== "1", "Requires isolated Supabase CLI and Mailpit");
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  const db = new PrismaClient();
  const password = "InicialSegura123";
  let salonId: string;
  let ownerId: string;
  const slug = `recovery-synthetic-${Date.now()}`;
  const accounts: Record<string, { email: string; authId: string }> = {};
  let provider: ReturnType<typeof createClient>;

  test.beforeAll(async () => {
    for (const key of ["SUPABASE_URL", "DATABASE_URL"]) {
      if (new URL(process.env[key]!).hostname !== "127.0.0.1") throw new Error("Only disposable loopback targets allowed");
    }
    provider = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const salon = await db.salon.create({ data: { slug, name: "Estabelecimento de teste", accessStatus: "APPROVED" } });
    salonId = salon.id;
    for (const app of ["owner", "client"]) {
      const email = `${app}-${Date.now()}@example.test`;
      const { data, error } = await provider.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error("Could not create synthetic identity");
      accounts[app] = { email, authId: data.user.id };
      await db.authIdentity.create({ data: { id: data.user.id } });
      if (app === "owner") {
        const user = await db.user.create({ data: { email, name: "Dono de teste", authIdentityId: data.user.id } });
        ownerId = user.id;
        await db.membership.create({ data: { salonId, userId: user.id, role: "OWNER" } });
      } else {
        await db.clientProfile.create({ data: { salonId, name: "Cliente de teste", email, authIdentityId: data.user.id } });
      }
    }
  });
  test.afterAll(async () => {
    // CI containers are disposable; no destructive cleanup runs against a remote target.
    await db.$disconnect();
  });

  async function recoveryLink(email: string) {
    let result = "";
    await expect.poll(async () => {
      const response = await fetch("http://127.0.0.1:54324/api/v1/messages");
      const inbox = await response.json() as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
      const message = inbox.messages.find(item => item.To.some(recipient => recipient.Address === email));
      if (!message) return false;
      const detail = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${message.ID}`)).json() as { HTML: string };
      result = detail.HTML.match(/href="([^"]+token_hash=[^"]+)"/)?.[1].replaceAll("&amp;", "&") ?? "";
      return !!result;
    }, { timeout: 30_000 }).toBe(true);
    expect(new URL(result).origin).toBe("http://127.0.0.1:3100");
    return result;
  }

  for (const app of ["owner", "client"]) {
    test(`${app}: login → email → link → new password → correct login`, async ({ page }) => {
      await page.setViewportSize(app === "owner" ? { width: 1440, height: 900 } : { width: 390, height: 844 });
      const prefix = app === "owner" ? "" : `/book/${slug}`;
      await page.goto(`${prefix}/login`);
      await page.getByRole("link", { name: "Esqueci minha senha", exact: true }).click();
      await page.getByLabel("E-mail", { exact: true }).fill(`missing-${app}@example.test`);
      await page.getByRole("button", { name: "Enviar link de recuperação" }).click();
      await expect(page.getByRole("status")).toContainText("Se existir uma conta associada");
      await page.getByLabel("E-mail", { exact: true }).fill(accounts[app].email);
      await page.getByRole("button", { name: "Enviar link de recuperação" }).click();
      await expect(page.getByRole("status")).toContainText("Se existir uma conta associada");
      const link = await recoveryLink(accounts[app].email);
      expect(new URL(link).pathname).toBe(`${prefix}/redefinir-senha`);
      await page.goto(link);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Criar nova senha" })).toBeVisible();
      await page.getByLabel("Nova senha", { exact: true }).fill("somenteletras");
      await page.getByLabel("Confirmar nova senha", { exact: true }).fill("somenteletras");
      await page.getByRole("button", { name: "Atualizar senha" }).click();
      await expect(page.getByRole("alert")).toContainText("número");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/${app}-recovery-form.png`, fullPage: true });
      await page.getByLabel("Nova senha", { exact: true }).fill("NovaSegura123");
      await page.getByLabel("Confirmar nova senha", { exact: true }).fill("OutraSegura123");
      await page.getByRole("button", { name: "Atualizar senha" }).click();
      await expect(page.getByRole("alert")).toContainText("As senhas não coincidem");
      await page.getByLabel("Confirmar nova senha", { exact: true }).fill("NovaSegura123");
      await page.getByRole("button", { name: "Atualizar senha" }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/login\\?senha=alterada$`));
      await expect(page.getByRole("status")).toContainText("Senha atualizada com sucesso");
      await page.getByLabel(/E-?mail/i).fill(accounts[app].email);
      await page.getByLabel("Senha", { exact: true }).fill("NovaSegura123");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page).not.toHaveURL(/\/login/);
      if (app === "owner") {
        const response = await page.request.get("/api/auth/session");
        expect((await response.json()).user.id).toBe(ownerId);
      } else await expect(page).toHaveURL(new RegExp(`/book/${slug}`));
      // An old password is rejected by the provider itself.
      const old = await createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_AUTH_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
        .auth.signInWithPassword({ email: accounts[app].email, password });
      expect(old.error).toBeTruthy();
      await page.goto(link);
      await page.getByLabel("Nova senha", { exact: true }).fill("TerceiraSegura123");
      await page.getByLabel("Confirmar nova senha", { exact: true }).fill("TerceiraSegura123");
      await page.getByRole("button", { name: "Atualizar senha" }).click();
      await expect(page.getByRole("alert")).toContainText("inválido, expirou ou já foi utilizado");
      await page.goto(`${prefix}/redefinir-senha`);
      await expect(page.getByRole("alert")).toContainText("inválido");
      await expect(page.getByLabel("Nova senha", { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/${app}-recovery-invalid.png`, fullPage: true });
    });
  }
  test("expired provider link is rejected", async ({ page }) => {
    const generated = await provider.auth.admin.generateLink({ type: "recovery", email: accounts.owner.email });
    if (generated.error) throw new Error("Could not create synthetic recovery");
    await db.$executeRaw`UPDATE auth.users SET recovery_sent_at = now() - interval '2 hours' WHERE id = ${accounts.owner.authId}::uuid`;
    await page.goto(`/redefinir-senha?type=recovery&token_hash=${generated.data.properties.hashed_token}`);
    await page.getByLabel("Nova senha", { exact: true }).fill("ExpiradaSenha123");
    await page.getByLabel("Confirmar nova senha", { exact: true }).fill("ExpiradaSenha123");
    await page.getByRole("button", { name: "Atualizar senha" }).click();
    await expect(page.getByRole("alert")).toContainText("inválido, expirou ou já foi utilizado");
  });
});
