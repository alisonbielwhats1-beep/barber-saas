import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_DEPENDENCY_FLAGS, createAgentBinding } from "../../../packages/salon-secretary/src/agent-context";
import type { AgentPlan } from "../../../packages/salon-secretary/src/agent-plan";
import { nameHasTokens, nameTokenQuery } from "../secretary-name-tokens";
import { withoutArticle } from "../name-search";
import { validateAgentPlan, type AgentActionOutcome, type AgentApptFact, type AgentFactReader } from "../secretary-agent-validator";

/** Micro-candidate P2 (flag SALON_SECRETARY_AGENT_MICRO, default off; docs/SECRETARY_AGENT_EVAL_PROTOCOL.md Adendo 7; owner decisions 12 and 14 of
 * docs/DECISOES_PRODUTO.md): the agent's fact validator PRESERVES a value the model understood when (1) the owner's words (any sentence of the
 * message, an antecedent or a shared constituent included) or the salon's real rows support it, (2) exactly one reading is compatible, (3) nothing
 * contradicts or negates it and (4) the action is not high-risk (cancel, a block over appointments, several customers at once). An assumption is
 * shown as a backend premise; Confirmar stays mandatory. Two readings, a contradiction, a negation or a high-risk action keep today's behaviour
 * (asked or carded). One structural mechanism per describe (the layer audit's P2 list: V0/clause scope, admits() locality, the name fallback,
 * service specificity, the temporal proofs, the exception proof, V15 coverage), each with its adversarial twin; flag off, today's exact outcome.
 * Written BEFORE the fix (test-first). Synthetic salon, invented names, services and sentences; no gender is read from a name. Same in-memory
 * reader and binding contract as secretary-agent-validator.test.ts. Today is Tuesday 02/03/2027, 9h in São Paulo; "sexta" is 05/03. */
