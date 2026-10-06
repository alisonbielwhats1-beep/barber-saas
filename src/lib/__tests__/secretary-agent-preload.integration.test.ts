import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { withAgentMessage, AGENT_LIMITS } from "../../../packages/salon-secretary/src/agent-context";
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc } from "../time";

/** S1 fix B1 (flag SALON_SECRETARY_AGENT_PRELOAD; owner decision 13) on the local disposable PostgreSQL with a pool of ONE connection
 * (connection_limit=1, as the serverless pooler): the preload's union prefilter (EXISTS over the owner's words) runs on the real
 * "ClientProfile" table, its reads fit one transaction in sequence without P2024 and within the 3 s round budget, another salon's homonym
 * never appears and nothing is written. Coordinator only (RUN_SERVICE_MVP_INTEGRATION=1, the MVP database preflight); skips without it.
 * Synthetic nail and hair studio, diverse names; no network or model. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const tz = "America/Sao_Paulo";
let admin: PrismaClient;
let app: typeof import("../prisma");
let lookups: typeof import("../secretary-agent-lookups");
const poolOfOne = (url: string) => { const parsed = new URL(url); parsed.searchParams.set("connection_limit", "1"); return parsed.toString(); };

async function fixture(label: string) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: "Responsável Sintética", email: `s1b1-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: `Synthetic S1 preload ${label}`, slug: `s1b1-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: tz } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    const service = (name: string, durationMin: number, priceCents: number) => tx.service.create({ data: { salonId, name, durationMin, priceCents } });
    const escova = await service("Escova", 40, 6000), manicure = await service("Manicure", 45, 3500);
    const pro = async (name: string, services: { id: string }[]) => {
      const user = await tx.user.create({ data: { name, email: `s1b1-${randomUUID()}@example.test`, passwordHash: "synthetic-no-login" } });
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      for (const item of services) await tx.professionalService.create({ data: { serviceId: item.id, professionalId: professional.id } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1080 })) });
      return professional;
    };
    const iolanda = await pro("Iolanda Prates", [escova]), kaito = await pro("Kaito Moreira", [escova, manicure]);
    const customer = (name: string) => tx.clientProfile.create({ data: { salonId, name } });
    const lavinia = await customer("Lavínia Okoro"), laviniaP = await customer("Lavínia Prado"), ondina = await customer("Ondina Salgado");
    return { actor: { salonId, userId: owner.id }, escova, manicure, iolanda, kaito, lavinia, laviniaP, ondina };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function book(f: Fixture, client: { id: string }, professional: { id: string }, service: { id: string; name: string; durationMin: number; priceCents: number }, date: string, clock: string) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
    const startAt = localDateTimeToUtc(`${date}T${clock}`, tz), endAt = new Date(+startAt + service.durationMin * 60_000);
    return tx.appointment.create({ data: { salonId: f.actor.salonId, clientId: client.id, professionalId: professional.id, serviceId: service.id, startAt, endAt, timezone: tz,
      priceCents: service.priceCents, status: "CONFIRMED", serviceItems: { create: [{ serviceId: service.id, position: 0, serviceName: service.name, durationMin: service.durationMin, priceCents: service.priceCents }] } } });
  });
}
const counts = (f: Fixture) => admin.$transaction(async tx => {
  await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
  return { appointments: await tx.appointment.count({ where: { salonId: f.actor.salonId } }), audit: await tx.auditLog.count({ where: { salonId: f.actor.salonId } }),
    customers: await tx.clientProfile.count({ where: { salonId: f.actor.salonId } }) };
});

suite("S1 fix B1: the agent's preload on PostgreSQL with a pool of one connection (read-only, tenant scoped)", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", poolOfOne(process.env.DATABASE_URL ?? ""));
    vi.stubEnv("SALON_SECRETARY_AGENT_PRELOAD", "true");
    admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
    console.log("S1_AGENT_PRELOAD_PREFLIGHT", await assertMvpTestDatabase(admin));
    delete (globalThis as { prisma?: unknown }).prisma;
    app = await import("../prisma"); lookups = await import("../secretary-agent-lookups");
    vi.stubGlobal("fetch", network);
  });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await admin?.$disconnect(); await app?.prisma.$disconnect(); });

  it("the customer and the day said: one extra transaction, no P2024, within 3 s, the other salon's homonym never read, nothing written", async () => {
    expect(new URL(process.env.DATABASE_URL ?? "").searchParams.get("connection_limit")).toBe("1");
    const f = await fixture("A"), other = await fixture("B"), date = addCalendarDays(dateKeyInTimeZone(new Date(), tz), 3);
    await book(f, f.lavinia, f.iolanda, f.escova, date, "10:00");
    await book(f, f.ondina, f.kaito, f.manicure, date, "11:00");
    await book(other, other.lavinia, other.iolanda, other.escova, date, "10:00");
    const before = await counts(f), executor = lookups.createAgentLookupExecutor(f.actor);
    await withAgentMessage({ owner: ["Remarca a Lavínia Okoro para dentro de 3 dias às 15h com a Iolanda"], executor }, async context => {
      const started = performance.now(), opened = await executor.directory(context), elapsed = performance.now() - started;
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(elapsed).toBeLessThan(3000 + 1000);
      const text = opened.directory.preload!, items = JSON.parse(text) as { consulta: string; argumentos: Record<string, unknown>; resultado: Record<string, any> }[];
      expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(AGENT_LIMITS.preloadBytes);
      expect(items.map(item => item.consulta)).toEqual(["buscar_cliente", "consultar_agenda"]);
      expect(items[0].argumentos).toEqual({ nome: "Lavínia Okoro", a_partir_de: null });
      expect(items[0].resultado.clientes.map((c: { nome: string }) => c.nome)).toEqual(["Lavínia Okoro"]);
      expect(items[1].argumentos).toEqual({ data: date, profissional: null, de: null, ate: null });
      expect(items[1].resultado.total).toBe(2);
      // Only this salon's customers are bound (the homonym of the other salon never).
      const bound = context.binding.entries("c").map(entry => entry.id);
      expect(bound).toContain(f.lavinia.id); expect(bound).not.toContain(other.lavinia.id); expect(bound).not.toContain(f.laviniaP.id);
      expect(lookups.agentLookupTelemetry(context)).toMatchObject({ rounds: 0, calls: 0, unavailable: 0, preload: { items: 2, kinds: ["T2", "T1"], skipped: 0 } });
    });
    expect(await counts(f)).toEqual(before);
  });
});
