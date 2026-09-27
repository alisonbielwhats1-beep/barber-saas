/** Disposable MVP fixture + real Credentials/SSR preflight. No model calls. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertMvpTestDatabase } from "./service-mvp-test-safety";

async function main() {
  assert.equal(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS, "false");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL } } });
  const password = randomBytes(24).toString("base64url"); // Memory only; never logged.
  const email = "mvp-secretaria@local.test";
  const salons = [randomUUID(), randomUUID()];
  let userId = "";
  try {
    console.log("SAFE_TARGET", await assertMvpTestDatabase(admin));
    assert.equal(await admin.user.count({ where: { email } }), 0, "Fixture already exists; do not overwrite credentials");
    // Same bcryptjs/hash cost as signup/actions.ts; existing E2E fixtures use this too.
    const passwordHash = await bcrypt.hash(password, 10);
    await admin.$transaction(async tx => {
      const helper = await tx.user.findFirstOrThrow({ where: { passwordHash: "not-a-login-hash", professional: null }, select: { id: true } });
      const user = await tx.user.create({ data: { email, name: "Owner MVP Secretária", passwordHash, passwordSetAt: new Date() } });
      userId = user.id;
      for (const [index, salonId] of salons.entries()) {
        await tx.$executeRaw`SELECT set_config('app.current_salon', ${salonId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        await tx.salon.create({ data: { id: salonId, slug: `secretary-preflight-${index}-${salonId}`, name: index === 0 ? "Everflair Demo Local" : "Salon B — RLS sintético", accessStatus: "APPROVED" } });
        if (index === 0) await tx.membership.create({ data: { salonId, userId, role: "OWNER" } });
        // Required FK graph only; no booking workflow or delivery worker is invoked.
        const professional = await tx.professional.create({ data: { salonId, userId: index === 0 ? userId : helper.id } });
        const client = await tx.clientProfile.create({ data: { salonId, name: "Fixture RLS — sem pessoa real" } });
        const service = await tx.service.create({ data: { salonId, name: "Fixture FK RLS — não é cadastro da Secretária", durationMin: 5, priceCents: 0, active: false } });
        const appointment = await tx.appointment.create({ data: { salonId, professionalId: professional.id, clientId: client.id, serviceId: service.id, startAt: new Date("2026-01-01T12:00:00Z"), endAt: new Date("2026-01-01T12:05:00Z"), priceCents: 0, status: "CANCELLED" } });
        const event = await tx.appointmentEvent.create({ data: { salonId, appointmentId: appointment.id, eventType: "CREATED", actorType: "SYSTEM", correlationId: randomUUID() } });
        await tx.notificationOutbox.create({ data: { salonId, eventId: event.id, appointmentId: appointment.id, recipientType: "USER", recipientId: userId, recipientKey: `USER:${userId}`, channel: "INTERNAL", template: "synthetic-rls-preflight", payload: { synthetic: true }, status: "SENT", sentAt: new Date() } });
      }
    });
    console.log("FIXTURE", { email, userId, salons, authenticatedAccountsCreated: 1 });
  } finally { await admin.$disconnect(); }

  const runtime = new PrismaClient();
  try {
    const [role] = await runtime.$queryRaw<{ name: string; super: boolean; bypass: boolean }[]>`SELECT current_user AS name, rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`;
    assert.deepEqual(role, { name: "mvp_service_runtime", super: false, bypass: false });
    const [rights] = await runtime.$queryRaw<{ read: boolean; insert: boolean; update: boolean; delete: boolean }[]>`SELECT has_table_privilege(current_user,'"NotificationOutbox"','SELECT') AS read, has_table_privilege(current_user,'"NotificationOutbox"','INSERT') AS insert, has_table_privilege(current_user,'"NotificationOutbox"','UPDATE') AS update, has_table_privilege(current_user,'"NotificationOutbox"','DELETE') AS delete`;
    assert.deepEqual(rights, { read: true, insert: false, update: false, delete: false });
    for (const [index, salonId] of salons.entries()) {
      await runtime.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
        await tx.$executeRaw`SELECT set_config('app.current_user_id',${userId},true)`;
        const rows = await tx.notificationOutbox.findMany(); // Deliberately no tenant WHERE: tests RLS itself.
        assert.equal(rows.length, 1); assert.equal(rows[0].salonId, salonId);
        assert.equal(await tx.notificationOutbox.count({ where: { salonId: salons[1 - index] } }), 0);
      });
    }
    assert.equal(await runtime.notificationOutbox.count(), 0);
    await runtime.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.current_salon','invalid-synthetic-tenant',true)`;
      assert.equal(await tx.notificationOutbox.count(), 0);
    });
    console.log("RLS_POSITIVE_PASS", { A: 1, B: 1, A_sees_B: 0, B_sees_A: 0, absent: 0, invalid: 0, role, rights });
  } finally { await runtime.$disconnect(); }

  // Use the actual local NextAuth HTTP flow, including CSRF and signed session.
  const origin = "http://127.0.0.1:3317";
  const childEnv = { ...process.env, NODE_ENV: "development", NEXTAUTH_URL: origin,
    NEXTAUTH_SECRET: randomBytes(32).toString("hex"), SALON_SECRETARY_ENABLED: "true",
    SALON_SECRETARY_ALLOW_PAID_CALLS: "false", SALON_SECRETARY_OPENAI_API_KEY: "", OPENAI_API_KEY: "",
    MVP_TEST_ADMIN_URL: "", PLATFORM_BILLING_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" };
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3317"], { env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", x => { log += String(x); }); child.stderr.on("data", x => { log += String(x); });
  const jar = new Map<string, string>();
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${origin}${path}`, { ...init, redirect: "manual", headers: { ...init.headers, cookie: [...jar].map(([k,v]) => `${k}=${v}`).join("; ") } });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]; const at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at+1));
    }
    return response;
  }
  try {
    const deadline = Date.now() + 90000;
    while (!log.includes("Ready in")) { if (child.exitCode !== null || Date.now() > deadline) throw new Error("LOCAL_SERVER_NOT_READY"); await new Promise(r => setTimeout(r, 250)); }
    const csrf = await (await request("/api/auth/csrf")).json();
    const auth = await request("/api/auth/callback/credentials", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${origin}/servicos/secretaria` }) });
    assert.equal(auth.status, 200);
    const session = await (await request("/api/auth/session")).json();
    assert.equal(session.user?.id, userId, "Credentials authentication failed");
    console.log("LOGIN_PASS", { provider: "Credentials", userId });
    const page = await request("/servicos/secretaria");
    const html = await page.text();
    assert.equal(page.status, 200, "SECRETARY_PAGE_HTTP_FAILED");
    assert.ok(html.includes("Secretária · teste de serviços"), "SECRETARY_CONTENT_MISSING");
    assert.ok(html.includes('id="main-content"'), "ADMIN_LAYOUT_MISSING");
    assert.ok(html.includes("Everflair Demo Local"), "TENANT_LABEL_MISSING");
    assert.ok(!/permission denied|PrismaClientKnownRequestError/i.test(log), "SERVER_PERMISSION_ERROR");
    console.log("AUTHENTICATED_SSR_PASS", { route: "/servicos/secretaria", status: page.status, adminLayout: true, secretary: true, paidCalls: false, modelRequests: 0 });
  } catch (error) {
    // Only sanitized dependency diagnostics, never HTTP bodies/cookies/credentials.
    console.log("SERVER_DIAGNOSTIC", log.split("\n").filter(line => /permission denied|does not exist|Error:|code:|modelName:|table:/i.test(line)).join("\n"));
    throw error;
  } finally {
    if (child.pid && child.exitCode === null) execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "PREFLIGHT_FAILED"); process.exitCode = 1; });