const NOW = new Date("2027-03-02T12:00:00Z"), TODAY = "2027-03-02", WED = "2027-03-03", THU = "2027-03-04", FRI = "2027-03-05";
type Pro = { id: string; name: string; work: [number, number][]; services: string[]; self?: boolean };
type Appt = { id: string; customerId: string; professionalId: string; serviceIds: string[]; start: string; end: string; status: string; revision?: number };
type World = { pros: Pro[]; svcs: { id: string; name: string; durationMin: number }[]; custs: { id: string; name: string }[]; appts: Appt[] };
function world(): World {
  return {
    pros: [
      { id: "pro-eur", name: "Eurico Bastos", work: [[540, 720], [780, 1140]], services: ["sv-mod", "sv-cau", "sv-hen"] },
      { id: "pro-lin", name: "Lindalva Rocha", work: [[540, 720], [780, 1140]], services: ["sv-mod", "sv-pod"] },
      { id: "pro-tar", name: "Tarcísio Mendes", work: [[420, 1320]], services: ["sv-mod"] },
    ],
    svcs: [{ id: "sv-mod", name: "Escova modeladora", durationMin: 40 }, { id: "sv-cau", name: "Cauterização", durationMin: 30 }, { id: "sv-hen", name: "Henna", durationMin: 20 },
      { id: "sv-pod", name: "Podologia", durationMin: 45 }],
    custs: [{ id: "cu-gra", name: "Graciete Lobo" }, { id: "cu-ros", name: "Rosalvo Pires" }, { id: "cu-irm", name: "Irene Matos" }, { id: "cu-irc", name: "Irene Coelho" },
      { id: "cu-jos", name: "Josias Arantes" }],
    appts: [
      { id: "ap-ros", customerId: "cu-ros", professionalId: "pro-eur", serviceIds: ["sv-cau"], start: `${WED}T14:00`, end: `${WED}T14:30`, status: "CONFIRMED" },
      { id: "ap-jos", customerId: "cu-jos", professionalId: "pro-lin", serviceIds: ["sv-pod"], start: `${THU}T10:00`, end: `${THU}T10:45`, status: "CONFIRMED" },
      { id: "ap-irc", customerId: "cu-irc", professionalId: "pro-lin", serviceIds: ["sv-mod"], start: `${FRI}T10:00`, end: `${FRI}T10:40`, status: "CONFIRMED" },
      { id: "ap-gra", customerId: "cu-gra", professionalId: "pro-eur", serviceIds: ["sv-hen"], start: `${THU}T16:00`, end: `${THU}T16:20`, status: "PENDING" },
    ],
  };
}
const minute = (local: string) => Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
const at = (local: string) => new Date(`${local}:00-03:00`);
const active = (a: Appt) => a.status === "PENDING" || a.status === "CONFIRMED";
/** The tenant as the validator reads it (agentFactReader's contracts). */
function reader(w: World): AgentFactReader {
  const fact = (a: Appt): AgentApptFact => ({ id: a.id, status: a.status, startLocal: a.start, endLocal: a.end, startAt: at(a.start), professionalId: a.professionalId,
    professionalName: w.pros.find(p => p.id === a.professionalId)!.name, customerId: a.customerId, customerName: w.custs.find(c => c.id === a.customerId)!.name,
    serviceIds: [...a.serviceIds], serviceNames: a.serviceIds.map(id => w.svcs.find(s => s.id === id)!.name), revision: a.revision ?? 1 });
  return {
    timezone: "America/Sao_Paulo", now: NOW,
    appointment: async id => { const a = w.appts.find(x => x.id === id); return a ? fact(a) : undefined; },
    professionals: async () => w.pros.map(p => ({ id: p.id, name: p.name })),
    services: async () => w.svcs.map(s => ({ ...s })),
    customer: async id => { const c = w.custs.find(x => x.id === id); return c ? { id: c.id, name: c.name } : undefined; },
    customerSet: async literal => {
      const { tokens } = nameTokenQuery(withoutArticle(literal)), rows = w.custs.filter(c => nameHasTokens(tokens, c.name)).map(c => ({ id: c.id, name: c.name }));
      return { rows, total: rows.length };
    },
    selfProfessional: async () => { const p = w.pros.find(x => x.self); return p ? { id: p.id, name: p.name } : undefined; },
    performers: async ids => w.pros.filter(p => ids.every(id => p.services.includes(id))).map(p => ({ id: p.id, name: p.name })),
    bookable: async (pro, ids, start) => {
      const p = w.pros.find(x => x.id === pro)!, s = minute(start), e = s + ids.reduce((sum, id) => sum + w.svcs.find(x => x.id === id)!.durationMin, 0);
      return at(start) > NOW && p.work.some(([a, b]) => s >= a && e <= b) &&
        !w.appts.some(a => active(a) && a.professionalId === pro && a.start.slice(0, 10) === start.slice(0, 10) && minute(a.start) < e && minute(a.end) > s);
    },
    activeCount: async (pro, date) => w.appts.filter(a => active(a) && a.professionalId === pro && a.start.slice(0, 10) === date).length,
    dayFacts: async (date, ids) => ({ closures: [], now: date > TODAY ? -1 : date < TODAY ? 1440 : 540,
      staff: ids.map(id => ({ id, work: (w.pros.find(p => p.id === id)?.work ?? []).map(([start, end]) => ({ start, end })), off: [] })) }),
    dayAppointments: async (pro, date) => w.appts.filter(a => active(a) && a.professionalId === pro && a.start.slice(0, 10) === date).sort((x, y) => x.start.localeCompare(y.start)).map(fact),
    locate: async (f, operation) => {
      const date = operation === "appointment.change" ? f.source_date : f.date, time = operation === "appointment.change" ? f.source_time : f.time;
      const rows = !date && !f.customer_ref ? [] : w.appts.filter(a => active(a) && at(a.start) > NOW && (!f.customer_ref || a.customerId === f.customer_ref) &&
        (!f.professional_ref || a.professionalId === f.professional_ref) && (!date || a.start.slice(0, 10) === date) && (!time || a.start.slice(11, 16) === time));
      return rows.map(a => a.id);
    },
  };
}
/** p1 Eurico, p2 Lindalva, p3 Tarcísio; s1 Escova modeladora, s2 Cauterização, s3 Henna, s4 Podologia; c1 Graciete, c2 Rosalvo, c3 Irene Matos, c4 Irene Coelho,
 * c5 Josias; a1 Rosalvo (Wed 14h, Eurico), a2 Josias (Thu 10h, Lindalva), a3 Irene Coelho (Fri 10h, Lindalva), a4 Graciete (Thu 16h, Eurico). */
