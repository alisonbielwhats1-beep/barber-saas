import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { withAgentMessage } from "../../../packages/salon-secretary/src/agent-context";
import type { AgentLookupCall } from "../../../packages/salon-secretary/src/agent-tools";
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc } from "../time";

/** C5 WP3 (flag SALON_SECRETARY_AGENT; docs/c5-spike/11-especificacao-agente.md §8.6) on the local disposable PostgreSQL with a pool
 * of ONE connection (connection_limit=1 in DATABASE_URL, as the serverless pooler): one round of 4 lookups and a second round end
 * without P2024 and within the 3 s round budget; the reads are tenant scoped (another salon's homonym never appears) and nothing
 * is written. Coordinator only (RUN_SERVICE_MVP_INTEGRATION=1, the MVP database preflight); skips without it. The app modules are
 * imported after DATABASE_URL gets its pool limit, so their Prisma client opens with it. Synthetic barbershop, no network or model. */
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
    const owner = await tx.user.create({ data: { name: "Responsável Sintética", email: `c5wp3-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: `Synthetic C5 lookups ${label}`, slug: `c5wp3-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: tz } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    const service = (name: string, durationMin: number, priceCents: number) => tx.service.create({ data: { salonId, name, durationMin, priceCents } });
    const barba = await service("Barba", 20, 3500), corte = await service("Corte", 30, 5000), combo = await service("Corte e barba", 50, 8000);
    const pro = async (name: string, services: { id: string }[]) => {
      const user = await tx.user.create({ data: { name, email: `c5wp3-${randomUUID()}@example.test`, passwordHash: "synthetic-no-login" } });
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      for (const item of services) await tx.professionalService.create({ data: { serviceId: item.id, professionalId: professional.id } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1080 })) });
      return professional;
    };
    const heloisa = await pro("Heloísa Tavares", [barba, corte, combo]), ubirata = await pro("Ubiratã Souza", [corte]);
    const customer = (name: string) => tx.clientProfile.create({ data: { salonId, name } });
    const yaraM = await customer("Yara Montenegro"), yaraQ = await customer("Yara Quintas"), zuleide = await customer("Zuleide Prado");
    return { actor: { salonId, userId: owner.id }, barba, corte, combo, heloisa, ubirata, yaraM, yaraQ, zuleide };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function book(f: Fixture, client: { id: string }, professional: { id: string }, service: { id: string; name: string; durationMin: number; priceCents: number }, date: string, clock: string,
  status: "PENDING" | "CONFIRMED" | "CANCELLED") {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
    const startAt = localDateTimeToUtc(`${date}T${clock}`, tz), endAt = new Date(+startAt + service.durationMin * 60_000);
    return tx.appointment.create({ data: { salonId: f.actor.salonId, clientId: client.id, professionalId: professional.id, serviceId: service.id, startAt, endAt, timezone: tz,
      priceCents: service.priceCents, status, serviceItems: { create: [{ serviceId: service.id, position: 0, serviceName: service.name, durationMin: service.durationMin, priceCents: service.priceCents }] } } });
  });
}
const counts = (f: Fixture) => admin.$transaction(async tx => {
  await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
  return { appointments: await tx.appointment.count({ where: { salonId: f.actor.salonId } }), audit: await tx.auditLog.count({ where: { salonId: f.actor.salonId } }),
    customers: await tx.clientProfile.count({ where: { salonId: f.actor.salonId } }) };
});

suite("C5 WP3 lookups on PostgreSQL with a pool of one connection (read-only, tenant scoped)", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", poolOfOne(process.env.DATABASE_URL ?? ""));
    admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
    console.log("C5_AGENT_LOOKUPS_PREFLIGHT", await assertMvpTestDatabase(admin));
    // A client cached by an earlier module graph of this worker would keep its own pool: the app modules open a fresh one here.
    delete (globalThis as { prisma?: unknown }).prisma;
    app = await import("../prisma"); lookups = await import("../secretary-agent-lookups");
    vi.stubGlobal("fetch", network);
  });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await admin?.$disconnect(); await app?.prisma.$disconnect(); });

  it("a round of 4 lookups and a second round: no P2024, within 3 s, PENDING/CONFIRMED only, another salon never seen, nothing written", async () => {
    expect(new URL(process.env.DATABASE_URL ?? "").searchParams.get("connection_limit")).toBe("1");
    const f = await fixture("A"), other = await fixture("B"), date = addCalendarDays(dateKeyInTimeZone(new Date(), tz), 3);
    await book(f, f.yaraM, f.heloisa, f.corte, date, "10:00", "CONFIRMED");
    await book(f, f.yaraQ, f.heloisa, f.barba, date, "11:00", "PENDING");
    await book(f, f.zuleide, f.ubirata, f.corte, date, "10:00", "CANCELLED");
    await book(other, other.yaraM, other.heloisa, other.corte, date, "10:00", "CONFIRMED");
    const before = await counts(f);
    const executor = lookups.createAgentLookupExecutor(f.actor);
    const calls: AgentLookupCall[] = [
      { name: "consultar_agenda", callId: "call_1", input: { data: date, profissional: null, de: null, ate: null } },
      { name: "buscar_cliente", callId: "call_2", input: { nome: "Yara", a_partir_de: null } },
      { name: "horarios_livres", callId: "call_3", input: { data: date, servicos: ["s2"], profissional: null, de: "09:00", ate: null } },
      { name: "catalogo_servicos", callId: "call_4", input: { servicos: ["s3"] } },
    ];
    await withAgentMessage({ owner: ["Yara Montenegro e Yara Quintas"], executor }, async context => {
      const opened = await executor.directory(context);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.directory.professionals.map(p => p.nome)).toEqual(["Heloísa Tavares", "Ubiratã Souza"]);
      expect(opened.directory.services.map(s => [s.ref, s.nome])).toEqual([["s1", "Barba"], ["s2", "Corte"], ["s3", "Corte e barba"]]);
      const started = performance.now(), first = (await executor.round(calls, context)).map(text => JSON.parse(text)), elapsed = performance.now() - started;
      expect(first.filter(out => out.erro)).toEqual([]);
      expect(elapsed).toBeLessThan(3000);
      const [agenda, customers, slots, catalog] = first;
      expect(agenda.total).toBe(2);
      expect(agenda.profissionais.flatMap((p: { atendimentos: { status: string }[] }) => p.atendimentos.map(a => a.status)).sort()).toEqual(["confirmado", "pendente"]);
      expect(customers).toMatchObject({ total: 2, muitos: false });
      expect(customers.clientes.map((c: { nome: string }) => c.nome).sort()).toEqual(["Yara Montenegro", "Yara Quintas"]);
      expect(slots.profissionais.map((p: { ref: string }) => p.ref)).toEqual(["p1", "p2"]);
      expect(catalog.servicos[0]).toMatchObject({ ref: "s3", combo_de: ["s2", "s1"], feito_por: ["p1"] });
      const second = (await executor.round([{ name: "jornada_profissional", callId: "call_5", input: { profissional: "p1", data: null } }], context)).map(text => JSON.parse(text));
      expect(second[0].erro).toBeUndefined();
      expect(second[0].dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(context.binding.entries("c").map(entry => entry.id).sort()).toEqual([f.yaraM.id, f.yaraQ.id].sort());
    });
    expect(await counts(f)).toEqual(before);
  });
});
