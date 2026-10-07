import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** P3c recurrence guard (flag SALON_SECRETARY_RECURRENCE_GUARD, default off; matrix C03/X01). A create or block whose own words
 * state a recurrence is never prepared as one silent occurrence: "Marco só a primeira (…)?" as a one-option card, and only an
 * explicit yes (the owner's click, or a verified pick of that option) reaches the ordinary proposal and Confirmar. Pure detection,
 * the real scheduling adapter (grounding, journal drafts, proposals) and the real plan path with recorded Luna frames; only tenant
 * lookups are fixtures. Today is Tuesday 29/09/2026 (São Paulo): "sexta" = 02/10, "quinta" = 01/10. A barbershop and a nail
 * studio with diverse synthetic names; no gender is inferred from any name (pronouns come from the owner's text only). */
type Row = { appointment_ref: string; customer_ref: string; customer_name: string; professional_ref: string; professional_name: string; service_ref: string;
  services: { serviceName: string }[]; start_local: string; end_local: string; start_at: string; status: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], proposed: 0, confirmed: [] as string[], batch: 0 }));
const SERVICES: Record<string, string> = { "s-corte": "Corte masculino", "s-gel": "Esmaltação em gel", "s-pezinho": "Pezinho" };
const CUSTOMERS: Record<string, { id: string; name: string }> = { hiroshi: { id: "c-hiroshi", name: "Hiroshi Tanaka" }, jade: { id: "c-jade", name: "Jade Moura" }, kevin: { id: "c-kevin", name: "Kevin Sato" } };
const APPOINTMENTS: Record<string, Row> = { "a-jade": { appointment_ref: "a-jade", customer_ref: "c-jade", customer_name: "Jade Moura", professional_ref: "pro-nara", professional_name: "Nara Quintela",
  service_ref: "s-gel", services: [{ serviceName: "Esmaltação em gel" }], start_local: "2026-10-01T16:00", end_local: "2026-10-01T17:00", start_at: new Date("2026-10-01T16:00:00-03:00").toISOString(), status: "CONFIRMED" } };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(SERVICES).filter(([, label]) => fold(label).startsWith(fold(name).split(" ")[0])).map(([id, label]) => ({ id, name: label })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => {
    const all = [{ id: "pro-nara", name: "Nara Quintela" }, { id: "pro-caio", name: "Caio Brito" }];
    return filter.query ? all.filter(row => fold(row.name).startsWith(fold(filter.query!).split(" ")[0])) : all;
  },
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { date: string; time: string }) => ({ plan: { startLocal: `${input.date}T${input.time}` }, alternatives: [], timezone: "America/Sao_Paulo" }),
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { const row = APPOINTMENTS[ref]; if (!row) throw Error("APPOINTMENT_NOT_FOUND"); return row; } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(CUSTOMERS).filter(([key]) => fold(name).startsWith(key)).map(([, row]) => row),
  getCustomer: async (_tx: unknown, _actor: unknown, ref: string) => { const row = Object.values(CUSTOMERS).find(item => item.id === ref); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return row; } }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, string>) => ({ customer_ref: f.customer_ref, customer_name: f.customer_name, service_ref: f.service_ref, service_revision: "1",
    service_name: SERVICES[f.service_ref] ?? f.service_name, professional_ref: f.professional_ref, professional_name: "Nara Quintela", date: f.date, startLocal: `${f.date}T${f.time}`,
    endLocal: `${f.date}T${String(Number(f.time.slice(0, 2)) + 1).padStart(2, "0")}${f.time.slice(2)}`, timezone: "America/Sao_Paulo", priceCents: 8000, priceType: "FIXED", durationMin: 60, quote: "q" }),
  proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) => {
    db.proposed++;
    return { proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() };
  },
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string }) => { db.confirmed.push(input.proposal_ref); throw Error("CONFIRM_NOT_EXPECTED"); } }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => Object.values(APPOINTMENTS).filter(row => row.customer_ref === f.customer_ref),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => {
      const base = { timezone: "America/Sao_Paulo", resource_ids: [], waiting_hash: "", affected: [], priceCents: 8000 };
      if (operation === "schedule.block") return original.actionSnapshot.parse({ ...base, kind: operation, professional_ref: f.professional_ref, professional_name: "Nara Quintela",
        startLocal: `${f.date}T${f.time}`, endLocal: `${f.end_date ?? f.date}T${f.end_time}`, services: [], requires_acceptance: false, waiting_count: 0 });
      const row = APPOINTMENTS[f.appointment_ref];
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: row.appointment_ref, revision: 1, customer_ref: row.customer_ref, customer_name: row.customer_name,
        professional_ref: row.professional_ref, professional_name: row.professional_name, before_start: row.start_local, before_end: row.end_local, before_timezone: "America/Sao_Paulo",
        startLocal: row.start_local, endLocal: row.end_local, services: [{ id: "s-gel", name: "Esmaltação em gel", durationMin: 60, priceCents: 8000, priceType: "FIXED", priceNote: null, processingMin: 0, finishingMin: 0 }],
        requires_acceptance: false, waiting_count: 0 });
    } };
});
vi.mock("../scheduling-batch", async importOriginal => ({ ...await importOriginal<object>(), upsertBatchDraft: async () => { db.batch++; throw Error("BATCH_NOT_EXPECTED"); } }));
import { recurrenceFromTurn, recurrencePending, recurrenceQuestion, statedRecurrence, unsupportedTurnNotice, FIRST_ONLY_REF, RECURRENCE_CARD } from "../secretary-recurrence";
import { applySchedulingInterpretation, schedulingState, selectScheduling } from "../secretary-scheduling";
import { startBatch } from "../secretary-batch";
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";
import { validateSelectionV2 } from "@everflair/salon-secretary";