function binding(w: World) {
  const b = createAgentBinding();
  for (const p of w.pros) b.bind("p", p.id, { name: p.name });
  for (const s of w.svcs) b.bind("s", s.id, { name: s.name, durationMin: s.durationMin });
  for (const c of w.custs) b.bind("c", c.id, { shown: c.name });
  for (const a of w.appts) b.bind("a", a.id, { start: a.start, end: a.end, professionalId: a.professionalId, customerId: a.customerId, serviceIds: a.serviceIds, status: a.status === "PENDING" ? "PENDING" : "CONFIRMED" });
  return b;
}
type Action = AgentPlan["acoes"][number];
const act = (over: Partial<Action>): Action => ({ chave: "k1", operacao: "appointment.create", citacao_acao: "", atendimento: null, cliente: null, profissional: null, novo_profissional: null,
  servicos: null, inicio: null, fim: null, dia: null, motivo: null, recorrencia: null, depende_de: [], ocupa_horario_de: null, bases: [], premissas: [], ...over });
const base = (campo: Action["bases"][number]["campo"], tipo: Action["bases"][number]["tipo"], citacao: string, ref: string | null = null) => ({ campo, tipo, ref, citacao });
const plan = (acoes: Action[]): AgentPlan => ({ resultado: "PLANO", resposta: null, acoes, acoes_fora: 0, pergunta: null });
async function outcomes(owner: string, p: AgentPlan, w = world()): Promise<AgentActionOutcome[]> {
  const out = await validateAgentPlan(p, { owner: [owner], binding: binding(w), reader: reader(w) });
  if (!out.ok) throw Error(`REJECTED ${out.code}`);
  return out.actions;
}
const SVC = (ref: string) => [{ ref, modo: "LISTA" as const }];
const MICRO = "SALON_SECRETARY_AGENT_MICRO";
const micro = (on: boolean) => vi.stubEnv(MICRO, on ? "true" : undefined);
const fold = (text: string | undefined) => (text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const byKey = (list: AgentActionOutcome[], key: string) => list.find(item => item.key === key)!;
/** The same plan with the flag off (today) and on (the micro-candidate), each over a fresh tenant. */
async function both(owner: string, p: () => AgentPlan, w: () => World = world) {
  micro(false);
  const off = await outcomes(owner, p(), w());
  micro(true);
  const on = await outcomes(owner, p(), w());
  return { off, on };
}

beforeEach(() => { for (const flag of AGENT_DEPENDENCY_FLAGS) vi.stubEnv(flag, "true"); vi.stubEnv("SALON_SECRETARY_DAYPART_ASK_WIDE", ""); vi.stubEnv(MICRO, undefined); });
afterEach(() => vi.unstubAllEnvs());

describe("P2 V0 (clause scope): a complement shared by coordinated actions belongs to each of them", () => {
  const moves = (first: string, own: string) => () => plan([
    act({ chave: "k1", operacao: "appointment.change", citacao_acao: first, atendimento: "a1", cliente: "c2", inicio: `${FRI}T15:00`,
      bases: [base("atendimento", "DITO", "o Rosalvo"), base("inicio", "DITO", "pra sexta às 15h")] }),
    act({ chave: "k2", operacao: "appointment.change", citacao_acao: own, atendimento: "a2", cliente: "c5", inicio: `${FRI}T15:00`,
      bases: [base("atendimento", "DITO", "o Josias"), base("inicio", "DITO", "pra sexta às 15h")] })]);
  it("one verb, two objects, one shared day and clock (low risk, one reading): both moves keep it; flag off: the first one loses it (AGENT_QUOTE_FOREIGN)", async () => {
    const { off, on } = await both("Passa o Rosalvo e o Josias pra sexta às 15h.", moves("Passa o Rosalvo", "o Josias pra sexta às 15h"));
    expect(byKey(off, "k1")).toMatchObject({ status: "READY", codes: ["AGENT_QUOTE_FOREIGN"], fields: { customer_ref: "cu-ros" } });
    expect(byKey(off, "k1").fields).not.toHaveProperty("time");
    expect(byKey(off, "k2")).toMatchObject({ status: "READY", codes: [], fields: { customer_ref: "cu-jos", date: FRI, time: "15:00" } });
    expect(byKey(on, "k1")).toMatchObject({ status: "READY", fields: { customer_ref: "cu-ros", date: FRI, time: "15:00" } });
    expect(byKey(on, "k1").question).toBeNull();
    expect(byKey(on, "k2")).toMatchObject({ status: "READY", fields: { customer_ref: "cu-jos", date: FRI, time: "15:00" } });
  });
  it("adversarial twin (contradiction): the first move states its own day; the sibling's complement is never taken for it", async () => {
    const { off, on } = await both("Passa o Rosalvo pra quinta e o Josias pra sexta às 15h.", moves("Passa o Rosalvo pra quinta", "o Josias pra sexta às 15h"));
    for (const list of [off, on]) {
      expect(byKey(list, "k1").status).toBe("ASK");
      expect(byKey(list, "k1").fields.date).not.toBe(FRI);
      expect(byKey(list, "k1").fields).not.toHaveProperty("time");
    }
  });
  it("adversarial twin (negation): the second object is negated: its action never stands; the first keeps its own values", async () => {
    const { off, on } = await both("Passa o Rosalvo pra sexta às 15h e o Josias não.", moves("Passa o Rosalvo pra sexta às 15h", "o Josias não"));
    for (const list of [off, on]) {
      expect(byKey(list, "k2")).toMatchObject({ status: "DROP", codes: ["AGENT_NEGATED"] });
      expect(byKey(list, "k1")).toMatchObject({ status: "READY", fields: { customer_ref: "cu-ros", date: FRI, time: "15:00" } });
    }
  });
});

describe("P2 admits() locality: a person the owner named in an earlier sentence of the same message (antecedent)", () => {
  it("a booking whose customer was named in the sentence before: kept (one person named, low risk); flag off: AGENT_QUOTE_FOREIGN empties it", async () => {
    const { off, on } = await both("A Graciete pediu um horário. Marca ela sexta às 14h com o Eurico, henna.", () => plan([act({ citacao_acao: "Marca ela sexta às 14h com o Eurico, henna",
      cliente: "c1", profissional: "p1", servicos: SVC("s3"), inicio: `${FRI}T14:00`, bases: [base("cliente", "DITO", "A Graciete"), base("inicio", "DITO", "sexta às 14h")] })]));
    expect(off[0]).toMatchObject({ status: "READY", codes: ["AGENT_QUOTE_FOREIGN"], fields: { professional_ref: "pro-eur", service_ref: "sv-hen", date: FRI, time: "14:00" } });
    expect(off[0].fields).not.toHaveProperty("customer_ref");
    expect(on[0]).toMatchObject({ status: "READY", fields: { customer_ref: "cu-gra", professional_ref: "pro-eur", service_ref: "sv-hen", date: FRI, time: "14:00" } });
  });
  it("a move of the customer named in the sentence before (E2): kept, so the locate finds exactly that appointment; flag off: a card of the day's appointments", async () => {
    const { off, on } = await both("A Graciete ligou. Passa o horário de quinta dela pra sexta às 15h.", () => plan([act({ operacao: "appointment.change",
      citacao_acao: "Passa o horário de quinta dela pra sexta às 15h", atendimento: "a4", cliente: "c1", inicio: `${FRI}T15:00`,
      bases: [base("cliente", "DITO", "A Graciete"), base("atendimento", "DITO", "o horário de quinta dela"), base("inicio", "DITO", "pra sexta às 15h")] })]));
    expect(off[0]).toMatchObject({ status: "ASK", codes: ["AGENT_QUOTE_FOREIGN", "AGENT_APPT_LOCATE"], card: { kind: "appointment_ref" } });
    expect(off[0].fields).not.toHaveProperty("customer_ref");
    expect(on[0]).toMatchObject({ status: "READY", fields: { customer_ref: "cu-gra", source_date: THU, date: FRI, time: "15:00" }, origin: { expected: "ap-gra", located: ["ap-gra"] } });
    expect(on[0].card).toBeNull();
  });
  it("adversarial twin (two readings): two people named before the pronoun: the customer is never picked", async () => {
    const { off, on } = await both("A Graciete e a Irene Matos pediram horário. Marca ela sexta às 14h com o Eurico, henna.", () => plan([act({
      citacao_acao: "Marca ela sexta às 14h com o Eurico, henna", cliente: "c1", profissional: "p1", servicos: SVC("s3"), inicio: `${FRI}T14:00`,
      bases: [base("cliente", "DITO", "A Graciete"), base("inicio", "DITO", "sexta às 14h")] })]));
    for (const list of [off, on]) expect(list[0].fields).not.toHaveProperty("customer_ref");
  });
  it("adversarial twin (high risk, decision 14): a cancellation never takes its customer from another sentence", async () => {
    const { off, on } = await both("O Rosalvo ligou. Desmarca o horário de quarta, ele viajou.", () => plan([act({ operacao: "appointment.cancel", citacao_acao: "Desmarca o horário de quarta",
      atendimento: "a1", cliente: "c2", motivo: "ele viajou", bases: [base("cliente", "DITO", "O Rosalvo"), base("atendimento", "DITO", "o horário de quarta")] })]));
    expect(off[0].codes).toContain("AGENT_QUOTE_FOREIGN");
    for (const list of [off, on]) expect(list[0].fields).not.toHaveProperty("customer_ref");
  });
});

describe("P2 name fallback: words beside a customer's name that name nobody never replace the one holder of the name", () => {
  const booking = (quote: string) => () => plan([act({ citacao_acao: `Marca ${quote} sexta às 14h com o Eurico, henna`, cliente: null, profissional: "p1", servicos: SVC("s3"),
    inicio: `${FRI}T14:00`, bases: [base("cliente", "DITO", quote), base("inicio", "DITO", "sexta às 14h")] })]);
  it("one registered holder of the name, lowercase words beside it (low risk): that customer, said as an assumption; flag off: every word becomes the name", async () => {
    const { off, on } = await both("Marca a Graciete do cabelo curto sexta às 14h com o Eurico, henna.", booking("a Graciete do cabelo curto"));
    expect(off[0]).toMatchObject({ status: "READY", codes: ["AGENT_NAME_MISMATCH"], fields: { customer_name: "graciete cabelo curto" } });
    expect(off[0].fields).not.toHaveProperty("customer_ref");
    // Either the one holder with the backend's premise, or only the name's words for prepare() to resolve: never the words that name nobody.
    if (on[0].fields.customer_ref === "cu-gra") expect(on[0].premises.join("\n")).toContain("Graciete Lobo");
    else expect(fold(on[0].fields.customer_name)).toBe("graciete");
    expect(on[0].status).toBe("READY");
  });
  it("adversarial twin (contradiction): a capitalized word no holder has stays in the owner's words; never that customer", async () => {
    const { off, on } = await both("Marca a Graciete Moura do cabelo curto sexta às 14h com o Eurico, henna.", booking("a Graciete Moura do cabelo curto"));
    for (const list of [off, on]) {
      expect(list[0].fields).not.toHaveProperty("customer_ref");
      expect(fold(list[0].fields.customer_name)).toContain("moura");
    }
  });
  it("adversarial twin (two readings): a first name two customers hold is never one of them", async () => {
    const { off, on } = await both("Marca a Irene do cabelo curto sexta às 14h com o Eurico, henna.", booking("a Irene do cabelo curto"));
    for (const list of [off, on]) expect(list[0].fields).not.toHaveProperty("customer_ref");
  });
});

describe("P2 specificity (services): the salon's rows leave one compatible service", () => {
  const withSobrancelha = (alsoEurico: boolean) => () => {
    const w = world();
    w.svcs.push({ id: "sv-hes", name: "Henna de sobrancelha", durationMin: 30 });
    w.pros[1].services.push("sv-hes");
    if (alsoEurico) w.pros[0].services.push("sv-hes");
    return w;
  };
  const TEXT = "Marca a Graciete sexta às 14h com o Eurico, henna.";
  const henna = () => plan([act({ citacao_acao: "Marca a Graciete sexta às 14h com o Eurico, henna", cliente: "c1", profissional: "p1", servicos: SVC("s3"),
    inicio: `${FRI}T14:00`, bases: [base("inicio", "DITO", "sexta às 14h"), base("servicos", "DITO", "henna")] })]);
  it("two services hold the owner's word, but the professional the owner named performs only one: that one, with its premise; flag off: the card", async () => {
    const { off, on } = await both(TEXT, henna, withSobrancelha(false));
    expect(off[0]).toMatchObject({ status: "ASK", codes: ["AGENT_HOMONYM"], card: { kind: "service_ref" }, fields: { service_name: "henna" } });
    expect(on[0]).toMatchObject({ status: "READY", fields: { customer_ref: "cu-gra", professional_ref: "pro-eur", service_ref: "sv-hen", date: FRI, time: "14:00" } });
    expect(on[0].card).toBeNull();
    expect(on[0].premises.join("\n")).toContain("Henna");
  });
  it("adversarial twin (two readings): the professional performs both: the card stays", async () => {
    const { off, on } = await both(TEXT, henna, withSobrancelha(true));
    for (const list of [off, on]) {
      expect(list[0]).toMatchObject({ status: "ASK", card: { kind: "service_ref" } });
      expect(list[0].fields).not.toHaveProperty("service_ref");
    }
  });
});

describe("P2 temporal proofs: a day said once at the head of coordinated bookings", () => {
  const first = () => act({ chave: "k1", citacao_acao: "Na sexta marca a Graciete às 14h com o Eurico, henna", cliente: "c1", profissional: "p1", servicos: SVC("s3"),
    inicio: `${FRI}T14:00`, bases: [base("inicio", "DITO", "Na sexta marca a Graciete às 14h")] });
  const second = (quote: string) => act({ chave: "k2", citacao_acao: quote, cliente: "c2", profissional: "p3", servicos: SVC("s1"), inicio: `${FRI}T16:00`,
    bases: [base("inicio", "DITO", "às 16h")] });
  it("the second booking states no day of its own and nothing denies or contradicts the shared one: it keeps the day; flag off: AGENT_DAY_MISSING", async () => {
    const { off, on } = await both("Na sexta marca a Graciete às 14h com o Eurico, henna, e o Rosalvo às 16h com o Tarcísio, escova modeladora.",
      () => plan([first(), second("o Rosalvo às 16h com o Tarcísio, escova modeladora")]));
    expect(byKey(off, "k2")).toMatchObject({ status: "READY", codes: ["AGENT_DAY_MISSING"], fields: { customer_ref: "cu-ros", professional_ref: "pro-tar", service_ref: "sv-mod", time: "16:00" } });
    expect(byKey(off, "k2").fields).not.toHaveProperty("date");
    expect(byKey(on, "k2")).toMatchObject({ status: "READY", fields: { customer_ref: "cu-ros", professional_ref: "pro-tar", service_ref: "sv-mod", date: FRI, time: "16:00" } });
    expect(byKey(on, "k1")).toMatchObject({ status: "READY", fields: { date: FRI, time: "14:00" } });
  });
  it("adversarial twin (contradiction): the second booking states its own day; the head's day is never taken for it", async () => {
    const { off, on } = await both("Na sexta marca a Graciete às 14h com o Eurico, henna, e o Rosalvo na quinta às 16h com o Tarcísio, escova modeladora.",
      () => plan([first(), second("o Rosalvo na quinta às 16h com o Tarcísio, escova modeladora")]));
    for (const list of [off, on]) expect(byKey(list, "k2").fields.date).not.toBe(FRI);
  });
});

describe("P2 exception proof (decision 16): the excepted appointment named by its customer and its service", () => {
  const CLAUSE = "Bloqueia a Lindalva sexta das 9 às 12, tirando a escova da Irene";
  const pieces = () => plan([
    act({ chave: "b1", operacao: "schedule.block", citacao_acao: CLAUSE, profissional: "p2", inicio: `${FRI}T09:00`, fim: `${FRI}T10:00`,
      bases: [base("inicio", "DITO", "sexta das 9"), base("fim", "EXCECAO", "tirando a escova da Irene", "a3")] }),
    act({ chave: "b2", operacao: "schedule.block", citacao_acao: CLAUSE, profissional: "p2", inicio: `${FRI}T10:40`, fim: `${FRI}T12:00`,
      bases: [base("inicio", "EXCECAO", "tirando a escova da Irene", "a3"), base("fim", "DITO", "às 12")] })]);
  it("exactly one appointment of the interval holds those words (its customer's and its service's): only the free pieces, with the premise; flag off: merged into the rule-10 card", async () => {
    const { off, on } = await both(`${CLAUSE}.`, pieces);
    expect(byKey(off, "b1")).toMatchObject({ status: "READY", codes: ["AGENT_EXCEPTION_MISMATCH"], fields: { professional_ref: "pro-lin", date: FRI, time: "09:00", end_time: "12:00" } });
    expect(byKey(off, "b2")).toMatchObject({ status: "DROP", codes: ["AGENT_EXCEPTION_MERGED"] });
    const premise = "Bloqueio só dos horários livres; o horário de Irene Coelho continua marcado.";
    expect(byKey(on, "b1")).toMatchObject({ status: "READY", fields: { professional_ref: "pro-lin", date: FRI, time: "09:00", end_time: "10:00" }, premises: [premise] });
    expect(byKey(on, "b2")).toMatchObject({ status: "READY", fields: { professional_ref: "pro-lin", date: FRI, time: "10:40", end_time: "12:00" }, premises: [premise] });
    expect(byKey(on, "b1").basis).toEqual([{ type: "EXCECAO", professionalId: "pro-lin", date: FRI, start: `${FRI}T09:00`, end: `${FRI}T12:00`, kept: ["ap-irc"],
      pieces: [[`${FRI}T09:00`, `${FRI}T10:00`], [`${FRI}T10:40`, `${FRI}T12:00`]] }]);
  });
  it("adversarial twin (two readings): two appointments of the interval hold those words: one block of the whole interval, so the rule-10 card shows", async () => {
    const twoIrenes = () => { const w = world();
      w.appts.push({ id: "ap-irm", customerId: "cu-irm", professionalId: "pro-lin", serviceIds: ["sv-mod"], start: `${FRI}T11:00`, end: `${FRI}T11:40`, status: "CONFIRMED" }); return w; };
    const { off, on } = await both(`${CLAUSE}.`, pieces, twoIrenes);
    for (const list of [off, on]) {
      expect(byKey(list, "b1")).toMatchObject({ fields: { time: "09:00", end_time: "12:00" }, basis: [] });
      expect(byKey(list, "b2").status).toBe("DROP");
    }
  });
});

describe("P2 V15 coverage: a clock the salon's own row explains is covered", () => {
  const move = (clock: string) => () => plan([act({ operacao: "appointment.change", citacao_acao: `Passa o Rosalvo de quarta às ${clock} pra sexta às 15h`, atendimento: "a1", cliente: "c2",
    inicio: `${FRI}T15:00`, bases: [base("atendimento", "DITO", "o Rosalvo de quarta"), base("inicio", "DITO", "pra sexta às 15h")] })]);
  it("the origin's clock the owner wrote is the located appointment's own start: no coverage question; flag off: AGENT_COVERAGE asks it", async () => {
    const { off, on } = await both("Passa o Rosalvo de quarta às 14h pra sexta às 15h.", move("14h"));
    expect(off[0]).toMatchObject({ status: "ASK", codes: ["AGENT_COVERAGE"], question: { code: "AGENT_COVERAGE" }, fields: { customer_ref: "cu-ros", source_date: WED, date: FRI, time: "15:00" } });
    expect(on[0]).toMatchObject({ status: "READY", fields: { customer_ref: "cu-ros", source_date: WED, date: FRI, time: "15:00" } });
    expect(on[0].question).toBeNull();
  });
  it("adversarial twin (contradiction): a clock the appointment does not have still asks", async () => {
    const { off, on } = await both("Passa o Rosalvo de quarta às 13h pra sexta às 15h.", move("13h"));
    for (const list of [off, on]) expect(list[0].status).toBe("ASK");
  });
});

describe("the flag", () => {
  it("anything but the exact value 'true' keeps today's validator (fail-safe default)", async () => {
    const text = "A Graciete pediu um horário. Marca ela sexta às 14h com o Eurico, henna.";
    const p = () => plan([act({ citacao_acao: "Marca ela sexta às 14h com o Eurico, henna", cliente: "c1", profissional: "p1", servicos: SVC("s3"),
      inicio: `${FRI}T14:00`, bases: [base("cliente", "DITO", "A Graciete"), base("inicio", "DITO", "sexta às 14h")] })]);
    micro(false);
    const today = await outcomes(text, p());
    for (const value of ["", "1", "TRUE", "yes"]) {
      vi.stubEnv(MICRO, value);
      expect(await outcomes(text, p()), value).toEqual(today);
    }
  });
});

// ================================================================ settling review (adversarial findings, flag on vs off)
describe("P2 review twins: one reading only, and every assumption said", () => {
  it("V0: the first move holds a complement of its own (a new professional): the sibling's day and clock are never taken for it", async () => {
    const p = () => plan([
      act({ chave: "k1", operacao: "appointment.change", citacao_acao: "Leva o Rosalvo pro Tarcísio", atendimento: "a1", cliente: "c2", novo_profissional: "p3", inicio: `${FRI}T15:00`,
        bases: [base("atendimento", "DITO", "o Rosalvo"), base("novo_profissional", "DITO", "pro Tarcísio"), base("inicio", "DITO", "pra sexta às 15h")] }),
      act({ chave: "k2", operacao: "appointment.change", citacao_acao: "o Josias pra sexta às 15h", atendimento: "a2", cliente: "c5", inicio: `${FRI}T15:00`,
        bases: [base("atendimento", "DITO", "o Josias"), base("inicio", "DITO", "pra sexta às 15h")] })]);
    const { off, on } = await both("Leva o Rosalvo pro Tarcísio e o Josias pra sexta às 15h.", p);
    for (const list of [off, on]) {
      expect(byKey(list, "k1").codes).toContain("AGENT_QUOTE_FOREIGN");
      expect(byKey(list, "k1").fields.date).not.toBe(FRI);
      expect(byKey(list, "k1").fields).not.toHaveProperty("time");
    }
    expect(byKey(on, "k1")).toEqual(byKey(off, "k1"));
  });
  it("V0: the shared day and clock are said back as a premise on the action that took them", async () => {
    const p = () => plan([
      act({ chave: "k1", operacao: "appointment.change", citacao_acao: "Leva o Rosalvo", atendimento: "a1", cliente: "c2", inicio: `${FRI}T15:00`,
        bases: [base("atendimento", "DITO", "o Rosalvo"), base("inicio", "DITO", "pra sexta às 15h")] }),
      act({ chave: "k2", operacao: "appointment.change", citacao_acao: "o Josias pra sexta às 15h", atendimento: "a2", cliente: "c5", inicio: `${FRI}T15:00`,
        bases: [base("atendimento", "DITO", "o Josias"), base("inicio", "DITO", "pra sexta às 15h")] })]);
    const { off, on } = await both("Leva o Rosalvo e o Josias pra sexta às 15h.", p);
    expect(byKey(off, "k1").premises).toEqual([]);
    expect(byKey(on, "k1")).toMatchObject({ status: "READY", fields: { date: FRI, time: "15:00" } });
    expect(byKey(on, "k1").premises.join("\n")).toContain("pra sexta às 15h");
    expect(byKey(on, "k2").premises).toEqual([]);
  });
  const henna = (quote: string) => () => plan([act({ citacao_acao: quote, cliente: "c1", profissional: "p1", servicos: SVC("s3"), inicio: `${FRI}T14:00`,
    bases: [base("cliente", "DITO", "A Graciete"), base("inicio", "DITO", "sexta às 14h")] })]);
  it("antecedent: another noun phrase between the name and the pronoun (two readings): the customer is never taken from the earlier sentence", async () => {
    const { off, on } = await both("A Graciete trouxe o recado da afilhada. Põe ela sexta às 14h com o Eurico, henna.", henna("Põe ela sexta às 14h com o Eurico, henna"));
    for (const list of [off, on]) expect(list[0].fields).not.toHaveProperty("customer_ref");
  });
  it("antecedent: the customer taken from the earlier sentence is an assumption: said as a premise", async () => {
    const { on } = await both("A Graciete telefonou. Põe ela sexta às 14h com o Eurico, henna.", henna("Põe ela sexta às 14h com o Eurico, henna"));
    expect(on[0]).toMatchObject({ status: "READY", fields: { customer_ref: "cu-gra" } });
    expect(on[0].codes).toContain("AGENT_NAME_ASSUMED");
    expect(on[0].premises.join("\n")).toContain("Graciete Lobo");
  });
  const lower = (quote: string) => () => plan([act({ citacao_acao: `põe ${quote} sexta às 14h com o eurico, henna`, cliente: null, profissional: "p1", servicos: SVC("s3"),
    inicio: `${FRI}T14:00`, bases: [base("cliente", "DITO", quote), base("inicio", "DITO", "sexta às 14h")] })]);
  it("name fallback: a message in lowercase never tells where the name ends: a lowercase surname is never swallowed into the one holder", async () => {
    const { off, on } = await both("põe a graciete dos anjos sexta às 14h com o eurico, henna.", lower("a graciete dos anjos"));
    for (const list of [off, on]) {
      expect(list[0].fields).not.toHaveProperty("customer_ref");
      expect(fold(list[0].fields.customer_name)).toContain("anjos");
    }
  });
});
