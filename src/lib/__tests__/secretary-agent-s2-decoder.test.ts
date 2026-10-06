import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_DEPENDENCY_FLAGS, createAgentBinding, withAgentMessage } from "../../../packages/salon-secretary/src/agent-context";
import { AGENT_BASE_REQUIRED_FIELDS, AgentPlanError, agentPlanViolations, decodeAgentPlan, decodeAgentPlanArguments, type AgentPlan,
  type AgentPlanAction } from "../../../packages/salon-secretary/src/agent-plan";
import { nameHasTokens, nameTokenQuery } from "../secretary-name-tokens";
import { withoutArticle } from "../name-search";
import { validateAgentPlan, type AgentApptFact, type AgentFactReader } from "../secretary-agent-validator";

/** S2 fix B2 (flag SALON_SECRETARY_AGENT; docs/c5-spike/11-especificacao-agente.md §4 decode rules): the decoder no longer sends a whole plan
 * to the C4 for two readings of the contract that carry no risk. (1) NAO_DITO on an empty value field other than a professional, on an action
 * that is no patch: the validator reads that field as unsaid exactly as with no base (the customer is the one stricter case: it is asked).
 * (2) A patch of an open agent plan (its key is an open action's) repeating a value without a base: the validator keeps only the accepted one
 * (contract A3). Everything else stays refused. Pure decoder checks plus the validator against an in-memory tenant (no database, network or
 * model). Synthetic hair studio: Thuy Nakamura and Benedita Ruas; Ifeoma Duarte and Graça Tenório; no gender read from any name. Today is
 * Tuesday 06/10/2026, 9h in São Paulo; "sexta" is 09/10. */
const NOW = new Date("2026-10-06T12:00:00Z"), FRIDAY = "2026-10-09";
type Action = AgentPlanAction;
type BaseOf = Action["bases"][number];
const base = (campo: BaseOf["campo"], tipo: BaseOf["tipo"], citacao: string, ref: string | null = null): BaseOf => ({ campo, tipo, ref, citacao });
const act = (over: Partial<Action>): Action => ({ chave: "k1", operacao: "appointment.create", citacao_acao: "pra Ifeoma", atendimento: null, cliente: null, profissional: null,
  novo_profissional: null, servicos: null, inicio: null, fim: null, dia: null, motivo: null, recorrencia: null, depende_de: [], ocupa_horario_de: null, bases: [], premissas: [], ...over });
const plan = (acoes: Action[], over: Partial<AgentPlan> = {}): AgentPlan => ({ resultado: "PLANO", resposta: null, acoes, acoes_fora: 0, pergunta: null, ...over });
const OPEN = { openKeys: ["k1"], doneKeys: [] as string[] };
const reasons = (raw: unknown, options: { openKeys?: readonly string[]; doneKeys?: readonly string[] } = {}): string[] => {
  try { decodeAgentPlan(raw, options); return []; } catch (error) { expect(error).toBeInstanceOf(AgentPlanError); return [...(error as AgentPlanError).reasons]; }
};
const CRONO = [{ ref: "s1", modo: "LISTA" as const }];
/** A booking of Ifeoma with Thuy, Cronograma capilar, Friday 15h (its quote given per test). */
const booking = (over: Partial<Action> = {}) => act({ cliente: "c1", profissional: "p1", servicos: CRONO, inicio: `${FRIDAY}T15:00`, bases: [base("inicio", "DITO", "sexta às 15h")], ...over });