const actor = { salonId: "synthetic-barbershop", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_RECURRENCE_GUARD", "true");
  Object.assign(db, { rows: [], proposed: 0, confirmed: [], batch: 0 });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(db.confirmed).toEqual([]); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("closed temporal class (pure; the owner's words only)", () => {
  it.each([
    ["marca o Hiroshi toda sexta às 18h", "toda sexta"], ["bloqueia o almoço da Nara todo dia das 12h às 13h", "todo dia"], ["ela vem toda semana", "toda semana"],
    ["todo mês no dia 5 pra hidratação", "todo mês"], ["toda manhã às 9", "toda manhã"], ["todas as segundas às 9h", "todas as segundas"], ["todos os sábados", "todos os sábados"],
    ["a cada 15 dias", "a cada 15 dias"], ["a cada duas semanas", "a cada duas semanas"], ["cada sexta 10h", "cada sexta"], ["de 15 em 15 dias", "de 15 em 15 dias"],
    ["de quinze em quinze", "de quinze em quinze"], ["quinzenalmente às 10h", "quinzenalmente"], ["um horário fixo semanal", "semanal"], ["nas sextas às 17h", "nas sextas"],
    ["aos sábados de manhã", "aos sábados"], ["sempre na terça às 8h", "sempre na terça"], ["semana sim, semana não", "semana sim, semana não"], ["Toda Sexta-Feira às 10h", "Toda Sexta-Feira"],
    ["não esquece de marcar o Kevin toda sexta", "toda sexta"], ["não, marca toda quinta", "toda quinta"],
  ])("%j states %j", (text, expression) => { expect(statedRecurrence(text)?.expression).toBe(expression); });
  it.each([
    "marca o Hiroshi na sexta às 18h", "toda a semana da Nara está cheia", "bloqueia o dia todo", "todo o dia de sexta", "de 10 em 10 minutos", "de 15 em 20 dias",
    "cada um paga o seu", "segunda e quarta às 10", "amanhã às 9 e depois às 10", "não é toda sexta, só essa", "nem toda semana", "nunca todo dia", "não é pra ser toda sexta",
  ])("%j states no recurrence (a single date, a totality, minutes, or a negated recurrence)", text => { expect(statedRecurrence(text)).toBeUndefined(); });
  it("covers create, block, change and cancel (fixer, review B), never reads, and only with the flag", () => {
    for (const operation of ["appointment.create", "schedule.block", "appointment.change", "appointment.cancel"]) expect(recurrenceFromTurn(undefined, operation, "toda sexta às 10").state).toEqual({ expression: "toda sexta", status: "ASKED" });
    for (const operation of ["appointment.list", "appointment.read", "availability.get"]) expect(recurrenceFromTurn(undefined, operation, "toda sexta às 10")).toEqual({ state: undefined, stated: false });
    // A later turn without recurrence words keeps the state; one that states it again reopens the question even after a yes.
    expect(recurrenceFromTurn({ expression: "toda sexta", status: "FIRST_ONLY" }, "appointment.create", "às 11").state).toEqual({ expression: "toda sexta", status: "FIRST_ONLY" });
    expect(recurrenceFromTurn({ expression: "toda sexta", status: "FIRST_ONLY" }, "appointment.create", "toda sexta mesmo").state?.status).toBe("ASKED");
    vi.stubEnv("SALON_SECRETARY_RECURRENCE_GUARD", "false");
    expect(recurrenceFromTurn(undefined, "appointment.create", "toda sexta às 10")).toEqual({ state: undefined, stated: false });
    expect(recurrencePending({ expression: "toda sexta", status: "ASKED" }, "appointment.create")).toBe(false);
  });
  it("the question names the first occurrence as a human date, with one option", () => {
    expect(recurrenceQuestion("appointment.create", "toda sexta", "2026-10-02", "18:00")).toEqual({
      message: "Ainda não marco horários recorrentes pelo chat (“toda sexta”). Marco só a primeira (sex, 02/10 às 18h)? Nada foi preparado para as outras datas.",
      card: { kind: RECURRENCE_CARD, items: [{ id: FIRST_ONLY_REF, name: "Só a primeira: sex, 02/10 às 18h" }] } });
    expect(recurrenceQuestion("schedule.block", "todo dia", "2026-10-01", "12:00", "2026-10-01T13:00").message).toBe(
      "Ainda não faço bloqueios recorrentes pelo chat (“todo dia”). Bloqueio só a primeira (qui, 01/10 às 12h–13h)? Nada foi preparado para as outras datas.");
  });
  it("a turn Luna declared UNSUPPORTED gets the specific notice only for a stated, undenied recurrence and no more specific capability", () => {
    expect(unsupportedTurnNotice("other", "marca o Kevin toda sexta às 10")).toMatch(/^Ainda não marco horários nem bloqueios recorrentes pelo chat \(“toda sexta”\)\. .*Nada foi preparado\.$/);
    expect(unsupportedTurnNotice(null, "de 15 em 15 dias pra Jade")).toContain("“de 15 em 15 dias”");
    expect(unsupportedTurnNotice("salon_hours", "fecha o salão toda segunda")).toBe("Ainda não consigo configurar horários de trabalho pela Secretária.");
    expect(unsupportedTurnNotice("other", "não é toda sexta")).toBe("Essa capacidade ainda não está disponível pela Secretária. Nenhuma ação foi preparada.");
    vi.stubEnv("SALON_SECRETARY_RECURRENCE_GUARD", "false");
    expect(unsupportedTurnNotice("other", "marca o Kevin toda sexta às 10")).toBe("Essa capacidade ainda não está disponível pela Secretária. Nenhuma ação foi preparada.");
  });
});

const friday = { weekday: 5, time: "18:00", temporal_evidence: [{ field: "date" as const, text: "sexta" }, { field: "time" as const, text: "às 18h" }] };
const hiroshi = { operation: "appointment.create" as const, customer_name: "Hiroshi", service_name: "corte", professional_name: "Nara", ...friday };
describe("the real scheduling adapter", () => {
  it("a create stating 'toda sexta' is a one-option card, never a proposal; only the yes prepares the ordinary proposal", async () => {
    const c = schedulingState();
    const codes = await applySchedulingInterpretation(actor, c, hiroshi, "marca o Hiroshi toda sexta às 18h pra corte com a Nara");
    expect(codes).toEqual(expect.arrayContaining(["RECURRENCE_STATED", "RECURRENCE_ASKED"]));
    expect(c.proposal).toBeUndefined(); expect(db.proposed).toBe(0);
    expect(c.candidates).toEqual({ kind: "recurrence_ref", items: [{ id: FIRST_ONLY_REF, name: "Só a primeira: sex, 02/10 às 18h" }] });
    expect(c.waiting_for).toBe("recurrence_ref");
    expect(c.message).toBe("Ainda não marco horários recorrentes pelo chat (“toda sexta”). Marco só a primeira (sex, 02/10 às 18h)? Nada foi preparado para as outras datas.");
    expect(c.fields).toMatchObject({ date: "2026-10-02", time: "18:00", customer_ref: "c-hiroshi", professional_ref: "pro-nara" });
    await expect(selectScheduling(actor, c, "recurrence-all")).rejects.toThrow("SELECTION_INVALID");
    await selectScheduling(actor, c, FIRST_ONLY_REF);
    expect(c.recurrence).toEqual({ expression: "toda sexta", status: "FIRST_ONLY" });
    expect(c.proposal).toBeDefined(); expect(db.proposed).toBe(1);
    expect(c.message).toBe("NOVO AGENDAMENTO\nUse Confirmar para executar.");
    // The card is gone: a second pick is refused (nothing is chosen twice).
    await expect(selectScheduling(actor, c, FIRST_ONLY_REF)).rejects.toThrow("SELECTION_INVALID");
  });
  it("flag off: today's behaviour (the single occurrence is proposed, no card)", async () => {
    vi.stubEnv("SALON_SECRETARY_RECURRENCE_GUARD", "false");
    const c = schedulingState();
    const codes = await applySchedulingInterpretation(actor, c, hiroshi, "marca o Hiroshi toda sexta às 18h pra corte com a Nara");
    expect(codes).not.toContain("RECURRENCE_ASKED"); expect(c.recurrence).toBeUndefined(); expect(c.candidates).toBeUndefined();
    expect(c.proposal).toBeDefined();
  });
  it("the flag turned off mid-conversation never keeps holding the action (and the card's yes is refused, nothing pending)", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, hiroshi, "marca o Hiroshi toda sexta às 18h pra corte com a Nara");
    vi.stubEnv("SALON_SECRETARY_RECURRENCE_GUARD", "false");
    await expect(selectScheduling(actor, c, FIRST_ONLY_REF)).rejects.toThrow("SELECTION_INVALID");
    expect(c.proposal).toBeUndefined();
  });
  it("a negated recurrence is respected: a single date said, the ordinary proposal", async () => {
    const c = schedulingState();
    const codes = await applySchedulingInterpretation(actor, c, { ...hiroshi, temporal_evidence: [{ field: "date", text: "nessa sexta" }, { field: "time", text: "às 18h" }] },
      "não é toda sexta, marca o Hiroshi só nessa sexta às 18h pra corte com a Nara");
    expect(codes).not.toContain("RECURRENCE_STATED"); expect(c.candidates).toBeUndefined(); expect(c.proposal).toBeDefined();
  });
  it("adversarial: a negator elsewhere in the clause does not hide the recurrence ('não esquece de marcar … toda sexta'): still held, the notice leads", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, hiroshi, "não esquece de marcar o Hiroshi toda sexta às 18h pra corte com a Nara");
    // The historical clause negation guard asks the day and clock again; the recurrence stays owed and is said first.
    expect(c.recurrence).toEqual({ expression: "toda sexta", status: "ASKED", noticed: true }); expect(c.proposal).toBeUndefined(); expect(db.proposed).toBe(0);
    expect(c.message.startsWith("Ainda não marco horários recorrentes pelo chat (“toda sexta”). ")).toBe(true);
  });
  it("the notice is said once: the next question of the same action does not repeat it; the card still names the recurrence", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, { operation: "appointment.create", customer_name: "Hiroshi", service_name: "corte", professional_name: "Nara" },
      "marca o Hiroshi toda sexta pra corte com a Nara");
    expect(c.message.startsWith("Ainda não marco horários recorrentes pelo chat (“toda sexta”). ")).toBe(true);
    await applySchedulingInterpretation(actor, c, { operation: "appointment.create", weekday: 5, temporal_evidence: [{ field: "date", text: "sexta" }] }, "começa nessa sexta");
    expect(c.proposal).toBeUndefined(); expect(c.message).not.toContain("recorrentes");
    await applySchedulingInterpretation(actor, c, { operation: "appointment.create", time: "18:00", temporal_evidence: [{ field: "time", text: "às 18h" }] }, "às 18h");
    expect(c.proposal).toBeUndefined();
    expect(c.message).toBe("Ainda não marco horários recorrentes pelo chat (“toda sexta”). Marco só a primeira (sex, 02/10 às 18h)? Nada foi preparado para as outras datas.");
  });
  it("an answer that changes the clock while the question is open asks again for the new first occurrence (never a proposal)", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, hiroshi, "marca o Hiroshi toda sexta às 18h pra corte com a Nara");
    await applySchedulingInterpretation(actor, c, { operation: "appointment.create", time: "17:00", temporal_evidence: [{ field: "time", text: "às 17h" }] }, "às 17h então");
    expect(c.proposal).toBeUndefined(); expect(db.proposed).toBe(0);
    expect(c.candidates?.items).toEqual([{ id: FIRST_ONLY_REF, name: "Só a primeira: sex, 02/10 às 17h" }]);
  });
  it("after a yes, a later turn that states the recurrence again withdraws the proposal and asks again", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, hiroshi, "marca o Hiroshi toda sexta às 18h pra corte com a Nara");
    await selectScheduling(actor, c, FIRST_ONLY_REF);
    expect(c.proposal).toBeDefined();
    await applySchedulingInterpretation(actor, c, { operation: "appointment.create", ...friday }, "não, eu quero toda sexta às 18h");
    expect(c.proposal).toBeUndefined(); expect(c.candidates?.kind).toBe("recurrence_ref"); expect(c.recurrence?.status).toBe("ASKED");
  });
  it("a block stating 'todo dia' without a day: the notice before the day question, then the card, then the ordinary proposal", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, { operation: "schedule.block", professional_name: "Nara", time: "12:00", end_time: "13:00", reason: "almoço",
      temporal_evidence: [{ field: "time", text: "das 12h" }, { field: "end_time", text: "às 13h" }] }, "fecha a agenda da Nara todo dia das 12h às 13h pro almoço");
    expect(c.proposal).toBeUndefined(); expect(c.waiting_for).toBe("date");
    expect(c.message).toBe("Ainda não faço bloqueios recorrentes pelo chat (“todo dia”). Informe data.");
    await applySchedulingInterpretation(actor, c, { operation: "schedule.block", weekday: 4, temporal_evidence: [{ field: "date", text: "quinta" }] }, "começa na quinta");
    expect(c.proposal).toBeUndefined();
    expect(c.message).toBe("Ainda não faço bloqueios recorrentes pelo chat (“todo dia”). Bloqueio só a primeira (qui, 01/10 às 12h–13h)? Nada foi preparado para as outras datas.");
    await selectScheduling(actor, c, FIRST_ONLY_REF);
    expect(c.proposal).toBeDefined(); expect(c.message).toMatch(/Use Confirmar para executar\.$/);
  });
  it("reads, cancellations and changes are not held by the guard (read-only or out of its scope)", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, { operation: "availability.get", service_name: "corte", professional_name: "Nara", ...friday }, "a Nara tem horário toda sexta às 18h pra corte?");
    expect(c.recurrence).toBeUndefined(); expect(c.candidates?.kind).not.toBe("recurrence_ref");
  });
});

