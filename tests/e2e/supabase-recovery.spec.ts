import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { submitLoginWithoutErrorFlash } from "./helpers/login-feedback";

test.describe("Supabase Auth + local SMTP recovery", () => {
  test.skip(process.env.RUN_SUPABASE_E2E !== "1", "Requires isolated Supabase CLI and Mailpit");
  test.describe.configure({ mode: "serial", timeout: 90_000, retries: 0 });
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

  test("new establishment enters without email verification while Supabase stays enabled", async ({ page }) => {
    const email = `signup-paused-${Date.now()}@example.test`;
    await page.goto("/signup");
    await page.getByLabel("Nome do estabelecimento", { exact: true }).fill("Cadastro sintético sem link");
    await page.getByLabel("Seu nome", { exact: true }).fill("Dono sintético");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByLabel("Confirmar senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Criar meu espaço", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding\/configuracao/, { timeout: 30_000 });
    const owner = await db.user.findUniqueOrThrow({ where: { email } });
    expect(owner.authIdentityId).toBeNull();
    expect(await bcrypt.compare(password, owner.passwordHash!)).toBe(true);
    expect((await (await page.request.get("/api/auth/session")).json()).user.id).toBe(owner.id);
    expect(await db.authIdentity.findUnique({ where: { email } })).toBeNull();
    const inbox = await (await fetch("http://127.0.0.1:54324/api/v1/messages")).json() as {
      messages: Array<{ To: Array<{ Address: string }> }>;
    };
    expect(inbox.messages.some(message => message.To.some(to => to.Address === email))).toBe(false);
  });

  test("customer signup, resend, confirmation and login preserve the original eight-character password", async ({ page }) => {
    const email = `signup-client-${Date.now()}@example.test`;
    const originalPassword = "Nova1234";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/book/${slug}/cadastro`);
    await page.getByLabel("Nome completo").fill("Cliente sintético");
    await page.getByLabel(/WhatsApp/).fill("11912345678");
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(originalPassword);
    await page.getByLabel("Confirmar senha", { exact: true }).fill(originalPassword);
    await page.getByRole("button", { name: "Criar conta", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Confirme seu e-mail");
    const profile = await db.clientProfile.findFirstOrThrow({ where: { salonId, email } });
    const firstLink = await recoveryLink(email);
    expect(new URL(firstLink).pathname).toBe("/auth/confirm");
    expect(new URL(firstLink).searchParams.get("next")).toBe(`http://127.0.0.1:3100/book/${slug}/login`);
    await page.locator("form").getByRole("link", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?/);
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(originalPassword);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("E-mail ou senha incorretos");
    await expect(page.getByText(/Confirme seu e-mail pelo link recebido antes de entrar/)).toBeVisible();
    await page.getByRole("button", { name: "Reenviar confirmação de e-mail" }).click();
    await expect(page.getByRole("status")).toContainText("Se houver um cadastro");
    await expect.poll(async () => {
      const inbox = await (await fetch("http://127.0.0.1:54324/api/v1/messages")).json() as { messages: Array<{ To: Array<{ Address: string }> }> };
      return inbox.messages.filter(message => message.To.some(to => to.Address === email)).length;
    }).toBe(2);
    const link = await recoveryLink(email);
    await page.goto(link);
    await page.reload(); // Reading/scanning the link must not consume it.
    await page.getByRole("button", { name: "Confirmar meu e-mail" }).click();
    await expect(page).toHaveURL(`http://127.0.0.1:3100/book/${slug}/login`);
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(originalPassword);
    await submitLoginWithoutErrorFlash(page);
    expect(await db.clientProfile.count({ where: { salonId, email } })).toBe(1);
    expect((await db.clientProfile.findUniqueOrThrow({ where: { id: profile.id } })).authIdentityId).toBe(profile.authIdentityId);
    // A used link keeps the customer on the same salon instead of requiring a reset.
    await page.goto(link);
    await page.getByRole("button", { name: "Confirmar meu e-mail" }).click();
    await expect(page.getByText(/Se você já confirmou o e-mail, entre com sua senha/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Voltar para o login" })).toHaveAttribute("href", `http://127.0.0.1:3100/book/${slug}/login`);
  });

  for (const app of ["owner", "client"]) {
    test(`${app}: login → email → link → new password → correct login`, async ({ page }) => {
      await page.setViewportSize(app === "owner" ? { width: 1440, height: 900 } : { width: 390, height: 844 });
      const prefix = app === "owner" ? "" : `/book/${slug}`;
      await page.goto(`${prefix}/login`);
      await page.getByRole("link", { name: "Esqueci minha senha", exact: true }).click();
      // Both customer screens label their input E-mail. Wait for the route
      // transition so automation cannot fill the departing login field.
      await expect(page).toHaveURL(new RegExp(`${prefix}/recuperar-senha$`));
      await expect(page.getByRole("heading", { name: "Recuperar senha", exact: true })).toBeVisible();
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
      await expect(page.locator('p[role="alert"]')).toContainText("número");
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `test-results/${app}-recovery-form-${width}.png`, fullPage: true });
      }
      await page.getByLabel("Nova senha", { exact: true }).fill("Nova1234");
      await page.getByLabel("Confirmar nova senha", { exact: true }).fill("OutraSegura123");
      await page.getByRole("button", { name: "Atualizar senha" }).click();
      await expect(page.locator('p[role="alert"]')).toContainText("As senhas não coincidem");
      await page.getByLabel("Confirmar nova senha", { exact: true }).fill("Nova1234");
      await page.getByRole("button", { name: "Atualizar senha" }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/login\\?senha=alterada$`));
      await expect(page.getByRole("status")).toContainText("Senha atualizada com sucesso");
      await page.getByLabel(/E-?mail/i).fill(accounts[app].email);
      await page.getByLabel("Senha", { exact: true }).fill("Nova1234");
      await submitLoginWithoutErrorFlash(page);
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
      await expect(page.locator('p[role="alert"]')).toContainText("inválido, expirou ou já foi utilizado");
      await page.goto(`${prefix}/redefinir-senha`);
      await expect(page.locator('p[role="alert"]')).toContainText("inválido");
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
    await expect(page.locator('p[role="alert"]')).toContainText("inválido, expirou ou já foi utilizado");
  });

  test("legacy passwords and reservations stay intact until voluntary recovery completes", async ({ page, browser }) => {
    const email = `legacy-${Date.now()}@example.test`;
    const ownerHash = await bcrypt.hash("DonoAtual123", 10);
    const clientHash = await bcrypt.hash("ClienteAtual123", 10);
    const owner = await db.user.create({ data: { email, name: "Identidade compartilhada", passwordHash: ownerHash } });
    await db.membership.create({ data: { userId: owner.id, salonId, role: "OWNER" } });
    const profile = await db.clientProfile.create({ data: { salonId, email, name: "Mesmo e-mail", phone: "11911112222", notes: "Histórico preservado", passwordHash: clientHash } });
    const professional = await db.professional.create({ data: { salonId, userId: owner.id } });
    const service = await db.service.create({ data: { salonId, name: "Serviço preservado", durationMin: 30, priceCents: 7000 } });
    const reservation = await db.appointment.create({ data: { salonId, clientId: profile.id, professionalId: professional.id,
      serviceId: service.id, startAt: new Date("2027-01-10T14:00:00Z"), endAt: new Date("2027-01-10T14:30:00Z"), priceCents: 7000, status: "CONFIRMED" } });
    const previousOwnerContext = await browser.newContext();
    const oldOwnerPage = await previousOwnerContext.newPage();
    await oldOwnerPage.goto("http://127.0.0.1:3100/login");
    await oldOwnerPage.getByLabel("Email", { exact: true }).fill(email);
    await oldOwnerPage.getByLabel("Senha", { exact: true }).fill("DonoAtual123");
    await oldOwnerPage.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(oldOwnerPage).not.toHaveURL(/\/login/);
    await page.goto(`/book/${slug}/login`);
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill("ClienteAtual123");
    await submitLoginWithoutErrorFlash(page);
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).authIdentityId).toBeNull();
    expect((await db.clientProfile.findUniqueOrThrow({ where: { id: profile.id } })).passwordHash).toBe(clientHash);

    await page.goto("/recuperar-senha");
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Enviar link de recuperação" }).click();
    await expect(page.getByRole("status")).toContainText("Se existir uma conta associada");
    // Requesting or ignoring a link must not change credentials or revoke sessions.
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).passwordHash).toBe(ownerHash);
    expect((await db.clientProfile.findUniqueOrThrow({ where: { id: profile.id } })).authIdentityId).toBeNull();
    expect((await (await oldOwnerPage.request.get("http://127.0.0.1:3100/api/auth/session")).json()).user.id).toBe(owner.id);
    const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_AUTH_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    await page.goto(await recoveryLink(email));
    await page.getByLabel("Nova senha", { exact: true }).fill("Compartilhada123");
    await page.getByLabel("Confirmar nova senha", { exact: true }).fill("Compartilhada123");
    await page.getByRole("button", { name: "Atualizar senha" }).click();
    await expect(page).toHaveURL(/\/login\?senha=alterada$/);
    const signedIn = await client.auth.signInWithPassword({ email, password: "Compartilhada123" });
    expect(signedIn.error).toBeNull();
    expect(signedIn.data.user?.email_confirmed_at).toBeTruthy();
    await page.goto(`/book/${slug}/login`);
    await page.getByLabel(/E-?mail/i).fill(email);
    await page.getByLabel("Senha", { exact: true }).fill("Compartilhada123");
    await submitLoginWithoutErrorFlash(page);
    const migratedOwner = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    const migratedClient = await db.clientProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(migratedOwner.authIdentityId).toBe(signedIn.data.user!.id);
    expect(migratedClient.authIdentityId).toBe(migratedOwner.authIdentityId);
    expect(migratedClient.passwordHash).toBeNull();
    expect(migratedOwner.passwordHash).toBeNull();
    expect(migratedClient.name).toBe(profile.name);
    expect(migratedClient.phone).toBe(profile.phone);
    expect(migratedClient.notes).toBe(profile.notes);
    expect(await db.appointment.findUniqueOrThrow({ where: { id: reservation.id } })).toEqual(reservation);
    expect((await (await oldOwnerPage.request.get("http://127.0.0.1:3100/api/auth/session")).json()).user.id).toBe("");
    await previousOwnerContext.close();
  });

  test("rate limit has the same feedback for an unknown email", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": "192.0.2.51" });
    await page.goto("/recuperar-senha");
    for (let index = 0; index < 6; index++) {
      await page.getByLabel("E-mail", { exact: true }).fill(`unknown-limit-${index}@example.test`);
      await page.getByRole("button", { name: "Enviar link de recuperação" }).click();
      if (index < 5) {
        await expect(page.getByRole("button", { name: "Enviar link de recuperação" })).toBeEnabled();
        await expect(page.getByRole("status")).toContainText("Se existir uma conta associada");
      }
    }
    await expect(page.locator('p[role="alert"]')).toContainText("Muitas solicitações");
  });
});