describe("S2 fix B2: NAO_DITO on an empty field that is not a professional (decoder)", () => {
  it("an action that is no patch: admitted on every empty value field; with a value it is still refused", () => {
    for (const field of ["atendimento", "cliente", "servicos", "inicio", "fim", "dia", "motivo"] as const) {
      const empty = booking({ [field]: null, bases: [...field === "inicio" ? [] : [base("inicio", "DITO", "sexta às 15h")], base(field, "NAO_DITO", "pra Ifeoma")] } as Partial<Action>);
      expect(reasons(plan([empty])), field).toEqual([]);
    }
    expect(reasons(plan([booking({ bases: [base("inicio", "DITO", "sexta às 15h"), base("cliente", "NAO_DITO", "pra Ifeoma")] })]))).toEqual(["NAO_DITO_FIELD"]);
    expect(reasons(plan([booking({ dia: FRIDAY, bases: [base("inicio", "DITO", "sexta às 15h"), base("dia", "NAO_DITO", "sexta")] })]))).toEqual(["NAO_DITO_FIELD"]);
    // A professional: unchanged (V8's card), and with a value still NAO_DITO_VALUE.
    expect(reasons(plan([booking({ profissional: null, bases: [base("inicio", "DITO", "sexta às 15h"), base("profissional", "NAO_DITO", "pra Ifeoma")] })]))).toEqual([]);
    expect(reasons(plan([booking({ bases: [base("inicio", "DITO", "sexta às 15h"), base("profissional", "NAO_DITO", "pra Ifeoma")] })]))).toEqual(["NAO_DITO_VALUE"]);
  });
  it("adversarial: on a patch of an open action it is refused as before (it would read as dropping the value the open action holds)", () => {
    const patch = booking({ inicio: null, dia: null, bases: [base("dia", "NAO_DITO", "às 16h")] });
    expect(reasons(plan([patch]), OPEN)).toEqual(["NAO_DITO_FIELD"]);
    // The same action with a new key on the same open plan is a new action: admitted.
    expect(reasons(plan([{ ...patch, chave: "k2" }]), OPEN)).toEqual([]);
    // A professional of a patch keeps the historical rule (the validator holds the open person: A7).
    expect(reasons(plan([booking({ profissional: null, bases: [base("inicio", "DITO", "sexta às 15h"), base("profissional", "NAO_DITO", "às 16h")] })]), OPEN)).toEqual([]);
  });
});

describe("S2 fix B2: a patch may repeat a value of its open action without a base (decoder; the validator keeps only the accepted one, A3)", () => {
  it("each of atendimento, inicio, fim and dia without a base: refused on a new request, admitted on the open action's own key", () => {
    expect([...AGENT_BASE_REQUIRED_FIELDS]).toEqual(["atendimento", "inicio", "fim", "dia"]);
    const unbased: Action[] = [
      act({ operacao: "appointment.cancel", atendimento: "a1", citacao_acao: "cancela" }),
      booking({ bases: [] }),
      act({ operacao: "schedule.block", profissional: "p2", inicio: `${FRIDAY}T14:00`, fim: `${FRIDAY}T16:00`, bases: [base("inicio", "DITO", "sexta às 14h")] }),
      act({ operacao: "appointment.list", dia: FRIDAY, citacao_acao: "agenda" }),
    ];
    for (const action of unbased) {
      expect(reasons(plan([action])), action.operacao).toEqual(["BASE_REQUIRED"]);
      expect(reasons(plan([action]), OPEN), action.operacao).toEqual([]);
      expect(reasons(plan([{ ...action, chave: "k2" }]), OPEN), action.operacao).toEqual(["BASE_REQUIRED"]);
    }
  });
  it("adversarial: a patch still has at most one base per value, unique keys, known edges and NAO_DITO_VALUE", () => {
    expect(reasons(plan([booking({ bases: [base("inicio", "DITO", "sexta"), base("inicio", "DITO", "15h")] })]), OPEN)).toEqual(["BASE_DUPLICATE"]);
    expect(reasons(plan([booking({ bases: [] }), booking({ bases: [] })]), OPEN)).toEqual(["KEY_DUPLICATE"]);
    expect(reasons(plan([booking({ bases: [], depende_de: ["sumida"] })]), OPEN)).toEqual(["DEPENDENCY_UNKNOWN"]);
    expect(reasons(plan([booking({ bases: [base("profissional", "NAO_DITO", "às 16h")] })]), OPEN)).toEqual(["NAO_DITO_VALUE"]);
    expect(agentPlanViolations(plan([booking({ bases: [] })]), { openKeys: ["k9"] })).toEqual(["BASE_REQUIRED"]);
  });
  it("the loop's decode reads the open plan from the message context, so the loop and the validator (explicit keys) decide alike", async () => {
    const p = plan([booking({ bases: [] })]);
    expect(reasons(p)).toEqual(["BASE_REQUIRED"]);
    const inside = await withAgentMessage({ owner: ["às 16h"], open: { keys: ["k1"], done: [], render: () => null } }, async () => {
      try { decodeAgentPlanArguments(JSON.stringify(p)); return []; } catch (error) { return [...(error as AgentPlanError).reasons]; }
    });
    expect(inside).toEqual([]); expect(reasons(p, OPEN)).toEqual([]);
    const none = await withAgentMessage({ owner: ["às 16h"] }, async () => { try { decodeAgentPlanArguments(JSON.stringify(p)); return []; } catch (error) { return [...(error as AgentPlanError).reasons]; } });
    expect(none).toEqual(["BASE_REQUIRED"]);
  });
});