const PLAN = "marca o Kevin toda sexta às 18h pra corte com a Nara";
const pair = (value: unknown, literal: string) => ({ value, literal });
const op = (item_key: string, operation: string, fields: Record<string, unknown> = {}) => ({ operation, item_key, depends_on: null, released_slot_of: null, source_scope: null,
  customer_name: null, service_name: null, professional_name: null, date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null,
  source_weekday: null, source_time: null, end_time: null, end_date: null, reason: null, destination_mode: null, override_requested: null, override_reason: null, ...fields });
const turn = (mode: string, operations: unknown[]) => ({ turn: { mode, operations } });
const kevin = () => op("kevin", "appointment.create", { customer_name: "Kevin", service_name: "corte", professional_name: "Nara", weekday: pair(5, "sexta"), time: pair("18:00", "às 18h") });
async function conversation(first: unknown) {
  const model = new ScriptedServicesModel([call("select_capabilities", first)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const say = (message: string, next?: [string, unknown]) => { if (next) appendScriptedResponses(model, [call(next[0], next[1])]); return secretary.send(actor, { sessionId: session.sessionId, message }); };
  return { secretary, sessionId: session.sessionId, say };
}
const action = (view: SecretaryView, key: string) => view.action_plan!.actions.find(item => item.key === key)!;
const child = (view: SecretaryView, key: string) => view.operations!.find(item => item.action_keys?.includes(key))!;
const codes = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").flatMap(row => (row.metadata as { outcome?: { divergence: { failed_codes: string[] } } }).outcome?.divergence.failed_codes ?? []);

describe("the real plan path (recorded Luna frames, no model)", () => {
  it("NEW: the action waits on the card with the adapter's own question; nothing is confirmable", async () => {
    const { say } = await conversation(turn("NEW", [kevin()]));
    const view = await say(PLAN);
    expect(action(view, "kevin").status).toBe("NEEDS_INPUT");
    expect(view.action_plan!.confirmation_groups.some(group => group.status === "READY_FOR_CONFIRMATION")).toBe(false);
    expect(view.message).toContain("Marco só a primeira (sex, 02/10 às 18h)?");
    expect(child(view, "kevin").state.scheduling!.candidates).toMatchObject({ kind: "recurrence_ref", items: [{ id: FIRST_ONLY_REF }] });
    expect(db.proposed).toBe(0);
  });
  it("a verified pick of the one option ('pode ser') prepares the ordinary proposal, which still needs Confirmar", async () => {
    const { say } = await conversation(turn("NEW", [kevin()]));
    await say(PLAN);
    const view = await say("pode ser, só essa", ["upsert_action_draft", turn("PATCH", [{ item_key: "kevin", choice: { option_id: "opt_1", literal: "pode ser" }, fields: {} }])])
    expect(action(view, "kevin").status).toBe("READY_FOR_CONFIRMATION");
    expect(db.proposed).toBe(1);
  });
  it("adversarial: a negated pick is never a yes (OPTION_LITERAL_NEGATED): asked again, nothing proposed", async () => {
    const { say } = await conversation(turn("NEW", [kevin()]));
    await say(PLAN);
    const view = await say("não, só a primeira não", ["upsert_action_draft", turn("PATCH", [{ item_key: "kevin", choice: { option_id: "opt_1", literal: "não, só a primeira não" }, fields: {} }])]);
    expect(action(view, "kevin").status).toBe("NEEDS_INPUT"); expect(db.proposed).toBe(0);
    expect(codes()).toContain("OPTION_LITERAL_NEGATED");
  });
  it("the owner's click on the option prepares the proposal", async () => {
    const { say, secretary, sessionId } = await conversation(turn("NEW", [kevin()]));
    const view = await say(PLAN);
    const clicked = await secretary.selectAutomatic(actor, sessionId, child(view, "kevin").operation_ref, FIRST_ONLY_REF);
    expect(action(clicked, "kevin").status).toBe("READY_FOR_CONFIRMATION"); expect(db.proposed).toBe(1);
  });
  it("a turn Luna declared UNSUPPORTED that states a recurrence gets the specific notice", async () => {
    const { say } = await conversation({ turn: { mode: "UNSUPPORTED", unavailable_capability: "other", response: "Isso não está disponível." } });
    const view = await say("deixa a Jade fixa de 15 em 15 dias às 16h");
    expect(view.message).toContain("Ainda não marco horários nem bloqueios recorrentes pelo chat (“de 15 em 15 dias”)");
  });
  it("an atomic cancel→create pair whose create states a recurrence prepares nothing (no card there; never one silent occurrence)", async () => {
    const selection = validateSelectionV2({ skills: ["scheduling"], independent: false, operations: [
      { item_key: "a", operation: "appointment.cancel", depends_on: [], released_slot_of: null, source_scope: "cancela a Jade de quinta 16h porque ela mudou de cidade", customer_name: "Jade",
        weekday: 4, time: "16:00", reason: "ela mudou de cidade", target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] },
      { item_key: "b", operation: "appointment.create", depends_on: ["a"], released_slot_of: "a", source_scope: "coloca o Kevin no lugar dela toda quinta", customer_name: "Kevin",
        target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] }] });
    const message = "cancela a Jade de quinta 16h porque ela mudou de cidade e coloca o Kevin no lugar dela toda quinta";
    await expect(startBatch(actor, selection, message)).rejects.toThrow("UNSUPPORTED_DEPENDENCY_ADAPTER");
    expect(db.batch).toBe(0);
  });
});