// ---------------------------------------------------------------- the validator: NAO_DITO on an empty field reads as unsaid
type Appt = { id: string; customerId: string; professionalId: string; serviceIds: string[]; start: string; end: string; status: string };
const PROS = [{ id: "pro-thu", name: "Thuy Nakamura", services: ["sv-cro", "sv-bot", "sv-lam"] }, { id: "pro-ben", name: "Benedita Ruas", services: ["sv-lam"] }];
const SVCS = [{ id: "sv-cro", name: "Cronograma capilar", durationMin: 90 }, { id: "sv-bot", name: "Botox capilar", durationMin: 60 }, { id: "sv-lam", name: "Laminação", durationMin: 45 }];
const CUSTS = [{ id: "cu-ife", name: "Ifeoma Duarte" }, { id: "cu-gra", name: "Graça Tenório" }];
const APPTS: Appt[] = [{ id: "ap-ife", customerId: "cu-ife", professionalId: "pro-thu", serviceIds: ["sv-lam"], start: `${FRIDAY}T10:00`, end: `${FRIDAY}T10:45`, status: "CONFIRMED" }];
const WORK = [{ start: 540, end: 720 }, { start: 780, end: 1140 }];
const minute = (local: string) => Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
const at = (local: string) => new Date(`${local}:00-03:00`);
function reader(): AgentFactReader {
  const fact = (a: Appt): AgentApptFact => ({ id: a.id, status: a.status, startLocal: a.start, endLocal: a.end, startAt: at(a.start), professionalId: a.professionalId,
    professionalName: PROS.find(p => p.id === a.professionalId)!.name, customerId: a.customerId, customerName: CUSTS.find(c => c.id === a.customerId)!.name,
    serviceIds: [...a.serviceIds], serviceNames: a.serviceIds.map(id => SVCS.find(s => s.id === id)!.name), revision: 1 });
  const day = (pro: string, date: string) => APPTS.filter(a => a.professionalId === pro && a.start.slice(0, 10) === date);
  return {
    timezone: "America/Sao_Paulo", now: NOW,
    appointment: async id => { const a = APPTS.find(x => x.id === id); return a ? fact(a) : undefined; },
    professionals: async () => PROS.map(p => ({ id: p.id, name: p.name })),
    services: async () => SVCS.map(s => ({ ...s })),
    customer: async id => CUSTS.find(c => c.id === id),
    customerSet: async literal => { const { tokens } = nameTokenQuery(withoutArticle(literal)), rows = CUSTS.filter(c => nameHasTokens(tokens, c.name)); return { rows, total: rows.length }; },
    selfProfessional: async () => undefined,
    performers: async ids => PROS.filter(p => ids.every(id => p.services.includes(id))).map(p => ({ id: p.id, name: p.name })),
    bookable: async (pro, ids, start) => {
      const s = minute(start), e = s + ids.reduce((sum, id) => sum + SVCS.find(x => x.id === id)!.durationMin, 0);
      return at(start) > NOW && WORK.some(w => s >= w.start && e <= w.end) && !day(pro, start.slice(0, 10)).some(a => minute(a.start) < e && minute(a.end) > s);
    },
    activeCount: async (pro, date) => day(pro, date).length,
    dayFacts: async (date, ids) => ({ closures: [], now: date > "2026-10-06" ? -1 : 540, staff: ids.map(id => ({ id, work: WORK.map(w => ({ ...w })), off: [] })) }),
    dayAppointments: async (pro, date) => day(pro, date).map(fact),
    locate: async (f, operation) => {
      const date = operation === "appointment.change" ? f.source_date : f.date, time = operation === "appointment.change" ? f.source_time : f.time;
      return !date && !f.customer_ref ? [] : APPTS.filter(a => at(a.start) > NOW && (!f.customer_ref || a.customerId === f.customer_ref) && (!f.professional_ref || a.professionalId === f.professional_ref) &&
        (!date || a.start.slice(0, 10) === date) && (!time || a.start.slice(11, 16) === time)).map(a => a.id);
    },
  };
}
/** p1 Thuy, p2 Benedita; s1 Cronograma capilar, s2 Botox capilar, s3 Laminação; c1 Ifeoma, c2 Graça; a1 Ifeoma's Friday 10h. */
function binding() {
  const b = createAgentBinding();
  for (const p of PROS) b.bind("p", p.id, { name: p.name });
  for (const s of SVCS) b.bind("s", s.id, { name: s.name, durationMin: s.durationMin });
  for (const c of CUSTS) b.bind("c", c.id, { shown: c.name });
  for (const a of APPTS) b.bind("a", a.id, { start: a.start, end: a.end, professionalId: a.professionalId, customerId: a.customerId, serviceIds: a.serviceIds, status: "CONFIRMED" });
  return b;
}
const validate = (owner: string, p: AgentPlan) => validateAgentPlan(p, { owner: [owner], binding: binding(), reader: reader() });
/** The same plan validated with and without the NAO_DITO base of `field` on its first action. */
async function withAndWithout(owner: string, p: AgentPlan, field: BaseOf["campo"]) {
  const bare: AgentPlan = { ...p, acoes: p.acoes.map((a, index) => index ? a : { ...a, bases: a.bases.filter(b => !(b.campo === field && b.tipo === "NAO_DITO")) }) };
  expect(p.acoes[0].bases.some(b => b.campo === field && b.tipo === "NAO_DITO")).toBe(true);
  return { marked: await validate(owner, p), bare: await validate(owner, bare) };
}

describe("S2 fix B2: the validator reads NAO_DITO on an empty field as unsaid (never a value it did not read)", () => {
  beforeEach(() => { for (const flag of AGENT_DEPENDENCY_FLAGS) vi.stubEnv(flag, "true"); vi.stubEnv("SALON_SECRETARY_DAYPART_ASK_WIDE", ""); });
  afterEach(() => vi.unstubAllEnvs());

  it("a booking whose day and start are marked NAO_DITO, with the day asked: the same outcome as with no base, and no day invented", async () => {
    const owner = "Cronograma capilar pra Ifeoma com a Thuy";
    for (const field of ["dia", "inicio"] as const) {
      const p = plan([booking({ citacao_acao: owner, inicio: null, bases: [base(field, "NAO_DITO", "Cronograma capilar pra Ifeoma")] })], { pergunta: { acao: "k1", campo: "dia", texto: "Qual dia?" } });
      const { marked, bare } = await withAndWithout(owner, p, field);
      expect(marked).toEqual(bare);
      expect(marked.ok && marked.actions[0].fields.date).toBeUndefined(); expect(marked.ok && marked.actions[0].fields.time).toBeUndefined();
    }
  });
  it("a cancellation with its reason or its appointment marked NAO_DITO: the same outcome as with no base (the reason is asked; the C4 locate decides)", async () => {
    const owner = "Cancela a laminação da Ifeoma de sexta";
    const reason = plan([act({ operacao: "appointment.cancel", citacao_acao: owner, atendimento: "a1", bases: [base("atendimento", "DITO", "a laminação da Ifeoma de sexta"), base("motivo", "NAO_DITO", "Cancela")] })]);
    const r = await withAndWithout(owner, reason, "motivo");
    expect(r.marked).toEqual(r.bare); expect(r.marked.ok && r.marked.actions[0].fields.reason).toBeUndefined();
    const origin = plan([act({ operacao: "appointment.cancel", citacao_acao: owner, cliente: "c1", bases: [base("atendimento", "NAO_DITO", "Cancela")] })]);
    const o = await withAndWithout(owner, origin, "atendimento");
    expect(o.marked).toEqual(o.bare);
  });
  it("a block whose end is marked NAO_DITO and a booking whose services are: the same outcome as with no base (the end and the service are asked)", async () => {
    const block = "Bloqueia a Benedita sexta às 14h";
    const b = await withAndWithout(block, plan([act({ operacao: "schedule.block", citacao_acao: block, profissional: "p2", inicio: `${FRIDAY}T14:00`,
      bases: [base("inicio", "DITO", "sexta às 14h"), base("fim", "NAO_DITO", "Bloqueia a Benedita")] })]), "fim");
    expect(b.marked).toEqual(b.bare); expect(b.marked.ok && b.marked.actions[0].fields.end_time).toBeUndefined();
    const create = "Encaixa a Ifeoma sexta às 15h com a Thuy";
    const s = await withAndWithout(create, plan([booking({ citacao_acao: create, servicos: null, bases: [base("inicio", "DITO", "sexta às 15h"), base("servicos", "NAO_DITO", "Encaixa a Ifeoma")] })]), "servicos");
    expect(s.marked).toEqual(s.bare); expect(s.marked.ok && s.marked.actions[0].fields.service_ref).toBeUndefined();
  });
  it("adversarial: an empty customer marked NAO_DITO is never filled from the owner's words nor from a ref: the customer is asked", async () => {
    const owner = "Encaixa a Ifeoma sexta às 15h com a Thuy";
    const out = await validate(owner, plan([booking({ citacao_acao: owner, cliente: null, bases: [base("inicio", "DITO", "sexta às 15h"), base("cliente", "NAO_DITO", "Encaixa")] })]));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.actions[0].fields.customer_ref).toBeUndefined(); expect(out.actions[0].fields.customer_name).toBeUndefined();
    expect(out.actions[0].status).not.toBe("DROP");
  });
});
