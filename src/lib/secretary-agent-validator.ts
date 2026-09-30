import { withTenant, type Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import type { SchedulingFields } from "./scheduling-contract";
import type { PendingTemporalAmbiguity } from "./scheduling-temporal-ambiguity";
import { matchesSchedulingPeriod } from "./scheduling-temporal";
import { clauseBounds, entityQuoteDenied, governingNegators, quoteTemporalFacts, temporalAtomSpans, temporalQuoteDenied } from "./scheduling-temporal-source";
import { UNSPECIFIED_DAYPART_ASKED_HOURS, dayDirection, resolveClockComponent, resolveDayComponent, temporalQuoteFacts, temporalVocabulary, verifyDayComponent } from "./scheduling-temporal-reference";
import { weekScopes, type DayComponent } from "../../packages/salon-secretary/src/temporal-components";
import { betweenBookingsGap, readOrdinal, selfReferenceProven, singlesOut, statedClockComponent, statedDayComponent } from "./secretary-same-as";
import { loadDayFacts, openReadings, type DayFacts, type DaypartPurpose } from "./scheduling-daypart-facts";
import { freeIntervals } from "./secretary-block-guard";
import { comboWithOwnPart, isCombo } from "./secretary-combo-guard";
import { comboParts } from "./secretary-multi-service";
import { groundSchedulingReasons } from "./scheduling-literal-source";
import { recurrenceOperation, statedRecurrence } from "./secretary-recurrence";
import { nameTokens, withoutArticle } from "./name-search";
import { NAME_TOKEN_SCAN, nameHasTokens } from "./secretary-name-tokens";
import { getSchedulingAvailability, schedulingSelfProfessional, schedulingTimezone, serviceNameKey } from "./scheduling-catalog";
import { locateSchedulingAppointments } from "./scheduling-mutations";
import { activeAppointmentCount, agentCustomerTokenSet } from "./secretary-agent-lookups";
import { subtractIntervals, unionIntervals } from "./intervals";
import { addCalendarDays, dateKeyInTimeZone, endExclusiveOfDateInTimeZone, startOfDateInTimeZone, toLocalDateTime, weekdayOfDateKey } from "./time";
import { formatClock, formatDay, formatLocal } from "./secretary-datetime-format";
import { durationLiterals, durationText } from "./scheduling-duration-literal";
import { foldedLiteral, literalProofSpans, literalSpans } from "../../packages/salon-secretary/src/literal-match";
import { dependencyGraph } from "../../packages/salon-secretary/src/dependency-graph";
import { AGENT_NAME_TOKEN_MIN, sanitizeAgentName, type AgentBinding } from "../../packages/salon-secretary/src/agent-context";
import { AGENT_MUTATING_OPERATIONS, AGENT_PLAN_LIMITS, AgentPlanError, decodeAgentPlan, type AgentBaseField, type AgentBaseType, type AgentPlan, type AgentPlanAction,
  type AgentPlanBase, type AgentPlanOperation, type AgentPlanResult, type AgentQuestionField, type AgentServiceMode } from "../../packages/salon-secretary/src/agent-plan";

/** Candidate 5, WP4 (flag SALON_SECRETARY_AGENT, default off; docs/c5-spike/11-especificacao-agente.md §5, V0-V25): the FACT validator of the
 * agent's resolved plan (`propor_plano`, decoded by agent-plan.ts). It never creates a value and never reinterprets Portuguese freely: it
 * checks refs of THIS message (the ALS binding), the tenant, the owner's literal words inside the clause the BACKEND computes (clauseBounds),
 * negation and retraction per operation, uniqueness over the whole token scan, the owner's rules as data checks, and it recomputes every
 * derived value from re-read rows. Each field ends accepted, back to the owner's words (NOME: prepare() resolves them as the C4 does), as a
 * card of backend rows, as a backend question, or its action leaves (DESCARTA); a structurally bad plan is refused whole (REJEITA: the
 * loop's fallback). An appointment ref of the model never skips the C4 locate (V7-A): the backend fills the origin facts the owner wrote and
 * accepts a# only when the locate picks exactly it. What the owner approves is backend text (premises, §5.5); Luna's own notes pass only
 * when every day, clock and name they mention is a validated value. All reads go through an AgentFactReader (one tenant transaction per
 * validation, in sequence: validateAgentPlanInTenant). Codes only in telemetry. Nothing imports this module with the flag off. */

// ---------------------------------------------------------------- contract
/** Owner decisions 15 ("com quem tiver"), 16 (exceção dita) and 17 ("até fechar") of docs/DECISOES_PRODUTO.md, registered on 30/09/2026
 * (the specification's proposed rules 13-15). A criterion off falls back to its safe form: a card of everyone eligible, the rule-10 card,
 * the end asked. Decision 18 (8-11 asked) is SALON_SECRETARY_DAYPART_ASK_WIDE, a flag of both arms (scheduling-temporal-reference). */
export type AgentValidatorCriteria = { readonly delegation: boolean; readonly exception: boolean; readonly workdayEnd: boolean };
export const AGENT_REGISTERED_CRITERIA: AgentValidatorCriteria = Object.freeze({ delegation: true, exception: true, workdayEnd: true });
export const AGENT_VALIDATOR_CODES = ["AGENT_SCHEMA", "AGENT_DAG", "AGENT_QUOTE_AMBIGUOUS", "AGENT_SCOPE_OVERLAP", "AGENT_REF_UNKNOWN", "AGENT_REF_KIND", "AGENT_REF_STALE",
  "AGENT_QUOTE_ABSENT", "AGENT_QUOTE_FOREIGN", "AGENT_QUOTE_REUSED", "AGENT_QUOTE_NEGATED", "AGENT_NEGATED", "AGENT_ENTITY_DENIED", "AGENT_RETRACTION", "AGENT_BASE_TYPE",
  "AGENT_HOMONYM", "AGENT_TOO_MANY", "AGENT_NAME_MISMATCH", "AGENT_APPT_LOCATE", "AGENT_PAST_ORIGIN", "AGENT_SELF_UNLINKED", "AGENT_DELEGATION_UNMARKED",
  "AGENT_DELEGATION_TIE", "AGENT_DELEGATION_NONE", "AGENT_PROFESSIONAL_UNSAID", "AGENT_TARGET_UNSAID", "AGENT_TEMPORAL_READING", "AGENT_DAYPART_ASK", "AGENT_DAYPART_ONE",
  "AGENT_DAY_MISSING", "AGENT_KEEP_UNPROVEN", "AGENT_END_MISSING", "AGENT_ANCHOR_MISMATCH", "AGENT_ANCHOR_ROLE", "AGENT_SEQUENCE_MISMATCH", "AGENT_BETWEEN_MISMATCH",
  "AGENT_RELEASE_MISMATCH", "AGENT_EXCEPTION_MISMATCH", "AGENT_EXCEPTION_OTHERS", "AGENT_EXCEPTION_MERGED", "AGENT_WORKDAY_END", "AGENT_COVERAGE", "AGENT_UNCOVERED",
  "AGENT_ACTIONS_LEFT", "AGENT_COMBO", "AGENT_SERVICE_MODE", "AGENT_RULE4", "AGENT_PRONOUN_TOPIC", "AGENT_DOUBLE_MUTATION", "AGENT_REASON_UNPROVEN", "AGENT_RECURRENCE",
  "AGENT_PREMISE_MISMATCH", "AGENT_FIELD_QUESTION", "AGENT_BASIS_CHANGED"] as const;
export type AgentValidatorCode = (typeof AGENT_VALIDATOR_CODES)[number];
/** §5.5: the line the backend appends to every turn with model text and no proposal nor receipt. */
export const AGENT_NOTHING_CHANGED = "Nada foi alterado.";
/** V15/V15-M: what the owner wrote and no action used (the owner's own words, quoted back). */
export const agentUncoveredText = (text: string) => `Não tratei «${text}»; quer que eu faça algo com isso?`;
export const agentActionsLeftText = (count: number) => `${count === 1 ? "Ficou 1 pedido" : `Ficaram ${count} pedidos`} de fora: faço até ${AGENT_PLAN_LIMITS.actions} por mensagem. Mande o restante em seguida.`;
/** Backend questions (pt-BR; no gender is read from any name). */
export const AGENT_QUESTIONS: Readonly<Partial<Record<AgentValidatorCode, string>>> = Object.freeze({
  AGENT_QUOTE_AMBIGUOUS: "Não consegui ligar este pedido a um único trecho da sua mensagem. Pode repetir só o que devo fazer nele?",
  AGENT_SCOPE_OVERLAP: "Dois pedidos saíram do mesmo trecho da sua mensagem. Diga o que devo fazer em cada um, separadamente.",
  AGENT_ENTITY_DENIED: "Sua mensagem também nega alguém ou algo deste pedido. Devo seguir com ele assim mesmo?",
  AGENT_RETRACTION: "Parece que você voltou atrás neste pedido. Devo seguir com ele?",
  AGENT_RULE4: "Cancelar e marcar de novo para a mesma pessoa é uma remarcação, que mantém o agendamento e o histórico. Quer que eu remarque em vez de cancelar?",
  AGENT_DOUBLE_MUTATION: "Dois pedidos mexem no mesmo agendamento. Qual deles devo fazer?",
  AGENT_SELF_UNLINKED: "Não encontrei seu cadastro como profissional neste salão. De quem é a agenda?",
  AGENT_DELEGATION_NONE: "Nenhum profissional que faz esse serviço está livre nesse horário. Prefere outro horário?",
  AGENT_TARGET_UNSAID: "Para qual profissional devo passar o atendimento?",
  AGENT_PRONOUN_TOPIC: "De qual cliente você está falando neste pedido?",
});
/** V5-E when the denied person or service was a value of the action: that value left, and prepare()'s own question for it follows. */
export const AGENT_ENTITY_DENIED_OPEN = "Sua mensagem também nega alguém ou algo deste pedido, então deixei esse dado em aberto.";
const DROP_NOTICES: Readonly<Partial<Record<AgentValidatorCode, string>>> = {
  AGENT_NEGATED: "Deixei de fora um pedido que aparece negado na sua mensagem.",
  AGENT_QUOTE_ABSENT: "Deixei de fora um pedido que não encontrei na sua mensagem.",
};

/** One appointment as the tenant holds it now (local "YYYY-MM-DDTHH:mm" in the appointment's timezone). */
export type AgentApptFact = { id: string; status: string; startLocal: string; endLocal: string; startAt: Date; professionalId: string; professionalName: string;
  customerId: string; customerName: string; serviceIds: string[]; serviceNames: string[]; revision: number };
export type AgentNamed = { id: string; name: string };
/** Every tenant read the validator needs (the actor is the reader's, never the model's). `professionals`/`services`: the salon's active
 * rows, undefined past the scan; `customerSet`: V7's S over the whole token scan (rows undefined past it); `dayAppointments`: one
 * professional's PENDING/CONFIRMED appointments of a day, start order, undefined past the scan; `locate`: the C4 locator's ids. */
export type AgentFactReader = {
  readonly timezone: string; readonly now: Date;
  appointment(id: string): Promise<AgentApptFact | undefined>;
  professionals(): Promise<AgentNamed[] | undefined>;
  services(): Promise<(AgentNamed & { durationMin: number })[] | undefined>;
  customer(id: string): Promise<AgentNamed | undefined>;
  customerSet(literal: string): Promise<{ rows?: AgentNamed[]; total: number }>;
  selfProfessional(): Promise<AgentNamed | undefined>;
  performers(serviceIds: readonly string[]): Promise<AgentNamed[]>;
  bookable(professionalId: string, serviceIds: readonly string[], startLocal: string): Promise<boolean>;
  activeCount(professionalId: string, date: string): Promise<number>;
  dayFacts(date: string, professionalIds: readonly string[]): Promise<DayFacts | undefined>;
  dayAppointments(professionalId: string, date: string): Promise<AgentApptFact[] | undefined>;
  locate(fields: SchedulingFields, operation: string): Promise<string[]>;
};
export type AgentCardKind = "customer_ref" | "professional_ref" | "target_professional_ref" | "service_ref" | "appointment_ref";
export type AgentCard = { kind: AgentCardKind; items: AgentNamed[] };
export type AgentQuestion = { code: AgentValidatorCode; field: string | null; text: string };
/** V7-A: the appointment the model named (`expected`, re-read and still changeable), the owner's words for it and what the C4 locator
 * found with the backend's origin facts. prepare() runs the locate again WITHOUT the model's ref; the apply accepts only `expected`. */
export type AgentOrigin = { expected?: string; quote?: string; located: string[] };
/** V13: a value that exists only after another action of the plan is prepared (agentDerivedCheck recomputes it then). */
export type AgentDerived = { type: "SEQUENCIA" | "ENTRE_ACOES" | "LIBERADO_POR"; keys: string[]; inicio: string | null; fim: string | null; offset: number;
  direction: "AFTER" | "BEFORE"; professional: string | null };
/** V23 provenance of a derived value, kept with the draft (agent_basis) and re-checked before the Confirmar writes. A delegated new professional
 * of a change was picked among everyone but the appointment's own professional (`exclude`), and is re-checked the same way. */
export type AgentBasis =
  | { type: "DELEGADO"; field: "profissional" | "novo_profissional"; chosen: string; set: string[]; counts: Record<string, number>; start: string; services: string[]; exclude?: string }
  | { type: "ANCORA"; field: "inicio"; anchor: { kind: "a"; id: string; revision: number; start: string; end: string } | { kind: "f"; start: string; end: string };
      professionalId: string; date: string; ordinal: "first" | "last" | "penultimate" | null; offset: number; direction: "AFTER" | "BEFORE"; value: string }
  | { type: "EXCECAO"; professionalId: string; date: string; start: string; end: string; kept: string[]; pieces: [string, string][] }
  | { type: "FIM_EXPEDIENTE"; professionalId: string; date: string; start: string; end: string }
  | { type: "MANTIDO"; appointment: string; revision: number; time: string }
  | { type: "SEQUENCIA" | "ENTRE_ACOES" | "LIBERADO_POR"; keys: string[]; expect?: { startLocal: string; endLocal: string }[] };
export type AgentActionOutcome = {
  key: string; operation: AgentPlanOperation;
  /** READY: prepare() runs with `fields` (it may still ask a missing field, as in the C4); ASK: a backend question, card or half-day
   * choice must be answered first; DROP: the action leaves (notice). */
  status: "READY" | "ASK" | "DROP";
  /** SchedulingFields for prepareResolvedScheduling: accepted refs, the owner's words (NOME), accepted temporal values; never appointment_ref. */
  fields: SchedulingFields;
  /** Fields the validator emptied on purpose (prepare asks them). */
  cleared: string[];
  card: AgentCard | null; question: AgentQuestion | null; asked: AgentQuestionField | null;
  ambiguities: PendingTemporalAmbiguity[]; origin: AgentOrigin | null; derived: AgentDerived | null; recurrence: string | null;
  dependsOn: string[]; releasedSlotOf: string | null;
  basis: AgentBasis[]; premises: string[]; note: string[]; notice: string | null; codes: AgentValidatorCode[];
  /** Registered names of every accepted id (cards, labels). */
  names: Record<string, string>;
};
export type AgentValidation =
  | { ok: false; code: "AGENT_SCHEMA" | "AGENT_DAG"; reasons: string[] }
  | { ok: true; result: AgentPlanResult; actions: AgentActionOutcome[]; notices: string[]; question: { field: "operacao"; text: string } | null; reply: string | null;
      codes: AgentValidatorCode[] };
export type AgentValidationInput = { owner: readonly string[]; binding: AgentBinding; reader: AgentFactReader; criteria?: AgentValidatorCriteria };

// ---------------------------------------------------------------- closed classes and small helpers
type Span = readonly [number, number];
const meets = (a: Span, b: Span) => a[0] < b[1] && b[0] < a[1];
const inside = (s: Span, r: Span) => s[0] >= r[0] && s[1] <= r[1];
const words = (text: string) => foldedLiteral(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Closed grammatical classes (folded): glue that never names anyone, personal/possessive pronouns, indefinite pronouns, first person. */
const GLUE = new Set(["a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos", "d", "em", "no", "na", "nos", "nas", "num", "numa", "ao", "aos",
  "pra", "pro", "pras", "pros", "para", "p", "com", "c", "por", "pelo", "pela", "pelos", "pelas", "e", "ou", "que", "q", "se", "so", "tambem", "tb", "tbm"]);
const PRONOUNS = new Set(["ela", "ele", "elas", "eles", "dela", "dele", "delas", "deles", "nela", "nele", "nelas", "neles"]);
const PLURAL_PRONOUNS = new Set(["elas", "eles", "delas", "deles", "nelas", "neles"]);
const INDEFINITE = new Set(["quem", "qualquer", "alguem"]);
const FIRST_PERSON = new Set(["eu", "mim", "comigo", "meu", "minha", "meus", "minhas"]);
/** The head nouns of an agenda row ("o horário da X", "o atendimento dela"): never part of a name. */
const APPT_WORDS = new Set(["horario", "horarios", "atendimento", "atendimentos", "agendamento", "agendamentos", "cliente", "clientes", "marcacao", "marcacoes", "reserva", "vez"]);
/** Words that make a region speak of another value than a shared one (the D4 rule): negators and alterity words. */
const NOT_SHARED = new Set(["nao", "nem", "nunca", "sem", "menos", "exceto", "outro", "outra", "outros", "outras", "diferente", "diferentes"]);
/** V14: the generic exception (closed class): every appointment of the interval is kept. */
const GENERIC_EXCEPTION = new Set(["cliente", "clientes", "agendamento", "agendamentos", "atendimento", "atendimentos", "marcado", "marcados", "marcada", "marcadas",
  "marcacao", "marcacoes", "vazio", "vazios", "livre", "livres", "ocupado", "ocupados"]);
const EXCEPTION_GLUE = new Set(["menos", "exceto", "fora", "tirando", "salvo", "sem", "nao", "somente", "apenas", "hora", "horas"]);
/** V12: the direction words of an anchor (closed classes), and every other word an anchor quote may hold besides names and a duration. */
const AFTER = new Set(["depois", "apos", "seguida", "terminar", "termina", "terminou", "acabar", "acaba", "acabou"]);
const BEFORE = new Set(["antes"]);
const ORDINAL_WORDS = new Set(["primeiro", "primeira", "ultimo", "ultima", "penultimo", "penultima"]);
const ANCHOR_WORDS = new Set([...AFTER, ...BEFORE, ...ORDINAL_WORDS, ...APPT_WORDS, "logo", "assim", "em", "que", "min", "minuto", "minutos", "hora", "horas", "meia", "livre", "livres"]);
const NEGATOR = /(?<![\p{L}\p{N}])(?:n[aã]o|nunca|jamais|nem)(?![\p{L}\p{N}])/giu;
const BOUNDARY = /[,.;!?()\n]/;
const temporalWord = (word: string) => /^\d/.test(word) || temporalVocabulary(word);
/** The words of an owner quote that can name a person or a service (glue, pronouns, first person, indefinites, agenda nouns and temporal
 * words out). */
const nameCore = (text: string) => nameTokens(withoutArticle(text.trim())).filter(token => !GLUE.has(token) && !PRONOUNS.has(token) && !FIRST_PERSON.has(token) &&
  !INDEFINITE.has(token) && !APPT_WORDS.has(token) && !temporalWord(token));
/** The folded tokens of the capitalized words of a quote (a proper name the owner wrote). */
const capitals = (text: string) => new Set([...text.matchAll(/\p{Lu}[\p{L}\p{M}'’-]*/gu)].flatMap(match => nameTokens(match[0])));
/** A quote without its leading and trailing glue, pronouns, agenda nouns and temporal words: the owner's words for a name (NOME). */
function trimmedName(text: string) {
  const list = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’.-]*/gu)];
  const keep = (match: RegExpMatchArray) => { const word = foldedLiteral(match[0]); return !GLUE.has(word) && !PRONOUNS.has(word) && !APPT_WORDS.has(word) && !temporalWord(word); };
  const first = list.findIndex(keep), last = list.findLastIndex(keep);
  return first < 0 ? undefined : text.slice(list[first].index!, list[last].index! + list[last][0].length);
}
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
const minuteOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
/** Wall-clock arithmetic on a local "YYYY-MM-DDTHH:mm". */
const shift = (local: string, minutes: number) => { const at = new Date(`${local}:00Z`); at.setUTCMinutes(at.getUTCMinutes() + minutes); return at.toISOString().slice(0, 16); };
const twin = (clock: string) => `${pad((Number(clock.slice(0, 2)) + 12) % 24)}${clock.slice(2)}`;
const label = (name: string) => sanitizeAgentName(name) || "sem nome";
const named = (rows: readonly AgentNamed[]) => rows.map(row => ({ id: row.id, name: label(row.name) }));
const listText = (names: readonly string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
const apptLabel = (row: AgentApptFact) => `${label(row.customerName)} — ${formatLocal(row.startLocal)} — ${label(row.professionalName)}`;
const clean = (text: string, max: number) => [...text.normalize("NFC").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()].slice(0, max).join("").trim();
const CARD_MAX = 20;

// ---------------------------------------------------------------- the owner's words
type Source = { text: string; bounds: Span[]; owner: readonly string[] };
/** The owner's messages of this turn joined by a line break (a clause boundary); a quote must lie inside one message. */
function ownerSource(owner: readonly string[]): Source {
  const bounds: Span[] = [];
  let at = 0;
  for (const message of owner) { bounds.push([at, at + message.length]); at += message.length + 1; }
  return { text: owner.join("\n"), bounds, owner };
}
const withinOne = (src: Source, span: Span) => src.bounds.some(bound => inside(span, bound));
const spansOf = (src: Source, literal: string): Span[] => literal.trim() ? literalProofSpans(src.text, literal).filter(span => withinOne(src, span)) : [];
type Atom = { kind: "date" | "clock"; start: number; end: number; negated: boolean };

/** The day(s) an owner quote [span] of `text` states: the C4's own day grammar on the message's date atoms that meet the quote, widened in
 * the message to their scope words ("essa", "próxima", "que vem"), so a clipped quote never proves a day the owner did not say. undefined:
 * no day in it; "UNREAD": a day the grammar does not read (effect NOME). */
function dayOf(text: string, all: readonly Atom[], span: Span, role: "date" | "source_date" | "end_date", operation: string, timezone: string, now: Date): { dates: string[] } | "UNREAD" | undefined {
  const atoms = all.filter(atom => atom.kind === "date" && meets([atom.start, atom.end], span));
  if (!atoms.length) return undefined;
  let from = Math.min(...atoms.map(atom => atom.start)), to = Math.max(...atoms.map(atom => atom.end));
  const scope = /(?:^|[^\p{L}\p{N}])((?:[nd]?ess[ae]|[nd]?est[ae]|pr[oó]xim[oa])\s+)$/iu.exec(text.slice(0, from));
  if (scope) from -= scope[1].length;
  const next = /^\s+que\s+vem(?![\p{L}\p{N}])/iu.exec(text.slice(to));
  if (next) to += next[0].length;
  const today = dateKeyInTimeZone(now, timezone), direction = dayDirection(role, operation), components = dayComponents(text.slice(from, to), today, operation, role);
  // Every reading the grammar accepts ("sexta" verifies as the nearest and as this week's: one date; "sexta que vem" is a choice of two).
  const dates = new Set<string>();
  for (const component of components) {
    const resolved = resolveDayComponent(component, today, direction);
    if (resolved.status === "REJECTED") return "UNREAD";
    for (const date of resolved.status === "OK" ? [resolved.date] : resolved.candidates) dates.add(date);
  }
  return dates.size ? { dates: [...dates].sort() } : "UNREAD";
}
const NO_DAY = { offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null } as const;
/** The day components a pure day expression states: statedDayComponent's single one, else every weekday scope and day of the month the
 * C4's token proof (verifyDayComponent) accepts. */
function dayComponents(core: string, today: string, operation: string, role: string): DayComponent[] {
  const stated = statedDayComponent(core, today, operation);
  if (stated) return [stated];
  const facts = temporalQuoteFacts(core);
  const months = [...facts.months, ...facts.dateNums.filter(token => token.part === "month").map(token => token.n)], years = facts.dateNums.filter(token => token.part === "year").map(token => token.n);
  const candidates: DayComponent[] = [...facts.relative.map(offset => ({ ...NO_DAY, kind: "RELATIVE_DAY" as const, offset })),
    ...facts.weekdays.flatMap(weekday => weekScopes.map(week => ({ ...NO_DAY, kind: "WEEKDAY" as const, weekday, week }))),
    ...facts.dateNums.filter(token => token.part === "day").map(token => ({ ...NO_DAY, kind: "DAY_OF_MONTH" as const, day: token.n, month: months[0] ?? null, year: years[0] ?? null,
      weekday: facts.weekdays.length === 1 ? facts.weekdays[0] : null }))];
  return candidates.filter(value => verifyDayComponent(core, value, today, { direction: dayDirection(role, operation), role, operation }).status !== "REJECTED");
}
/** The clock readings of an owner quote [span] of `text`: the C4's clock grammar (statedClockComponent) on one of the message's clock atoms
 * that meet the quote (an interval's ends are atoms of the whole "das X às Y"), with its lead ("às", "das"…) and an adjacent daypart read in
 * the message. A bare hour in UNSPECIFIED_DAYPART_ASKED_HOURS (1-7; 1-11 with SALON_SECRETARY_DAYPART_ASK_WIDE) reads both halves of the
 * day unless a daypart written in the quote settles it. `pick`: an interval's first or last clock; "only" refuses two clocks. */
function clockOf(text: string, all: readonly Atom[], span: Span, operation: string, pick: "first" | "last" | "only", timezone: string, now: Date): { readings: string[] } | "UNREAD" | undefined {
  const atoms = all.filter(atom => atom.kind === "clock" && meets([atom.start, atom.end], span)).sort((a, b) => a.start - b.start);
  if (!atoms.length) return undefined;
  if (pick === "only" && atoms.length > 1) return "UNREAD";
  const atom = pick === "last" ? atoms.at(-1)! : atoms[0];
  let from = atom.start, to = atom.end;
  const lead = /(?:^|[^\p{L}\p{N}])((?:l[aá]\s+)?(?:[àa]s|pelas|umas|pras|pra|das|las)\s+)$/iu.exec(text.slice(0, from));
  if (lead && !/^(?:[àa]s|pelas|umas|pras|pra|das|las)\s/iu.test(text.slice(from, to))) from -= lead[1].length;
  const part = /^\s+(?:da|de|[àa])\s+(?:manh[ãa]|tarde|noite)(?![\p{L}\p{N}])/iu.exec(text.slice(to));
  if (part) to += part[0].length;
  const component = statedClockComponent(text.slice(from, to), operation);
  if (!component) return "UNREAD";
  const resolved = resolveClockComponent(component);
  if (resolved.status !== "OK") return "UNREAD";
  if (component.daypart !== "UNSPECIFIED") return { readings: [resolved.time] };
  const [low, high] = UNSPECIFIED_DAYPART_ASKED_HOURS, period = quoteTemporalFacts(text.slice(Math.min(span[0], from), Math.max(span[1], to)), timezone, now).period;
  const readings = component.hour >= low && component.hour <= high ? [resolved.time, twin(resolved.time)].sort() : [resolved.time];
  const settled = period ? readings.filter(time => matchesSchedulingPeriod(time, period)) : readings;
  return { readings: settled.length ? settled : readings };
}

// ---------------------------------------------------------------- per action state
type Located = { base: AgentPlanBase; span?: Span; text?: string; code?: AgentValidatorCode };
type Entity = { id?: string; name?: string; tokens: string[]; spans: Span[]; pronoun?: boolean; plural?: boolean; proven?: boolean };
type Service = { id: string; name: string; tokens: string[]; spans: Span[]; mode: AgentServiceMode; durationMin: number; claims: Span[] };
/** `claims`: the owner's name words (whole-token spans) that already proved a person or service of this action (V4: one span proves one role).
 * `anchor`: a free-interval anchor's basis and premise, withdrawn when another action of the plan fills that interval. */
type Work = {
  a: AgentPlanAction; quote?: Span; own?: Span;
  status: "READY" | "ASK" | "DROP"; question?: AgentQuestion; notice?: string; card?: AgentCard; asked: AgentQuestionField | null;
  fields: SchedulingFields; cleared: Set<string>; ambiguities: PendingTemporalAmbiguity[]; origin?: AgentOrigin; derived?: AgentDerived; recurrence?: string;
  basis: AgentBasis[]; premises: string[]; note: string[]; codes: AgentValidatorCode[]; names: Record<string, string>;
  bases: Map<AgentBaseField, Located>; consumed: Span[]; claims: Span[]; reason?: Span;
  customer?: Entity; professional?: Entity; target?: Entity; services: Service[];
  appt?: AgentApptFact; date?: string; time?: string; endDate?: string; endTime?: string; durationMin?: number;
  anchor?: { basis: AgentBasis; premise: string };
};
const MUTATING = new Set<string>(AGENT_MUTATING_OPERATIONS);
const BOOKING = new Set<string>(["appointment.create", "availability.get"]);
const ORIGIN_OPERATIONS = new Set<string>(["appointment.change", "appointment.cancel", "appointment.read", "appointment.list"]);
const TEMPORAL_FIELDS = new Set<AgentBaseField>(["inicio", "fim", "dia"]);
const DERIVED_TYPES = new Set<AgentBaseType>(["SEQUENCIA", "ENTRE_ACOES", "LIBERADO_POR"]);
function newWork(a: AgentPlanAction): Work {
  return { a, status: "READY", asked: null, fields: {}, cleared: new Set(), ambiguities: [], basis: [], premises: [], note: [], codes: [], names: {}, bases: new Map(),
    consumed: [], claims: [], services: [] };
}
const code = (w: Work, value: AgentValidatorCode) => { if (!w.codes.includes(value)) w.codes.push(value); };
function ask(w: Work, value: AgentValidatorCode, field: string | null = null, text?: string) {
  code(w, value);
  if (w.status === "DROP") return;
  w.question ??= { code: value, field, text: text ?? AGENT_QUESTIONS[value] ?? AGENT_QUESTIONS.AGENT_QUOTE_AMBIGUOUS! };
  w.status = "ASK";
}
function drop(w: Work, value: AgentValidatorCode) { code(w, value); w.status = "DROP"; w.notice ??= DROP_NOTICES[value]; }
/** A card of backend rows (labels already built from sanitized names). */
function card(w: Work, kind: AgentCardKind, items: readonly AgentNamed[], value: AgentValidatorCode) {
  code(w, value);
  if (w.status === "DROP") return;
  w.card ??= { kind, items: items.slice(0, CARD_MAX).map(item => ({ ...item })) };
  w.status = "ASK";
}
/** Empties C4 fields so prepare() asks them (the owner's own question path). */
function clear(w: Work, keys: readonly (keyof SchedulingFields)[], value?: AgentValidatorCode) {
  if (value) code(w, value);
  for (const key of keys) { delete w.fields[key]; w.cleared.add(key); }
}
const CUSTOMER_KEYS = ["customer_ref", "customer_name"] as const, PROFESSIONAL_KEYS = ["professional_ref", "professional_name"] as const;
const TARGET_KEYS = ["target_professional_ref", "target_professional_name"] as const;
const SERVICE_KEYS = ["service_ref", "service_name", "service_names", "service_list_ref", "service_changes", "service_changes_ref"] as const;
/** The fields whose DITO quotes name a person or a service (V4: such a quote proves its own role only). */
const ENTITY_FIELDS = new Set<AgentBaseField>(["cliente", "profissional", "novo_profissional", "servicos"]);
/** Two blocks that both carry an exception are the pieces of ONE interval (owner decision 16: one block per free piece, from one clause). */
const exceptionPieces = (w: Work, other: Work) => [w, other].every(item => item.a.operacao === "schedule.block" && item.a.bases.some(base => base.tipo === "EXCECAO"));

// ---------------------------------------------------------------- validation
/** §5: validate a decoded plan against the owner's messages of this turn, the message's binding and the tenant (through `reader`). */
export async function validateAgentPlan(plan: AgentPlan, input: AgentValidationInput): Promise<AgentValidation> {
  // V1: decoded, at most 4 actions, acyclic graph, released slot of a cancel/change it depends on.
  const checked = decodedPlan(plan);
  if ("reasons" in checked) return { ok: false, code: "AGENT_SCHEMA", reasons: checked.reasons };
  const decoded = checked.plan, graph = graphViolation(decoded);
  if (graph) return { ok: false, code: "AGENT_DAG", reasons: [graph] };
  const result = decoded.resultado;
  if (result === "CONVERSA" || result === "FORA_DO_ESCOPO")
    return { ok: true, result, actions: [], notices: [], question: null, reply: `${clean(decoded.resposta ?? "", AGENT_PLAN_LIMITS.reply)}\n${AGENT_NOTHING_CHANGED}`, codes: [] };
  if (result === "PERGUNTA" && decoded.pergunta?.campo === "operacao")
    return { ok: true, result, actions: [], notices: [], question: { field: "operacao", text: `${clean(decoded.pergunta.texto, AGENT_PLAN_LIMITS.question)}\n${AGENT_NOTHING_CHANGED}` }, reply: null, codes: [] };
  const reader = cachedReader(input.reader), binding = input.binding, criteria = input.criteria ?? AGENT_REGISTERED_CRITERIA;
  const timezone = reader.timezone, now = reader.now, today = dateKeyInTimeZone(now, timezone), src = ownerSource(input.owner);
  const atoms: Atom[] = temporalAtomSpans(src.text, timezone, now) ?? [];
  const works = decoded.acoes.map(newWork);
  /** The plan's execution order (the C4's: dependencies first, then the plan's order), for V8's least busy count. */
  const rank = new Map(dependencyGraph(decoded.acoes.map(action => ({ key: action.chave, depends_on: action.depende_de }))).order.map((key, index) => [key, index] as const));
  /** The owner's words (original offsets, folded form), for V4's name runs (runOf). */
  const wordList = [...src.text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu)].map(match => ({ start: match.index!, end: match.index! + match[0].length, word: foldedLiteral(match[0]) }));
  /** The other actions whose clause is theirs alone (the pieces of one excepted interval share theirs; an action that asks because it
   * came out of an earlier action's segment does not take that action's words). */
  const rivals = (w: Work) => works.filter(other => other !== w && other.own && !exceptionPieces(w, other) && !other.codes.includes("AGENT_SCOPE_OVERLAP"));
  const ownSpans = () => works.flatMap(w => w.own ? [w.own] : []);
  const dayAtoms = (region: Span) => atoms.filter(atom => atom.kind === "date" && inside([atom.start, atom.end], region));
  const segmentOf = (span: Span): Span => { const bounds = clauseBounds(src.text, span[0], span[1]); return bounds ? [bounds.start, bounds.end] : span; };

  // ---- V0: the backend's clause of every action; two mutations from the same segment: the later one asks.
  for (const w of works) {
    const spans = spansOf(src, w.a.citacao_acao);
    if (!spans.length) { drop(w, "AGENT_QUOTE_ABSENT"); continue; }
    if (spans.length > 1) { ask(w, "AGENT_QUOTE_AMBIGUOUS"); continue; }
    const bounds = clauseBounds(src.text, spans[0][0], spans[0][1]);
    if (!bounds) { ask(w, "AGENT_QUOTE_AMBIGUOUS"); continue; }
    w.quote = spans[0]; w.own = [bounds.start, bounds.end];
  }
  const placed = works.filter(w => w.own && MUTATING.has(w.a.operacao)).sort((a, b) => a.quote![0] - b.quote![0]);
  placed.forEach((w, index) => { if (placed.slice(0, index).some(prior => !exceptionPieces(w, prior) && meets(prior.own!, w.own!))) ask(w, "AGENT_SCOPE_OVERLAP"); });

  // ---- V4/V6: every base located in the regions its action admits; the reasons (V21) located the same way.
  /** (a) the action's own segment and (b) any later segment that is no other action's clause; (c) before it only for a day said once for
   * coordinated actions (the D4 rule: the action's own segment states no day and no negator or alterity word; the day lies outside every
   * clause, undenied, and does not single one person out). A span that meets another action's clause is never admitted. */
  const admits = (w: Work, span: Span, dayField: boolean) => {
    if (!w.own || rivals(w).some(other => meets(other.own!, span))) return false;
    if (span[0] >= w.own[0]) return true;
    if (!dayField || ownSpans().some(own => meets(own, [span[0], Math.min(span[1], w.own![0])])) || dayAtoms(w.own).length) return false;
    if (words(src.text.slice(w.own[0], w.own[1])).some(word => NOT_SHARED.has(word))) return false;
    return !singlesOut(src.text, span, ownSpans()) && !temporalQuoteDenied(src.text, span[0], span[1], w.a.operacao);
  };
  const reasonSpans = () => works.flatMap(w => w.reason ? [w.reason] : []);
  for (const w of works) {
    if (!w.own || !w.a.motivo) continue;
    const found = spansOf(src, w.a.motivo).filter(span => admits(w, span, false));
    if (found.length === 1) w.reason = found[0];
  }
  for (const w of works) {
    if (!w.own) continue;
    for (const base of w.a.bases) {
      const spans = spansOf(src, base.citacao), dayField = base.campo === "dia" || base.campo === "inicio";
      const admitted = spans.filter(span => admits(w, span, dayField));
      const located: Located = !spans.length ? { base, code: "AGENT_QUOTE_ABSENT" } : !admitted.length ? { base, code: "AGENT_QUOTE_FOREIGN" }
        : admitted.length > 1 ? { base, code: "AGENT_QUOTE_AMBIGUOUS" } : { base, span: admitted[0], text: src.text.slice(admitted[0][0], admitted[0][1]) };
      if (located.span && base.tipo !== "EXCECAO" && base.tipo !== "NAO_DITO") {
        const [start, end] = located.span, operation = w.a.operacao;
        const denied = TEMPORAL_FIELDS.has(base.campo) ? temporalQuoteDenied(src.text, start, end, operation, reasonSpans()) : entityQuoteDenied(src.text, start, end, operation);
        if (denied) located.code = "AGENT_QUOTE_NEGATED";
      }
      w.bases.set(base.campo, located);
    }
    // One span proves one role (a block's interval proves its start and end; a day may also give the date of the start).
    const list = [...w.bases.values()].filter(item => item.span && !item.code);
    for (const item of list) for (const other of list) {
      if (item === other || !meets(item.span!, other.span!)) continue;
      const pair = new Set([item.base.campo, other.base.campo]);
      if (pair.has("inicio") && (pair.has("fim") && w.a.operacao === "schedule.block" || pair.has("dia"))) continue;
      item.code = "AGENT_QUOTE_REUSED";
    }
  }

  // ---- V5-N: a negator governing the action's clause (or inside its own quote, a value correction or a sibling's reason aside) drops it.
  for (const w of works) {
    if (!w.quote || w.status === "DROP") continue;
    const governing = governingNegators(src.text, w.quote[0], w.quote[1], reasonSpans());
    if (!governing || governing.length || innerNegator(w)) drop(w, "AGENT_NEGATED");
  }
  const live = () => works.filter(w => w.status !== "DROP" && w.own);

  // ---- pass 1: people (V2, V3, V4-E, V7, V8 first person); rule 7's topic (V18).
  const professionals = await reader.professionals() ?? [], services = await reader.services() ?? [];
  const directoryTokens = new Set([...professionals, ...services].flatMap(row => nameTokens(row.name)));
  for (const w of live()) {
    await customerStep(w);
    await personStep(w, "profissional");
  }
  const topic = live().filter(w => MUTATING.has(w.a.operacao) && w.customer?.proven && w.customer.id).sort((a, b) => a.quote![0] - b.quote![0])[0]?.customer;
  for (const w of live()) {
    if (!w.customer?.pronoun) continue;
    if (w.customer.plural || !topic?.id || w.customer.id !== undefined && w.customer.id !== topic.id) { clear(w, CUSTOMER_KEYS); ask(w, "AGENT_PRONOUN_TOPIC", "customer_ref"); continue; }
    w.customer = { ...w.customer, id: topic.id, name: topic.name, tokens: [...topic.tokens] };
    w.fields.customer_ref = topic.id; w.names[topic.id] = topic.name ?? "";
  }

  // ---- pass 2: the appointment (V7-A), services (V16), time (V9-V12, V14's end), a change's new professional, reason (V21), recurrence (V22).
  for (const w of live()) {
    if (w.a.operacao === "appointment.change" || w.a.operacao === "appointment.cancel" || w.a.atendimento) await originStep(w);
    await servicesStep(w);
    dayStep(w);
    await startStep(w);
    await endStep(w);
    if (w.a.operacao === "appointment.change") await personStep(w, "novo_profissional");
    reasonStep(w);
    recurrenceStep(w);
  }
  // ---- V8's deferred picks, in the plan's execution order: the least busy count holds what the plan's earlier actions book, move or cancel
  // that day (what the tenant holds when this one runs), so the plan's own writes never change a pick at the Confirmar.
  for (const w of live().sort((x, y) => (rank.get(x.a.chave) ?? 0) - (rank.get(y.a.chave) ?? 0))) {
    await deferredProfessional(w, "profissional");
    if (w.a.operacao === "appointment.change") await deferredProfessional(w, "novo_profissional");
  }
  sharedFreeAnchors();

  // ---- plan level: V14 exception groups, V17, V20, V5-E, V5-R, V15, V15-M, V25.
  await exceptionGroups();
  const knownNames = new Set([...professionals, ...services].flatMap(row => nameTokens(row.name)).filter(token => [...token].length >= AGENT_NAME_TOKEN_MIN));
  for (const entry of binding.entries("c")) for (const token of nameTokens(String((entry.facts as { shown?: string }).shown ?? ""))) if ([...token].length >= AGENT_NAME_TOKEN_MIN) knownNames.add(token);
  for (const w of works) for (const entity of entities(w)) for (const token of [...entity.tokens, ...nameTokens(entity.name ?? "")]) if ([...token].length >= AGENT_NAME_TOKEN_MIN) knownNames.add(token);
  rule4();
  doubleMutation();
  for (const w of live()) { entityDenied(w); retraction(w); }
  const notices = coverage();
  for (const w of works) notes(w);
  if (decoded.acoes_fora > 0) notices.push(agentActionsLeftText(decoded.acoes_fora));
  if (result === "PERGUNTA" && decoded.pergunta) {
    const target = works.find(w => w.a.chave === decoded.pergunta!.acao);
    if (target) { target.asked = decoded.pergunta.campo; code(target, "AGENT_FIELD_QUESTION"); }
  }
  for (const w of [...works].reverse()) if (w.status === "DROP" && w.notice && !notices.includes(w.notice)) notices.unshift(w.notice);
  const actions = works.map((w): AgentActionOutcome => ({ key: w.a.chave, operation: w.a.operacao, status: w.status, fields: { ...w.fields }, cleared: [...w.cleared],
    card: w.card ?? null, question: w.question ?? null, asked: w.asked, ambiguities: [...w.ambiguities], origin: w.origin ?? null, derived: w.derived ?? null,
    recurrence: w.recurrence ?? null, dependsOn: [...w.a.depende_de], releasedSlotOf: w.a.ocupa_horario_de, basis: [...w.basis], premises: [...w.premises], note: [...w.note],
    notice: w.notice ?? null, codes: [...w.codes], names: { ...w.names } }));
  return { ok: true, result, actions, notices, question: null, reply: null, codes: [...new Set(actions.flatMap(action => action.codes))] };

  // ================================================================ V5-N helper
  function innerNegator(w: Work) {
    const [from, to] = w.quote!, own = [...w.bases.values()].flatMap(item => item.base.tipo === "EXCECAO" && item.span ? [item.span] : []);
    if (w.reason) own.push(w.reason);
    for (const match of src.text.slice(from, to).matchAll(NEGATOR)) {
      const at = from + match.index!, span: Span = [at, at + match[0].length];
      if (own.some(item => inside(span, item))) continue;
      // A negator attached to a temporal value corrects that value ("às 3, não às 2"), it does not deny the action.
      const glue = /^(?:\s+(?:em|na|no|nas|nos|a|as|às|ao|aos|para|pra|pro|de|do|da|das|dos)){0,3}\s+/iu.exec(src.text.slice(span[1]));
      if (glue && atoms.some(atom => atom.start >= span[1] && atom.start <= span[1] + glue[0].length)) continue;
      return true;
    }
    return false;
  }

  // ================================================================ people
  function baseOf(w: Work, field: AgentBaseField) { return w.bases.get(field); }
  /** The owner's words for an entity field when the model's ref cannot stand (NOME): an admitted, undenied quote without its glue. */
  function ownerWords(w: Work, field: AgentBaseField) {
    const located = baseOf(w, field);
    return located?.text && !located.code ? trimmedName(located.text) : undefined;
  }
  /** The owner's own spelling of the name tokens found (distinct spans, in order). */
  function spelled(spans: readonly Span[]) {
    const seen = new Set<string>();
    return [...spans].sort((x, y) => x[0] - y[0]).map(span => src.text.slice(span[0], span[1])).filter(text => !seen.has(text) && !!seen.add(text)).join(" ");
  }
  /** V4: the owner's name run holding a word (the words beside it separated by spaces only, none of them glue, a pronoun, a first person, an
   * indefinite, an agenda noun or a temporal word): one written name ("Quitéria Prates"). Used only to let a customer's own run hold a word
   * that is also the salon's. */
  function runOf(span: Span): Span {
    const at = wordList.findIndex(item => item.start <= span[0] && span[0] < item.end);
    if (at < 0) return span;
    const name = (index: number) => { const word = wordList[index].word;
      return !GLUE.has(word) && !PRONOUNS.has(word) && !FIRST_PERSON.has(word) && !INDEFINITE.has(word) && !APPT_WORDS.has(word) && !temporalWord(word); };
    const joined = (left: number) => /^[^\S\n]+$/u.test(src.text.slice(wordList[left].end, wordList[left + 1].start));
    let low = at, high = at;
    while (low > 0 && name(low - 1) && joined(low - 1)) low--;
    while (high < wordList.length - 1 && name(high + 1) && joined(high)) high++;
    return [wordList[low].start, Math.max(wordList[high].end, span[1])];
  }
  /** V4 (one span proves one role): what a name search for `field` may not use: the words another person or service of this action already
   * proved, the quotes of its other person and service bases, and, for the customer, the anchor and exception quotes (other rows'
   * customers). The appointment's own quote is shared on purpose (it names its customer and professional, V7-A). */
  function claimed(w: Work, field: AgentBaseField): Span[] {
    return [...w.claims, ...[...w.bases.values()].flatMap(item => item.span && item.base.campo !== field && (item.base.tipo === "DITO" && ENTITY_FIELDS.has(item.base.campo) ||
      field === "cliente" && (item.base.tipo === "ANCORA" || item.base.tipo === "EXCECAO")) ? [item.span] : [])];
  }
  /** V4-E: the chosen name's whole tokens (≥ 3 letters) the owner wrote in the action's own region (its clause and the later segments that
   * are no other action's clause, V4 (a)/(b)), outside every temporal atom, undenied (V6) and unclaimed by another role (V4). A customer is
   * never proven by the salon's professional or service words alone: such a word counts only inside a run the customer's own words hold
   * ("Iolanda Serafim"), never as the professional said apart ("com o Serafim"). `claims`: the spans used. */
  function namedIn(w: Work, name: string, field: AgentBaseField): { tokens: string[]; spans: Span[]; claims: Span[] } {
    const out = { tokens: [] as string[], spans: [] as Span[], claims: [] as Span[] }, taken = claimed(w, field), hits = new Map<string, Span[]>();
    for (const token of new Set(nameTokens(withoutArticle(name)).filter(item => [...item].length >= AGENT_NAME_TOKEN_MIN))) {
      const found = literalSpans(src.text, token).filter(span => withinOne(src, span) && span[0] >= w.own![0] && admits(w, span, false) &&
        !atoms.some(atom => meets([atom.start, atom.end], span)) && !taken.some(item => meets(item, span)) && !entityQuoteDenied(src.text, span[0], span[1], w.a.operacao));
      if (found.length) hits.set(token, found);
    }
    const personal = field === "cliente" ? [...hits].filter(([token]) => !directoryTokens.has(token)).flatMap(([, spans]) => spans.map(runOf)) : undefined;
    for (const [token, spans] of hits) {
      const kept = personal && directoryTokens.has(token) ? spans.filter(span => personal.some(run => inside(span, run))) : spans;
      if (kept.length) { out.tokens.push(token); out.spans.push(...kept); }
    }
    out.claims = [...out.spans];
    return out;
  }
  /** The owner's text of `span` with the spans in `taken` blanked (offsets kept): the words left for this role. */
  function unclaimed(span: Span, taken: readonly Span[]) {
    let text = src.text.slice(span[0], span[1]);
    for (const item of taken) {
      if (!meets(item, span)) continue;
      const from = Math.max(item[0], span[0]) - span[0], to = Math.min(item[1], span[1]) - span[0];
      text = text.slice(0, from) + " ".repeat(to - from) + text.slice(to);
    }
    return text;
  }
  /** The literal of an entity: its DITO quote's name words (each a word of the chosen name, or a capitalized word the owner wrote, which
   * contradicts it), or V4-E's tokens found in the clause. Words another role of the action proved are not this one's (V4), and a customer's
   * quote uses the salon's professional and service words only inside a run its own words hold. */
  function literalOf(w: Work, field: AgentBaseField, name: string): { tokens: string[]; spans: Span[]; claims: Span[] } | { code: AgentValidatorCode; text?: string } {
    const located = baseOf(w, field);
    if (located && located.base.tipo === "DITO") {
      if (located.code) return { code: located.code };
      const taken = claimed(w, field), free = unclaimed(located.span!, taken), all = nameCore(free), own = new Set(nameTokens(withoutArticle(name))), caps = capitals(free);
      const text = trimmedName(free), within = (token: string) => literalSpans(src.text, token).filter(span => inside(span, located.span!) && !taken.some(item => meets(item, span)));
      const runs = field === "cliente" ? all.filter(token => !directoryTokens.has(token)).flatMap(token => within(token).map(runOf)) : undefined;
      const core = runs ? all.filter(token => !directoryTokens.has(token) || within(token).some(span => runs.some(run => inside(span, run)))) : all;
      const tokens = core.filter(token => own.has(token) || caps.has(token));
      if (!all.length) return { code: "AGENT_QUOTE_ABSENT" };
      if (!tokens.length || tokens.some(token => !own.has(token))) return { code: "AGENT_NAME_MISMATCH", text };
      return { tokens, spans: [located.span!], claims: tokens.flatMap(within) };
    }
    const found = namedIn(w, name, field);
    return found.tokens.length ? found : { code: "AGENT_QUOTE_ABSENT" };
  }
  function nome(w: Work, key: "customer_name" | "professional_name" | "target_professional_name" | "service_name", text: string | undefined) {
    const value = text?.trim();
    if (value && value.length >= 2) { w.fields[key] = value.slice(0, 200); return; }
    const refKey = ({ customer_name: "customer_ref", professional_name: "professional_ref", target_professional_name: "target_professional_ref", service_name: "service_ref" } as const)[key];
    clear(w, [key, refKey]);
  }
  async function customerStep(w: Work) {
    const a = w.a, located = baseOf(w, "cliente");
    if (located && located.base.tipo !== "DITO") { clear(w, CUSTOMER_KEYS, "AGENT_BASE_TYPE"); return; }
    const origin = a.cliente === null && (a.operacao === "appointment.change" || a.operacao === "appointment.cancel") ? baseOf(w, "atendimento") : undefined;
    const quoted = located && !located.code ? located : origin?.text && !origin.code ? origin : undefined;
    // The words of the quote that can name a customer (the salon's professional and service words are not a customer's).
    const personal = quoted?.text ? nameCore(quoted.text).filter(token => !directoryTokens.has(token)) : [];
    // Rule 7 (V18): a customer said only by a pronoun is decided at plan level (the topic).
    if (quoted?.text && !personal.length && words(quoted.text).some(word => PRONOUNS.has(word))) {
      const entry = a.cliente ? binding.resolve(a.cliente, "c") : undefined;
      w.customer = { id: entry?.id, tokens: [], spans: [quoted.span!], pronoun: true, plural: words(quoted.text).some(word => PLURAL_PRONOUNS.has(word)) };
      w.consumed.push(quoted.span!);
      return;
    }
    if (located?.code) { clear(w, CUSTOMER_KEYS, located.code); return; }
    if (!a.cliente) {
      // V7-A: a change/cancel may name its customer only inside the appointment's words; customer_ref only when S is exactly one row.
      const tokens = personal;
      if (!tokens.length) return;
      // V4: these words are the customer's (no one else's proof in this action).
      w.claims.push(...tokens.flatMap(token => literalSpans(src.text, token).filter(span => inside(span, quoted!.span!))));
      const set = await reader.customerSet(tokens.join(" "));
      if (set.rows?.length === 1) {
        const row = set.rows[0];
        w.customer = { id: row.id, name: row.name, tokens, spans: [quoted!.span!], proven: true };
        w.fields.customer_ref = row.id; w.names[row.id] = row.name;
        return;
      }
      code(w, !set.rows || set.rows.length > CARD_MAX ? "AGENT_TOO_MANY" : set.rows.length ? "AGENT_HOMONYM" : "AGENT_NAME_MISMATCH");
      nome(w, "customer_name", tokens.join(" "));
      return;
    }
    const said = ownerWords(w, "cliente");
    const entry = binding.resolve(a.cliente, "c");
    if (!entry) { code(w, binding.entry(a.cliente) ? "AGENT_REF_KIND" : "AGENT_REF_UNKNOWN"); nome(w, "customer_name", said); return; }
    const row = await reader.customer(entry.id);
    if (!row) { code(w, "AGENT_REF_STALE"); nome(w, "customer_name", said); return; }
    const literal = literalOf(w, "cliente", row.name);
    if ("code" in literal) {
      if (literal.code === "AGENT_NAME_MISMATCH") { code(w, literal.code); nome(w, "customer_name", literal.text); } else clear(w, CUSTOMER_KEYS, literal.code);
      return;
    }
    w.consumed.push(...literal.spans); w.claims.push(...literal.claims);
    const text = said ?? spelled(literal.spans), set = await reader.customerSet(literal.tokens.join(" "));
    if (!set.rows || set.rows.length > CARD_MAX) { code(w, "AGENT_TOO_MANY"); nome(w, "customer_name", text); return; }
    if (!set.rows.some(item => item.id === row.id)) { code(w, "AGENT_NAME_MISMATCH"); nome(w, "customer_name", text); return; }
    w.customer = { id: row.id, name: row.name, tokens: literal.tokens, spans: literal.spans, proven: set.rows.length === 1 };
    if (set.rows.length === 1) { w.fields.customer_ref = row.id; w.names[row.id] = row.name; return; }
    // V7: two or more holders of the owner's words: a card on a booking; elsewhere prepare()'s own search (and the locate) decides.
    w.fields.customer_name = text;
    if (BOOKING.has(a.operacao)) card(w, "customer_ref", named(set.rows), "AGENT_HOMONYM"); else code(w, "AGENT_HOMONYM");
  }
  /** V2, V3, V7 and V8's first person for a professional (the action's own, or a change's new one when said). DELEGADO and NAO_DITO wait
   * for the services and the time (deferredProfessional). */
  async function personStep(w: Work, field: "profissional" | "novo_profissional") {
    const a = w.a, located = baseOf(w, field), value = a[field], keys = field === "profissional" ? PROFESSIONAL_KEYS : TARGET_KEYS;
    const nameKey = field === "profissional" ? "professional_name" : "target_professional_name", refKey = field === "profissional" ? "professional_ref" : "target_professional_ref";
    const type = located?.base.tipo ?? "DITO";
    if (type === "DELEGADO" || type === "NAO_DITO") return;
    if (type !== "DITO" && type !== "PRIMEIRA_PESSOA") { clear(w, keys, "AGENT_BASE_TYPE"); return; }
    if (located?.code) { clear(w, keys, located.code); return; }
    const remember = (entity: Entity) => { if (field === "profissional") w.professional = entity; else w.target = entity; };
    if (type === "PRIMEIRA_PESSOA") {
      // Owner rule 5: the first person is the user's own active registration here, or the agenda is asked.
      if (!words(located!.text!).some(word => FIRST_PERSON.has(word))) { clear(w, keys, "AGENT_SELF_UNLINKED"); return; }
      const self = await reader.selfProfessional(), entry = value ? binding.resolve(value, "p") : undefined;
      if (!self || value && entry?.id !== self.id) { clear(w, keys); ask(w, "AGENT_SELF_UNLINKED", refKey); return; }
      w.consumed.push(located!.span!);
      w.fields[refKey] = self.id; w.names[self.id] = self.name;
      remember({ id: self.id, name: self.name, tokens: [], spans: [located!.span!], proven: true });
      return;
    }
    const said = ownerWords(w, field);
    if (!value) { if (said) nome(w, nameKey, said); return; }
    const entry = binding.resolve(value, "p"), row = entry ? professionals.find(item => item.id === entry.id) : undefined;
    if (!entry || !row) { code(w, !entry ? binding.entry(value) ? "AGENT_REF_KIND" : "AGENT_REF_UNKNOWN" : "AGENT_REF_STALE"); nome(w, nameKey, said); return; }
    const literal = literalOf(w, field, row.name);
    if ("code" in literal) {
      if (literal.code === "AGENT_NAME_MISMATCH") { code(w, literal.code); nome(w, nameKey, literal.text); } else clear(w, keys, literal.code);
      return;
    }
    w.consumed.push(...literal.spans); w.claims.push(...literal.claims);
    const set = professionals.filter(item => nameHasTokens(literal.tokens, item.name)), text = said ?? spelled(literal.spans);
    if (!set.some(item => item.id === row.id)) { code(w, "AGENT_NAME_MISMATCH"); nome(w, nameKey, text); return; }
    remember({ id: row.id, name: row.name, tokens: literal.tokens, spans: literal.spans, proven: set.length === 1 });
    if (set.length === 1) { w.fields[refKey] = row.id; w.names[row.id] = row.name; return; }
    w.fields[nameKey] = text;
    if (set.length > CARD_MAX) code(w, "AGENT_TOO_MANY");
    else if (BOOKING.has(a.operacao) && field === "profissional") card(w, "professional_ref", named(set), "AGENT_HOMONYM");
    else code(w, "AGENT_HOMONYM");
  }

  // ================================================================ V7-A: the appointment only through the C4 locate
  async function originStep(w: Work) {
    const a = w.a, located = baseOf(w, "atendimento"), change = a.operacao === "appointment.change";
    const [dateKey, timeKey] = change ? ["source_date", "source_time"] as const : ["date", "time"] as const;
    let expected: AgentApptFact | undefined;
    if (a.atendimento) {
      const entry = binding.resolve(a.atendimento, "a");
      if (!entry) code(w, binding.entry(a.atendimento) ? "AGENT_REF_KIND" : "AGENT_REF_UNKNOWN");
      else {
        const row = await reader.appointment(entry.id);
        if (!row || !["PENDING", "CONFIRMED"].includes(row.status) || row.startAt <= now) code(w, "AGENT_REF_STALE"); else expected = row;
      }
    }
    // The origin facts the owner wrote: the atendimento quote's single day and single open clock reading (never the model's coordinates).
    const fields: SchedulingFields = {};
    if (w.fields.customer_ref) fields.customer_ref = w.fields.customer_ref;
    if (w.fields.professional_ref) fields.professional_ref = w.fields.professional_ref;
    let quote: string | undefined;
    if (located?.code) code(w, located.code);
    if (located?.text && !located.code) {
      quote = located.text; w.consumed.push(located.span!);
      const day = dayOf(src.text, atoms, located.span!, change ? "source_date" : "date", a.operacao, timezone, now), clock = clockOf(src.text, atoms, located.span!, a.operacao, "only", timezone, now);
      if (day && day !== "UNREAD" && day.dates.length === 1) fields[dateKey] = day.dates[0];
      if (clock && clock !== "UNREAD") {
        const open = fields[dateKey] ? await openFor(clock.readings, "LOCATE", fields[dateKey]!, expected ? [expected.professionalId] : []) : clock.readings;
        if (open.length === 1) fields[timeKey] = open[0];
      }
    }
    Object.assign(w.fields, fields);
    if (!MUTATING.has(a.operacao) && !expected) return;
    const past = !!fields[dateKey] && fields[dateKey]! < today;
    const found = fields.customer_ref || fields[dateKey] ? await reader.locate(fields, a.operacao) : [];
    w.origin = { ...(expected ? { expected: expected.id } : {}), ...(quote ? { quote } : {}), located: found };
    if (!expected) { if (found.length === 1) w.appt = await reader.appointment(found[0]); return; }
    w.names[expected.id] = apptLabel(expected);
    if (found.length === 1 && found[0] === expected.id) { w.appt = expected; return; }
    if (!found.length) { code(w, past ? "AGENT_PAST_ORIGIN" : "AGENT_APPT_LOCATE"); return; }
    // The locate chose another appointment (or several): the card of the C4's rows with the model's one, never a pick.
    const ids = found.includes(expected.id) ? found : [found[0], expected.id], rows: AgentApptFact[] = [];
    for (const id of ids.slice(0, CARD_MAX)) { const row = id === expected.id ? expected : await reader.appointment(id); if (row) rows.push(row); }
    card(w, "appointment_ref", rows.map(row => ({ id: row.id, name: apptLabel(row) })), "AGENT_APPT_LOCATE");
  }
  async function openFor(readings: string[], purpose: DaypartPurpose, date: string, staff: readonly string[], options: { duration?: number; other?: string } = {}) {
    if (readings.length < 2) return readings;
    const facts = await reader.dayFacts(date, staff.length ? staff : professionals.map(item => item.id));
    return facts ? openReadings(readings, purpose, facts, options).open : readings;
  }

  // ================================================================ V16 services
  async function servicesStep(w: Work) {
    const a = w.a, list = a.servicos, located = baseOf(w, "servicos");
    if (!list) return;
    if (located && located.base.tipo !== "DITO") { clear(w, SERVICE_KEYS, "AGENT_BASE_TYPE"); return; }
    if (located?.code) { clear(w, SERVICE_KEYS, located.code); return; }
    const booking = BOOKING.has(a.operacao), change = a.operacao === "appointment.change";
    if (booking && list.some(item => item.modo !== "LISTA") || !booking && !change && (list.length > 1 || list[0].modo !== "LISTA")) { clear(w, SERVICE_KEYS, "AGENT_SERVICE_MODE"); return; }
    const quoted = located?.text ? nameCore(located.text) : undefined, said = located?.text ? trimmedName(located.text) : undefined;
    const chosen: Service[] = [];
    for (const item of list) {
      const entry = binding.resolve(item.ref, "s"), row = entry ? services.find(service => service.id === entry.id) : undefined;
      if (!entry || !row) { code(w, !entry ? binding.entry(item.ref) ? "AGENT_REF_KIND" : "AGENT_REF_UNKNOWN" : "AGENT_REF_STALE"); return servicesByName(w, said); }
      const own = nameTokens(withoutArticle(row.name)).filter(token => [...token].length >= AGENT_NAME_TOKEN_MIN);
      const found = quoted ? undefined : namedIn(w, row.name, "servicos"), tokens = quoted ? own.filter(token => quoted.includes(token)) : found!.tokens;
      if (!tokens.length) { code(w, "AGENT_NAME_MISMATCH"); return servicesByName(w, said); }
      chosen.push({ id: row.id, name: row.name, tokens, spans: quoted ? [located!.span!] : found!.spans, mode: item.modo, durationMin: row.durationMin, claims: found?.claims ?? [] });
    }
    // Every name word of the quote is a word of some chosen service (a word left over names something else).
    if (quoted && quoted.some(token => !chosen.some(item => nameTokens(item.name).includes(token)))) { code(w, "AGENT_NAME_MISMATCH"); return servicesByName(w, said); }
    for (const item of chosen) {
      w.consumed.push(...item.spans); w.claims.push(...item.claims);
      const set = services.filter(service => nameHasTokens(item.tokens, service.name)), exact = services.filter(service => serviceNameKey(service.name) === serviceNameKey(item.tokens.join(" ")));
      if (!set.some(service => service.id === item.id)) { code(w, "AGENT_NAME_MISMATCH"); return servicesByName(w, said); }
      // A service named word for word (the C4's serviceNameKey) is that service; otherwise several holders are a card on a booking.
      if (set.length > 1 && !(exact.length === 1 && exact[0].id === item.id)) {
        if (booking && chosen.length === 1 && set.length <= CARD_MAX) { card(w, "service_ref", named(set), "AGENT_HOMONYM"); w.fields.service_name = said ?? item.tokens.join(" "); return; }
        code(w, "AGENT_HOMONYM");
        return servicesByName(w, said);
      }
    }
    for (const item of chosen) w.names[item.id] = item.name;
    if (change) {
      // REMOVER/TROCAR only over the re-read appointment's own services; INCLUIR goes through the C4 alteration path (its combo guard).
      const leaving = chosen.filter(item => item.mode === "REMOVER" || item.mode === "TROCAR");
      if (leaving.length && (!w.appt || leaving.some(item => !w.appt!.serviceIds.includes(item.id)))) { clear(w, SERVICE_KEYS, "AGENT_SERVICE_MODE"); return; }
      w.services = chosen;
      w.fields.service_changes = chosen.map(item => ({ mode: item.mode === "INCLUIR" ? "INCLUDE" as const : item.mode === "LISTA" ? "SET" as const : "REMOVE" as const, service_name: item.name.slice(0, 200) }));
      w.fields.service_changes_ref = chosen.map(item => item.id);
      return;
    }
    // Rules 9 and 11: a combo, a combo beside its part, or parts a registered combo joins are resolved by the C4's own combo path from the
    // owner's words (its cards), never here.
    const joins = chosen.length > 1 && services.some(row => isCombo(row.name) && comboParts(row.name).length === chosen.length &&
      comboParts(row.name).every(part => chosen.some(item => serviceNameKey(item.name) === serviceNameKey(part))));
    if (chosen.some(item => isCombo(item.name)) || comboWithOwnPart(chosen) || joins || said && comboParts(said).length > 1 && chosen.length === 1) {
      code(w, "AGENT_COMBO");
      return servicesByName(w, said ?? stretch(chosen.flatMap(item => item.spans)));
    }
    w.services = chosen;
    w.durationMin = chosen.reduce((sum, item) => sum + item.durationMin, 0);
    if (chosen.length === 1) w.fields.service_ref = chosen[0].id;
    else { w.fields.service_names = chosen.map(item => item.name.slice(0, 200)); w.fields.service_list_ref = chosen.map(item => item.id); }
  }
  /** The owner's words from the first to the last found service word, when they stay inside one clause segment (no boundary between). */
  function stretch(spans: readonly Span[]) {
    if (!spans.length) return undefined;
    const text = src.text.slice(Math.min(...spans.map(span => span[0])), Math.max(...spans.map(span => span[1])));
    return BOUNDARY.test(text) || text.length > 120 ? undefined : text;
  }
  /** NOME for services: the owner's words, for prepare() to resolve (search, multi-service list, combo cards). */
  function servicesByName(w: Work, said: string | undefined) {
    clear(w, SERVICE_KEYS);
    w.services = [];
    if (w.a.operacao !== "appointment.change" && said && said.length >= 2) w.fields.service_name = said.slice(0, 200);
  }

  // ================================================================ time
  async function staffOf(w: Work) {
    if (w.fields.professional_ref) return [w.fields.professional_ref];
    return w.services.length ? (await reader.performers(w.services.map(item => item.id))).map(item => item.id) : professionals.map(item => item.id);
  }
  /** The day of an action whose start quote states none: the accepted `dia`, else the one reading of the days written in its own segment,
   * else the one day said once outside every clause (region c). Never an anchor's or the model's. */
  function fallbackDay(w: Work, operation: string): { dates: string[]; spans: Span[] } | undefined {
    if (w.date) return { dates: [w.date], spans: [] };
    const used = [...w.bases.values()].flatMap(item => item.span ? [item.span] : []);
    const read = (list: Atom[]) => {
      const dates = new Set(list.flatMap(atom => { const day = dayOf(src.text, atoms, [atom.start, atom.end], "date", operation, timezone, now);
        return day && day !== "UNREAD" && day.dates.length === 1 ? day.dates : ["UNREAD"]; }));
      return dates.size === 1 && !dates.has("UNREAD") ? { dates: [...dates], spans: list.map((atom): Span => [atom.start, atom.end]) } : undefined;
    };
    const mine = dayAtoms(w.own!).filter(atom => !atom.negated && !used.some(span => meets(span, [atom.start, atom.end])));
    if (mine.length) return read(mine);
    const shared = atoms.filter(atom => atom.kind === "date" && !atom.negated && !ownSpans().some(own => meets(own, [atom.start, atom.end])) && admits(w, [atom.start, atom.end], true));
    return shared.length ? read(shared) : undefined;
  }
  function dayStep(w: Work) {
    const a = w.a;
    if (!a.dia) return;
    const located = baseOf(w, "dia");
    if (!located || located.code || located.base.tipo !== "DITO") { clear(w, ["date"], located?.code ?? "AGENT_BASE_TYPE"); return; }
    const day = dayOf(src.text, atoms, located.span!, "date", a.operacao, timezone, now);
    if (!day || day === "UNREAD" || day.dates.length !== 1 || day.dates[0] !== a.dia || a.operacao === "appointment.cancel" && w.fields.date && w.fields.date !== a.dia) {
      clear(w, ["date"], "AGENT_TEMPORAL_READING"); return;
    }
    w.consumed.push(located.span!);
    w.date = a.dia; w.fields.date = a.dia;
  }
  async function startStep(w: Work) {
    const a = w.a;
    if (!a.inicio) return;
    const located = baseOf(w, "inicio")!, date = a.inicio.slice(0, 10), time = a.inicio.slice(11, 16), type = located.base.tipo;
    if (located.code) { clear(w, ["date", "time"], located.code); return; }
    if (DERIVED_TYPES.has(type)) return derivedStep(w, located, "inicio");
    if (type === "EXCECAO") {
      // The edge of an excepted appointment: day and clock are candidates, proven only with the block group (V14's exact pieces), which then
      // writes the fields. The day alone stands when the owner's own words read it (the day of the clause or of the end quote), never the
      // model's: a group that cannot be proven keeps no value the validator did not read.
      w.consumed.push(located.span!);
      if (a.operacao !== "schedule.block") { clear(w, ["date", "time"], "AGENT_BASE_TYPE"); return; }
      const end = baseOf(w, "fim"), said = end?.span && !end.code && end.base.tipo === "DITO" ? dayOf(src.text, atoms, end.span, "date", a.operacao, timezone, now) : undefined;
      const read = fallbackDay(w, a.operacao) ?? (said && said !== "UNREAD" ? { dates: said.dates, spans: [] as Span[] } : undefined);
      if (read?.dates.length === 1 && read.dates[0] === date) { w.consumed.push(...read.spans); w.fields.date = date; }
      w.date = date; w.time = time;
      return;
    }
    if (type !== "DITO" && type !== "ANCORA" && type !== "MANTIDO") { clear(w, ["date", "time"], "AGENT_BASE_TYPE"); return; }
    // The day: the start quote's own (DITO), else the fallback; ANCORA and MANTIDO never give a day.
    let days: string[] | undefined, clock: { readings: string[] } | "UNREAD" | undefined;
    if (type === "DITO") {
      const day = dayOf(src.text, atoms, located.span!, "date", a.operacao, timezone, now);
      if (day === "UNREAD") { clear(w, ["date", "time"], "AGENT_TEMPORAL_READING"); return; }
      days = day?.dates;
      clock = clockOf(src.text, atoms, located.span!, a.operacao, a.operacao === "schedule.block" ? "first" : "only", timezone, now);
      w.consumed.push(located.span!);
    }
    if (!days) {
      const fallback = fallbackDay(w, a.operacao);
      if (fallback) { days = fallback.dates; w.consumed.push(...fallback.spans); }
    }
    if (!days) clear(w, ["date"], "AGENT_DAY_MISSING");
    else if (days.length !== 1 || days[0] !== date) clear(w, ["date"], "AGENT_TEMPORAL_READING");
    else { w.date = date; w.fields.date = date; }
    if (type === "MANTIDO") return keptTime(w, located, time);
    if (type === "ANCORA") return anchorTime(w, located, time);
    if (clock === undefined) { clear(w, ["time"], a.operacao === "appointment.change" ? "AGENT_KEEP_UNPROVEN" : "AGENT_TEMPORAL_READING"); return; }
    if (clock === "UNREAD") { clear(w, ["time"], "AGENT_TEMPORAL_READING"); return; }
    const accepted = await pickClock(w, "time", clock.readings, time, a.operacao === "schedule.block" ? "BLOCK_START" : "BOOK", located.text!);
    if (accepted) { w.time = accepted; w.fields.time = accepted; }
  }
  /** V9: the model's clock must be one reading of the owner's words; two readings open in the day's real hours (or unknown hours) are the
   * C4's half-day card; exactly one open is used and said (owner decision 18). */
  async function pickClock(w: Work, field: "time" | "end_time", readings: string[], value: string, purpose: DaypartPurpose, expression: string, other?: string) {
    if (!readings.includes(value)) { clear(w, [field], "AGENT_TEMPORAL_READING"); return; }
    if (readings.length === 1) return value;
    const open = w.date ? await openFor(readings, purpose, w.date, await staffOf(w), { duration: w.durationMin, other }) : readings;
    if (open.length === 1) {
      if (open[0] !== value) { clear(w, [field], "AGENT_TEMPORAL_READING"); return; }
      code(w, "AGENT_DAYPART_ONE"); w.premises.push(`Considerei ${formatClock(value)}: é a única leitura desse horário dentro do expediente.`);
      return value;
    }
    const [early, late] = [...readings].sort();
    w.ambiguities.push({ field, kind: "CLOCK_DAYPART", expression: expression.slice(0, 600), candidates: [early, late] });
    clear(w, [field], "AGENT_DAYPART_ASK");
    if (w.status !== "DROP") w.status = "ASK";
  }
  /** V11 MANTIDO: only a change, with the structural proof of "mantém/mesmo horário"; the value is the re-read appointment's own clock. */
  function keptTime(w: Work, located: Located, value: string) {
    const holder = { customer: w.customer?.tokens.join(" ") || null, others: [] as string[] };
    if (w.a.operacao !== "appointment.change" || !w.appt || !selfReferenceProven(src.text, located.text!, located.span!, w.a.operacao, timezone, now, "time", false, holder)) {
      clear(w, ["time"], "AGENT_KEEP_UNPROVEN"); return;
    }
    const kept = w.appt.startLocal.slice(11, 16);
    if (kept !== value) { clear(w, ["time"], "AGENT_KEEP_UNPROVEN"); return; }
    w.consumed.push(located.span!);
    w.time = kept; w.fields.time = kept;
    w.basis.push({ type: "MANTIDO", appointment: w.appt.id, revision: w.appt.revision, time: kept });
    w.premises.push(`Mantive o horário atual (${formatClock(kept)}).`);
  }
  /** V12 ANCORA: an appointment identified again by the owner's words over the day's complete list (a named customer or an ordinal), or a
   * free interval still free; same day and professional (or the one the quote names); value = end (or start) ± the closed duration reader. */
  async function anchorTime(w: Work, located: Located, value: string) {
    const a = w.a, entry = binding.entry(located.base.ref ?? ""), text = located.text!;
    const fail = (why: AgentValidatorCode) => clear(w, ["time"], why);
    if (!entry || entry.kind !== "a" && entry.kind !== "f") return fail(entry ? "AGENT_REF_KIND" : "AGENT_REF_UNKNOWN");
    if (!w.date) return fail("AGENT_ANCHOR_ROLE");
    const said = words(text), after = said.some(word => AFTER.has(word)), before = said.some(word => BEFORE.has(word));
    const offsets = durationLiterals(text), offset = offsets.length === 1 ? offsets[0].minutes : 0, timed = new Set(offsets.flatMap(item => words(item.text)));
    if (offsets.length > 1 || after && before || before && !offset || entry.kind === "a" && !after && !before || entry.kind === "f" && before) return fail("AGENT_ANCHOR_ROLE");
    const direction = before ? "BEFORE" as const : "AFTER" as const;
    // The professional the anchor belongs to: the one the anchor quote names, else the action's own.
    const core = nameCore(text).filter(token => !timed.has(token) && !ANCHOR_WORDS.has(token));
    const namedPros = professionals.filter(item => core.some(token => nameTokens(item.name).includes(token)));
    const professionalId = namedPros.length === 1 ? namedPros[0].id : w.fields.professional_ref;
    if (!professionalId) return fail("AGENT_ANCHOR_ROLE");
    const subject = professionals.filter(item => item.id === professionalId).map(item => item.name);
    const rest = said.filter(word => !ANCHOR_GLUE_WORDS.has(word) && !timed.has(word));
    const ordinal = readOrdinal(rest.join(" "), subject) ?? null;
    let anchor: Extract<AgentBasis, { type: "ANCORA" }>["anchor"], shown: string;
    if (entry.kind === "a") {
      const row = await reader.appointment(entry.id), list = await reader.dayAppointments(professionalId, w.date);
      if (!row || !["PENDING", "CONFIRMED"].includes(row.status) || row.startLocal.slice(0, 10) !== w.date || row.professionalId !== professionalId || !list) return fail("AGENT_ANCHOR_MISMATCH");
      if (a.operacao === "appointment.change" && (w.appt?.id === row.id || w.origin?.expected === row.id)) return fail("AGENT_ANCHOR_ROLE");
      const customerTokens = core.filter(token => !namedPros.some(item => nameTokens(item.name).includes(token)));
      if (customerTokens.length) {
        // The locate of the anchor (V7-A): the day's rows of that professional whose customer holds the owner's words are exactly this one.
        const holders = list.filter(item => nameHasTokens(customerTokens, item.customerName));
        if (holders.length !== 1 || holders[0].id !== row.id) return fail("AGENT_ANCHOR_MISMATCH");
      } else if (ordinal) {
        const ranked = [...list].sort((x, y) => x.startLocal.localeCompare(y.startLocal) || x.id.localeCompare(y.id));
        const at = ranked[ordinal === "first" ? 0 : ordinal === "last" ? ranked.length - 1 : ranked.length - 2];
        if (!at || at.id !== row.id || ranked.filter(item => item.startLocal === at.startLocal).length > 1) return fail("AGENT_ANCHOR_MISMATCH");
      } else return fail("AGENT_ANCHOR_ROLE");
      anchor = { kind: "a", id: row.id, revision: row.revision, start: row.startLocal, end: row.endLocal };
      shown = label(row.customerName);
    } else {
      const facts = entry.facts as { professionalId: string; start: string; end: string };
      if (facts.professionalId !== professionalId || facts.start.slice(0, 10) !== w.date) return fail("AGENT_ANCHOR_MISMATCH");
      const list = await reader.dayAppointments(professionalId, w.date);
      if (!list || list.some(item => item.startLocal < facts.end && item.endLocal > facts.start)) return fail("AGENT_ANCHOR_MISMATCH");
      if (ordinal) {
        const free = await freeList(professionalId, w.date, list), at = free[ordinal === "first" ? 0 : ordinal === "last" ? free.length - 1 : free.length - 2];
        if (!at || at[0] !== facts.start || at[1] !== facts.end) return fail("AGENT_ANCHOR_MISMATCH");
      }
      anchor = { kind: "f", start: facts.start, end: facts.end };
      shown = "";
    }
    const computed = anchor.kind === "f" ? shift(anchor.start, offset) : direction === "AFTER" ? shift(anchor.end, offset) : shift(anchor.start, -offset);
    if (computed.slice(0, 10) !== w.date || computed.slice(11, 16) !== value) return fail("AGENT_ANCHOR_MISMATCH");
    w.consumed.push(located.span!);
    w.time = value; w.fields.time = value;
    const basis: AgentBasis = { type: "ANCORA", field: "inicio", anchor, professionalId, date: w.date, ordinal, offset, direction, value: computed };
    const range = `${formatClock(anchor.start.slice(11, 16))}–${formatClock(anchor.end.slice(11, 16))}`;
    const premise = anchor.kind === "f" ? `${formatClock(value)}: no horário livre de ${range}.`
      : `${formatClock(value)}: ${offset ? `${durationText(offset)} ${direction === "AFTER" ? "depois" : "antes"}` : "logo depois"} de ${shown} (${range}).`;
    w.basis.push(basis); w.premises.push(premise); w.anchor = { basis, premise };
  }
  /** One professional's free intervals of a day (work minus time off, closures, PENDING/CONFIRMED appointments and the past), in the
   * executor's f# form (an end at midnight is the next day's 00:00). */
  async function freeList(professionalId: string, date: string, list: readonly AgentApptFact[]): Promise<[string, string][]> {
    const facts = await reader.dayFacts(date, [professionalId]), own = facts?.staff.find(item => item.id === professionalId);
    if (!facts || !own) return [];
    const local = (minute: number) => minute >= 1440 ? `${addCalendarDays(date, 1)}T00:00` : `${date}T${hm(minute)}`;
    const taken = list.map(item => ({ start: minuteOf(item.startLocal.slice(11, 16)), end: item.endLocal.slice(0, 10) > date ? 1440 : minuteOf(item.endLocal.slice(11, 16)) }));
    const past = facts.now >= 0 ? [{ start: 0, end: Math.min(1440, facts.now + 1) }] : [];
    return subtractIntervals(own.work, unionIntervals([...own.off, ...facts.closures, ...taken, ...past])).map((span): [string, string] => [local(span.start), local(span.end)]);
  }
  /** V13: the value waits for the referenced action's accepted proposal (agentDerivedCheck); here only the graph is checked. */
  function derivedStep(w: Work, located: Located, field: "inicio" | "fim") {
    const a = w.a, type = located.base.tipo as AgentDerived["type"], key = located.base.ref ?? "";
    const mismatch: AgentValidatorCode = type === "SEQUENCIA" ? "AGENT_SEQUENCE_MISMATCH" : type === "ENTRE_ACOES" ? "AGENT_BETWEEN_MISMATCH" : "AGENT_RELEASE_MISMATCH";
    const keys = field === "inicio" ? ["date", "time"] as const : ["end_time", "end_date"] as const;
    const offsets = durationLiterals(located.text!);
    if (!a.depende_de.includes(key) || type === "LIBERADO_POR" && a.ocupa_horario_de !== key || w.derived && w.derived.type !== type || offsets.length > 1) { clear(w, keys, mismatch); return; }
    w.consumed.push(located.span!);
    clear(w, keys);
    if (w.derived) { if (!w.derived.keys.includes(key)) w.derived.keys.push(key); return; }
    w.derived = { type, keys: [key], inicio: a.inicio, fim: a.fim, offset: offsets[0]?.minutes ?? 0,
      direction: words(located.text!).some(word => BEFORE.has(word)) ? "BEFORE" : "AFTER", professional: w.fields.professional_ref ?? null };
  }
  async function endStep(w: Work) {
    const a = w.a;
    if (a.operacao !== "schedule.block") return;
    if (!a.fim) { if (w.time) code(w, "AGENT_END_MISSING"); return; }
    const located = baseOf(w, "fim")!, type = located.base.tipo, date = a.fim.slice(0, 10), time = a.fim.slice(11, 16), keys = ["end_time", "end_date"] as const;
    if (located.code) { clear(w, keys, located.code); return; }
    if (DERIVED_TYPES.has(type)) return derivedStep(w, located, "fim");
    if (type === "EXCECAO") {
      // A candidate edge too: the block group writes the end only from its validated pieces.
      w.consumed.push(located.span!);
      w.endDate = date; w.endTime = time;
      return;
    }
    if (type === "FIM_EXPEDIENTE") return workdayEnd(w, located, date, time);
    if (type !== "DITO") { clear(w, keys, "AGENT_BASE_TYPE"); return; }
    const start = baseOf(w, "inicio"), shared = !!start?.span && !!located.span && meets(start.span, located.span);
    const day = dayOf(src.text, atoms, located.span!, "end_date", a.operacao, timezone, now), clock = clockOf(src.text, atoms, located.span!, a.operacao, shared ? "last" : "only", timezone, now);
    w.consumed.push(located.span!);
    const endDay = day && day !== "UNREAD" && !shared ? day.dates : w.date ? [w.date] : undefined;
    if (day === "UNREAD" || !endDay || endDay.length !== 1 || endDay[0] !== date) { clear(w, keys, "AGENT_TEMPORAL_READING"); return; }
    if (!clock || clock === "UNREAD") { clear(w, keys, clock ? "AGENT_TEMPORAL_READING" : "AGENT_END_MISSING"); return; }
    const accepted = await pickClock(w, "end_time", clock.readings, time, "BLOCK_END", located.text!, w.time);
    if (!accepted) return;
    w.endDate = date; w.endTime = accepted; w.fields.end_time = accepted;
    if (date !== w.date) w.fields.end_date = date;
  }
  /** V14 FIM_EXPEDIENTE (owner decision 17): the end of the professional's working interval holding the start, re-read. A quote with a clock
   * is no end of the day; outside the hours, two intervals possible, midnight or the criterion off: the end is asked. */
  async function workdayEnd(w: Work, located: Located, date: string, time: string) {
    const professionalId = w.fields.professional_ref, keys = ["end_time", "end_date"] as const;
    if (!criteria.workdayEnd || !professionalId || !w.date || !w.time || date !== w.date || clockOf(src.text, atoms, located.span!, w.a.operacao, "first", timezone, now) !== undefined) { clear(w, keys, "AGENT_WORKDAY_END"); return; }
    const facts = await reader.dayFacts(w.date, [professionalId]), own = facts?.staff.find(item => item.id === professionalId), start = minuteOf(w.time);
    const holding = own?.work.filter(span => span.start <= start && start < span.end) ?? [];
    if (holding.length !== 1 || holding[0].end >= 1440 || hm(holding[0].end) !== time) { clear(w, keys, "AGENT_WORKDAY_END"); return; }
    w.consumed.push(located.span!);
    w.endDate = date; w.endTime = time; w.fields.end_time = time;
    w.basis.push({ type: "FIM_EXPEDIENTE", professionalId, date, start: w.time, end: time });
    w.premises.push(`Até ${formatClock(time)}, fim do expediente de ${label(professionals.find(item => item.id === professionalId)?.name ?? "")} em ${formatDay(date)}.`);
  }

  // ================================================================ V8: delegation and the professional not said
  /** DELEGADO only when the base quote IS the professional argument, in the action's own region (its clause or a later complement that is
   * no other action's clause: V4), opening (after "com"/"pra") with an indefinite pronoun of the closed class (quem, qualquer, alguém). A
   * determiner with a noun ("outra", "uma" + a role) is not one, and a "quem" of another action's clause is never admitted. */
  function delegationMarked(w: Work, located: Located) {
    if (!located.span || located.code) return false;
    const list = words(located.text!);
    while (list.length && ["com", "c", "pra", "para", "por"].includes(list[0])) list.shift();
    return INDEFINITE.has(list[0] ?? "");
  }
  async function eligible(serviceIds: readonly string[], start: string) {
    const out: AgentNamed[] = [];
    for (const row of await reader.performers(serviceIds)) if (await reader.bookable(row.id, serviceIds, start)) out.push(row);
    return out;
  }
  async function deferredProfessional(w: Work, field: "profissional" | "novo_profissional") {
    const a = w.a, located = baseOf(w, field), type = located?.base.tipo;
    if (!located || type !== "DELEGADO" && type !== "NAO_DITO") return;
    const target = field === "novo_profissional", keys = target ? TARGET_KEYS : PROFESSIONAL_KEYS, kind = target ? "target_professional_ref" as const : "professional_ref" as const;
    // A read of free times with nobody named lists every eligible professional's (prepare(), READS_V2): nobody is picked, no card.
    if (a.operacao === "availability.get") { clear(w, keys); return; }
    const serviceIds = target ? w.appt?.serviceIds : w.services.map(item => item.id);
    const start = w.date && w.time ? `${w.date}T${w.time}` : target ? w.appt?.startLocal : undefined;
    clear(w, keys);
    if (!serviceIds?.length || !start) { if (target) ask(w, "AGENT_TARGET_UNSAID", kind); else code(w, "AGENT_PROFESSIONAL_UNSAID"); return; }
    // E: who performs every service and is free at the start, over the whole team (a change's new professional is someone else).
    const set = (await eligible(serviceIds, start)).filter(row => !target || row.id !== w.appt?.professionalId);
    const unmarked = type === "DELEGADO" && !delegationMarked(w, located);
    if (type === "NAO_DITO" || unmarked) {
      const why: AgentValidatorCode = unmarked ? "AGENT_DELEGATION_UNMARKED" : target ? "AGENT_TARGET_UNSAID" : "AGENT_PROFESSIONAL_UNSAID";
      if (!set.length) { code(w, why); ask(w, target ? "AGENT_TARGET_UNSAID" : "AGENT_DELEGATION_NONE", kind); return; }
      card(w, kind, named(set), why); return;
    }
    w.consumed.push(located.span!);
    if (!set.length) { ask(w, "AGENT_DELEGATION_NONE", kind); return; }
    const value = a[field], chosen = value ? binding.resolve(value, "p")?.id : undefined, counts: Record<string, number> = {};
    let pick = set;
    if (set.length > 1) {
      if (!criteria.delegation) { card(w, kind, named(set), "AGENT_DELEGATION_TIE"); return; }
      // Owner decision 15: the least busy day (PENDING/CONFIRMED only, with what the plan's earlier actions do that day); a tie is a card of the tied.
      for (const row of set) counts[row.id] = await reader.activeCount(row.id, start.slice(0, 10)) + planned(w, row.id, start.slice(0, 10));
      const least = Math.min(...Object.values(counts));
      pick = set.filter(row => counts[row.id] === least);
    }
    if (pick.length !== 1 || pick[0].id !== chosen) { card(w, kind, named(pick), "AGENT_DELEGATION_TIE"); return; }
    const row = pick[0];
    w.fields[kind] = row.id; w.names[row.id] = row.name;
    const entity: Entity = { id: row.id, name: row.name, tokens: [], spans: [located.span!], proven: true };
    if (target) w.target = entity; else w.professional = entity;
    w.basis.push({ type: "DELEGADO", field, chosen: row.id, set: set.map(item => item.id), counts, start, services: [...serviceIds], ...target && w.appt ? { exclude: w.appt.professionalId } : {} });
    const what = listText((target ? w.appt?.serviceNames ?? [] : w.services.map(item => item.name)).map(name => label(name)));
    w.premises.push(set.length > 1 ? `Escolhi ${label(row.name)} para ${what}: faz o serviço, está livre às ${formatClock(start.slice(11, 16))} e tem menos atendimentos no dia (${counts[row.id]}).`
      : `Escolhi ${label(row.name)} para ${what}: é quem faz o serviço e está livre às ${formatClock(start.slice(11, 16))}.`);
  }
  /** Owner decision 15's count as the tenant will hold it when `w` runs: +1 for each action of the plan executed before it (execution order)
   * that books or moves an appointment to that professional that day, −1 for each that cancels or moves one away from there. */
  function planned(w: Work, professionalId: string, date: string) {
    let delta = 0;
    const mine = rank.get(w.a.chave) ?? 0;
    for (const other of live()) {
      if (other === w || (rank.get(other.a.chave) ?? 0) >= mine) continue;
      const operation = other.a.operacao, appt = other.appt;
      if (operation === "appointment.create" && other.fields.professional_ref === professionalId && other.fields.date === date) delta++;
      if (operation === "appointment.change" && appt && (other.fields.target_professional_ref ?? appt.professionalId) === professionalId &&
        (other.fields.date ?? appt.startLocal.slice(0, 10)) === date) delta++;
      if ((operation === "appointment.change" || operation === "appointment.cancel") && appt && appt.professionalId === professionalId && appt.startLocal.slice(0, 10) === date) delta--;
    }
    return delta;
  }
  /** V12/V23: a free interval another action of this plan fills, or an anchor appointment another action of this plan moves or cancels, no
   * longer stands at the Confirmar (the plan's own write would hold the group): that anchored clock is asked now instead. */
  function sharedFreeAnchors() {
    const target = (v: Work) => v.origin?.expected ?? (v.origin?.located.length === 1 ? v.origin.located[0] : undefined);
    const slot = (v: Work) => {
      if (v.a.operacao !== "appointment.create" && v.a.operacao !== "appointment.change" || !v.fields.date || !v.fields.time) return undefined;
      const professional = v.a.operacao === "appointment.change" ? v.fields.target_professional_ref ?? v.appt?.professionalId : v.fields.professional_ref;
      const start = `${v.fields.date}T${v.fields.time}`, minutes = v.durationMin ?? (v.appt ? (Date.parse(`${v.appt.endLocal}:00Z`) - Date.parse(`${v.appt.startLocal}:00Z`)) / 60_000 : 0);
      return professional ? { professional, start, end: shift(start, Math.max(1, minutes)) } : undefined;
    };
    for (const w of live()) {
      const held = w.anchor, basis = held?.basis;
      if (!held || basis?.type !== "ANCORA") continue;
      const others = live().filter(other => other !== w), professionalId = basis.professionalId, { start, end } = basis.anchor, id = basis.anchor.kind === "a" ? basis.anchor.id : undefined;
      const lost = id === undefined
        ? others.some(other => { const at = slot(other); return !!at && at.professional === professionalId && at.start < end && at.end > start; })
        : others.some(other => (other.a.operacao === "appointment.change" || other.a.operacao === "appointment.cancel") && target(other) === id);
      if (!lost) continue;
      w.basis = w.basis.filter(item => item !== basis); w.premises = w.premises.filter(text => text !== held.premise); w.anchor = undefined;
      w.time = undefined; clear(w, ["time"], "AGENT_ANCHOR_MISMATCH");
    }
  }

  // ================================================================ V21 reason, V22 recurrence
  function reasonStep(w: Work) {
    if (!w.a.motivo) return;
    const index = w.reason ? src.bounds.findIndex(bound => inside(w.reason!, bound)) : -1;
    if (index < 0) { clear(w, ["reason"], "AGENT_REASON_UNPROVEN"); return; }
    const patch: Record<string, unknown> = { reason: src.text.slice(w.reason![0], w.reason![1]) };
    if (!groundSchedulingReasons(patch, {}, src.owner[index]).accepted.includes("reason")) { clear(w, ["reason"], "AGENT_REASON_UNPROVEN"); return; }
    w.consumed.push(w.reason!);
    w.fields.reason = patch.reason as string;
    if (patch.reason_source) w.fields.reason_source = patch.reason_source as SchedulingFields["reason_source"];
  }
  function recurrenceStep(w: Work) {
    const a = w.a;
    if (!recurrenceOperation(a.operacao)) return;
    const names = [w.customer?.tokens.join(" "), w.professional?.tokens.join(" "), ...w.services.map(item => item.name)];
    const stated = statedRecurrence(src.text.slice(w.own![0], w.own![1]), names);
    const quoted = a.recorrencia ? spansOf(src, a.recorrencia).filter(span => admits(w, span, false)) : [];
    const expression = stated?.expression ?? (quoted.length === 1 ? src.text.slice(quoted[0][0], quoted[0][1]) : undefined);
    if (!expression) return;
    if (stated) w.consumed.push([w.own![0] + stated.start, w.own![0] + stated.end]);
    if (quoted.length === 1) w.consumed.push(quoted[0]);
    w.recurrence = expression.slice(0, 120); code(w, "AGENT_RECURRENCE");
  }

  // ================================================================ V14 exception groups (owner decisions 10 and 16)
  async function exceptionGroups() {
    const groups = new Map<string, Work[]>();
    for (const w of live()) {
      if (w.a.operacao !== "schedule.block" || !w.a.bases.some(base => base.tipo === "EXCECAO")) continue;
      const key = `${w.fields.professional_ref ?? "?"}|${w.a.inicio?.slice(0, 10) ?? "?"}`;
      groups.set(key, [...groups.get(key) ?? [], w]);
    }
    for (const group of groups.values()) {
      group.sort((x, y) => (x.a.inicio ?? "").localeCompare(y.a.inicio ?? ""));
      const professionalId = group[0].fields.professional_ref, date = group[0].a.inicio?.slice(0, 10);
      // The literal interval [s, e): the starts and ends said (DITO) across the group.
      const s = group.flatMap(w => baseOf(w, "inicio")?.base.tipo === "DITO" && w.time && w.date ? [`${w.date}T${w.time}`] : []).sort()[0];
      const e = group.flatMap(w => baseOf(w, "fim")?.base.tipo === "DITO" && w.endTime && w.date ? [`${w.endDate ?? w.date}T${w.endTime}`] : []).sort().at(-1);
      /** The rule-10 card: the whole literal interval as ONE block, so prepare()'s block guard shows the appointments and the real options. */
      const merge = (why: AgentValidatorCode) => {
        const [first, ...rest] = group;
        code(first, why);
        first.basis = first.basis.filter(item => item.type !== "EXCECAO");
        if (s && e) {
          first.date = s.slice(0, 10); first.time = s.slice(11, 16); first.endDate = e.slice(0, 10); first.endTime = e.slice(11, 16);
          first.fields.date = first.date; first.fields.time = first.time; first.fields.end_time = first.endTime;
          if (first.endDate !== first.date) first.fields.end_date = first.endDate; else delete first.fields.end_date;
        } else {
          // No literal interval: the clocks are asked, and the day stays only when the owner's words proved it (never an exception edge's).
          clear(first, ["time", "end_time", "end_date"]);
          first.time = first.endTime = first.endDate = undefined;
          if (!first.fields.date) first.date = undefined;
        }
        for (const w of rest) { code(w, "AGENT_EXCEPTION_MERGED"); w.status = "DROP"; first.consumed.push(...w.consumed); }
      };
      if (!criteria.exception || !professionalId || !date || !s || !e) { merge("AGENT_EXCEPTION_MISMATCH"); continue; }
      const day = await reader.dayAppointments(professionalId, date);
      if (!day) { merge("AGENT_EXCEPTION_MISMATCH"); continue; }
      const busy = day.filter(row => row.startLocal < e && row.endLocal > s);
      // The appointments the exception names: the generic class (all of them) or, per EXCECAO base, the ONE whose customer holds its words.
      const kept = new Set<string>();
      let proven = true;
      for (const w of group) for (const located of w.bases.values()) {
        if (located.base.tipo !== "EXCECAO") continue;
        if (!located.text || located.code) { proven = false; continue; }
        const tokens = nameCore(located.text).filter(token => !EXCEPTION_GLUE.has(token) && !GENERIC_EXCEPTION.has(token));
        if (!tokens.length && words(located.text).some(word => GENERIC_EXCEPTION.has(word))) { for (const row of busy) kept.add(row.id); continue; }
        const holders = busy.filter(row => tokens.length > 0 && nameHasTokens(tokens, row.customerName));
        const ref = located.base.ref ? binding.resolve(located.base.ref, "a")?.id : undefined;
        if (holders.length !== 1 || ref && holders[0].id !== ref) { proven = false; continue; }
        kept.add(holders[0].id);
      }
      if (!proven) { merge("AGENT_EXCEPTION_MISMATCH"); continue; }
      if (busy.some(row => !kept.has(row.id))) { merge("AGENT_EXCEPTION_OTHERS"); continue; }
      // The blocks cover exactly the free pieces left, one block per piece.
      const free = freeIntervals(s, e, busy.map(row => ({ start: row.startLocal, end: row.endLocal })));
      const pieces = group.map((w): [string, string] => [`${w.date}T${w.time}`, `${w.endDate ?? w.date}T${w.endTime}`]);
      if (group.some(w => !w.date || !w.time || !w.endTime) || pieces.length !== free.length || pieces.some((piece, index) => piece[0] !== free[index].start || piece[1] !== free[index].end)) {
        merge("AGENT_EXCEPTION_MISMATCH"); continue;
      }
      const names = listText(busy.map(row => label(row.customerName)));
      const premise = busy.length === 1 ? `Bloqueio só dos horários livres; o horário de ${names} continua marcado.` : `Bloqueio só dos horários livres; os horários de ${names} continuam marcados.`;
      for (const w of group) {
        // Every piece is now proven (its edges are the free interval's): its fields are written from it.
        w.fields.date = w.date!; w.fields.time = w.time!; w.fields.end_time = w.endTime!;
        if (w.endDate && w.endDate !== w.date) w.fields.end_date = w.endDate; else delete w.fields.end_date;
        w.basis.push({ type: "EXCECAO", professionalId, date, start: s, end: e, kept: busy.map(row => row.id), pieces });
        if (busy.length) w.premises.push(premise);
      }
    }
  }

  // ================================================================ plan-level rules
  /** V17 (owner rule 4): cancelling a customer's appointment and booking the same customer again, without occupying another customer's slot. */
  function rule4() {
    const customerOf = (w: Work) => w.a.operacao === "appointment.cancel" ? w.appt?.customerId ?? w.fields.customer_ref : w.fields.customer_ref;
    for (const create of live().filter(w => w.a.operacao === "appointment.create" && w.fields.customer_ref)) {
      const same = live().filter(w => w.a.operacao === "appointment.cancel" && customerOf(w) === create.fields.customer_ref);
      const released = create.a.ocupa_horario_de ? works.find(w => w.a.chave === create.a.ocupa_horario_de) : undefined;
      if (!same.length || released && customerOf(released) !== create.fields.customer_ref) continue;
      for (const w of [create, ...same]) ask(w, "AGENT_RULE4");
    }
  }
  /** V20: one appointment with two mutating actions. */
  function doubleMutation() {
    const target = (w: Work) => w.origin?.expected ?? (w.origin?.located.length === 1 ? w.origin.located[0] : undefined);
    const mutations = live().filter(w => (w.a.operacao === "appointment.change" || w.a.operacao === "appointment.cancel") && target(w));
    for (const w of mutations) if (mutations.some(other => other !== w && target(other) === target(w))) ask(w, "AGENT_DOUBLE_MUTATION");
  }
  function entities(w: Work): Entity[] { return [w.customer, w.professional, w.target, ...w.services].filter((item): item is Entity => !!item); }
  /** V5-E: a negated occurrence, anywhere in the message, of a person or service this action names (its EXCECAO quotes aside) asks. A denied
   * value of the action (a booking's customer, professional or services; a block's professional; a change's new professional or services)
   * leaves first, so no later answer brings it back: prepare() asks it again ("Nunca transforme uma negação em operação afirmativa"). What
   * identifies an existing appointment (a change's or cancellation's customer and professional) stays for the locate, and the action waits. */
  function entityDenied(w: Work) {
    const excepted = [...w.bases.values()].flatMap(item => item.base.tipo === "EXCECAO" && item.span ? [item.span] : []);
    const denied = (entity: Entity) => entity.tokens.some(token => literalSpans(src.text, token).some(span => withinOne(src, span) && !excepted.some(item => meets(item, span)) &&
      entityQuoteDenied(src.text, span[0], span[1], w.a.operacao)));
    const hit = entities(w).filter(denied);
    if (!hit.length) return;
    const booking = BOOKING.has(w.a.operacao), cleared: (keyof SchedulingFields)[] = [];
    const forget = (entity: Entity | undefined) => { if (entity?.id) delete w.names[entity.id]; };
    if (w.customer && hit.includes(w.customer) && booking) { cleared.push(...CUSTOMER_KEYS); forget(w.customer); w.customer = undefined; }
    if (w.professional && hit.includes(w.professional) && (booking || w.a.operacao === "schedule.block")) { cleared.push(...PROFESSIONAL_KEYS); forget(w.professional); w.professional = undefined; }
    if (w.target && hit.includes(w.target)) { cleared.push(...TARGET_KEYS); forget(w.target); w.target = undefined; }
    if (w.services.some(item => hit.includes(item)) && (booking || w.a.operacao === "appointment.change")) {
      cleared.push(...SERVICE_KEYS); for (const item of w.services) forget(item);
      w.services = []; w.durationMin = undefined;
    }
    if (cleared.length) clear(w, cleared);
    ask(w, "AGENT_ENTITY_DENIED", cleared.find(key => key.endsWith("_ref")) ?? null, cleared.length ? AGENT_ENTITY_DENIED_OPEN : undefined);
  }
  /** V5-R: (a) a content word of the action's quote said again later under a negator, in a segment naming nobody else; (b) a later segment
   * opened by a loose negator (a boundary before any temporal atom or name) with no base of the action quoting text after it. */
  function retraction(w: Work) {
    const own = w.own!, mine = new Set(entities(w).flatMap(item => item.tokens));
    const nameIn = (span: Span) => { const text = src.text.slice(span[0], span[1]), caps = capitals(text);
      return words(text).some(word => knownNames.has(word) && !mine.has(word)) || [...caps].some(token => !mine.has(token) && !GLUE.has(token) && !temporalWord(token)); };
    const content = new Set(words(src.text.slice(w.quote![0], w.quote![1])).filter(word => [...word].length >= 4 && !temporalWord(word) && !knownNames.has(word) && !GLUE.has(word)));
    for (const word of content) for (const span of literalSpans(src.text, word)) {
      if (span[0] < own[1] || !withinOne(src, span)) continue;
      if (temporalQuoteDenied(src.text, span[0], span[1], "appointment.cancel") && !nameIn(segmentOf(span))) { ask(w, "AGENT_RETRACTION"); return; }
    }
    const later = [...w.bases.values()].flatMap(item => item.span ? [item.span[0]] : []);
    for (const match of src.text.matchAll(NEGATOR)) {
      const at = match.index!, end = at + match[0].length;
      if (at < own[1] || !/(?:^|[,.;!?()\n])\s*$/u.test(src.text.slice(0, at))) continue;
      const stop = src.text.slice(end).search(BOUNDARY), tail: Span = [end, stop < 0 ? src.text.length : end + stop];
      if (atoms.some(atom => inside([atom.start, atom.end], tail)) || nameIn(tail)) continue;
      if (!later.some(start => start > at)) { ask(w, "AGENT_RETRACTION"); return; }
    }
  }
  /** V15 per action and V15-M per message: every day or clock written (and, per message, every directory name) is used by a field, excluded
   * or negated; otherwise the action asks, or the message gets the backend notice. */
  function coverage(): string[] {
    const notices: string[] = [], used = live().flatMap(w => w.consumed);
    const excepted = works.flatMap(w => [...w.bases.values()].flatMap(item => item.base.tipo === "EXCECAO" && item.span ? [item.span] : []));
    const handled = (span: Span, operation: string) => used.some(item => meets(item, span)) || excepted.some(item => meets(item, span)) ||
      temporalQuoteDenied(src.text, span[0], span[1], operation);
    /** A value the owner corrected in the same sentence ("às 10, não, às 11"): a negator after it, then a value of the same kind this action uses. */
    const corrected = (w: Work, atom: Atom) => [...src.text.matchAll(NEGATOR)].some(match => {
      const at = match.index!;
      if (at < atom.end || /[.;!?\n]/.test(src.text.slice(atom.end, at))) return false;
      const next = atoms.filter(item => item.kind === atom.kind && item.start > at).sort((x, y) => x.start - y.start)[0];
      return !!next && !/[.;!?\n]/.test(src.text.slice(at, next.start)) && w.consumed.some(span => meets(span, [next.start, next.end]));
    });
    for (const atom of atoms) {
      const span: Span = [atom.start, atom.end];
      if (atom.negated) continue;
      const holder = works.find(w => w.own && inside(span, w.own));
      if (holder) {
        if (holder.status !== "DROP" && !handled(span, holder.a.operacao) && !corrected(holder, atom)) ask(holder, "AGENT_COVERAGE", null, agentUncoveredText(src.text.slice(span[0], span[1])));
        continue;
      }
      if (!handled(span, "appointment.create")) notices.push(agentUncoveredText(src.text.slice(span[0], span[1])));
    }
    const directory = [...professionals, ...services].flatMap(row => nameTokens(row.name).filter(token => [...token].length >= AGENT_NAME_TOKEN_MIN && !temporalWord(token) && !GLUE.has(token)));
    const seen = new Set<string>();
    for (const token of new Set(directory)) for (const span of literalSpans(src.text, token)) {
      if (!withinOne(src, span) || ownSpans().some(own => meets(own, span)) || handled(span, "appointment.create")) continue;
      const text = src.text.slice(span[0], span[1]);
      if (!seen.has(foldedLiteral(text))) { seen.add(foldedLiteral(text)); notices.push(agentUncoveredText(text)); }
    }
    if (notices.length) for (const w of works) if (w.status !== "DROP") code(w, "AGENT_UNCOVERED");
    return [...new Set(notices)];
  }
  /** V25: Luna's premises stay as a labelled note only when every day, clock and name they mention is a validated value of the action. */
  function notes(w: Work) {
    const dates = [w.date, w.endDate, w.fields.source_date, w.appt?.startLocal.slice(0, 10)].filter((item): item is string => !!item);
    const clocks = [w.time, w.endTime, w.fields.source_time, w.appt?.startLocal.slice(11, 16), ...w.basis.flatMap(item => item.type === "ANCORA" ? [item.anchor.start.slice(11, 16), item.anchor.end.slice(11, 16)] : [])]
      .filter((item): item is string => !!item);
    const mine = new Set([...entities(w).flatMap(item => [...item.tokens, ...nameTokens(item.name ?? "")]), ...Object.values(w.names).flatMap(name => nameTokens(name))]);
    for (const premise of w.a.premissas) {
      const text = clean(premise, AGENT_PLAN_LIMITS.premise);
      if (!text) continue;
      const facts = quoteTemporalFacts(text, timezone, now);
      const holds = w.status !== "DROP" && !facts.invalid && facts.dates.every(date => dates.includes(date)) && facts.days.every(day => dates.some(date => Number(date.slice(8)) === day)) &&
        facts.weekdays.every(item => dates.some(date => weekdayOfDateKey(date) === item.weekday)) && facts.clocks.every(clock => clocks.some(item => item === clock || twin(item) === clock)) &&
        nameTokens(text).filter(token => knownNames.has(token)).every(token => mine.has(token));
      if (holds) w.note.push(text); else code(w, "AGENT_PREMISE_MISMATCH");
    }
  }
}
/** Words an anchor quote carries around its ordinal ("logo depois do último cliente da X"): dropped before reading the ordinal. */
const ANCHOR_GLUE_WORDS = new Set([...AFTER, ...BEFORE, "logo", "assim", "em", "que", "do", "de", "dos", "no", "na", "nos", "nas"]);
function decodedPlan(plan: AgentPlan): { plan: AgentPlan } | { reasons: string[] } {
  try { return { plan: decodeAgentPlan(plan) }; } catch (error) { return { reasons: error instanceof AgentPlanError ? [...error.reasons] : ["AGENT_SCHEMA"] }; }
}
function graphViolation(plan: AgentPlan): string | undefined {
  try { dependencyGraph(plan.acoes.map(action => ({ key: action.chave, depends_on: action.depende_de }))); } catch { return "CYCLE"; }
  const byKey = new Map(plan.acoes.map(action => [action.chave, action]));
  for (const action of plan.acoes) {
    if (action.ocupa_horario_de === null) continue;
    const target = byKey.get(action.ocupa_horario_de);
    if (action.operacao !== "appointment.create" || !action.depende_de.includes(action.ocupa_horario_de) || !target || !["appointment.cancel", "appointment.change"].includes(target.operacao)) return "RELEASED_SLOT";
  }
  return undefined;
}
/** The same reads are asked by several rules: one answer per validation (the transaction is one snapshot anyway). */
function cachedReader(reader: AgentFactReader): AgentFactReader {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, run: () => Promise<T>) => (memo.get(key) ?? memo.set(key, run()).get(key)!) as Promise<T>;
  return { timezone: reader.timezone, now: reader.now,
    appointment: id => once(`a:${id}`, () => reader.appointment(id)), professionals: () => once("p", () => reader.professionals()), services: () => once("s", () => reader.services()),
    customer: id => once(`c:${id}`, () => reader.customer(id)), customerSet: literal => once(`S:${literal}`, () => reader.customerSet(literal)),
    selfProfessional: () => once("self", () => reader.selfProfessional()), performers: ids => once(`E:${ids.join(",")}`, () => reader.performers(ids)),
    bookable: (id, ids, start) => once(`b:${id}|${ids.join(",")}|${start}`, () => reader.bookable(id, ids, start)),
    activeCount: (id, date) => once(`n:${id}|${date}`, () => reader.activeCount(id, date)), dayFacts: (date, ids) => once(`f:${date}|${ids.join(",")}`, () => reader.dayFacts(date, ids)),
    dayAppointments: (id, date) => once(`d:${id}|${date}`, () => reader.dayAppointments(id, date)), locate: (fields, operation) => reader.locate(fields, operation) };
}

// ---------------------------------------------------------------- V13 after the referenced action is prepared
export type AgentPreparedSlot = { startLocal: string; endLocal: string; professional_ref: string; professional_name: string; customer_name?: string };
/** V13: SEQUENCIA (right after the other action's accepted proposal, ± the owner's duration), ENTRE_ACOES (the free interval between two
 * appointments of the plan, owner rule 8: betweenBookingsGap) and LIBERADO_POR (the slot a cancel/change of the plan frees; `slot` gives its
 * ORIGINAL slot). Recomputed by the apply once the referenced actions are prepared (and again when syncReferences rederives); the model's
 * value must agree, else the field is asked. WAIT: a referenced action is not prepared yet. */
export function agentDerivedCheck(derived: AgentDerived, slot: (key: string) => AgentPreparedSlot | undefined):
  { status: "WAIT" } | { status: "MISMATCH"; code: AgentValidatorCode } | { status: "OK"; fields: SchedulingFields; premise: string; basis: AgentBasis } {
  const slots = derived.keys.map(slot);
  if (!slots.length || slots.some(item => !item)) return { status: "WAIT" };
  const [first, second] = slots as AgentPreparedSlot[], who = (item: AgentPreparedSlot) => item.customer_name ? label(item.customer_name) : "a outra ação";
  const expect = (slots as AgentPreparedSlot[]).map(item => ({ startLocal: item.startLocal, endLocal: item.endLocal }));
  if (derived.type === "ENTRE_ACOES") {
    const gap = second ? betweenBookingsGap([{ ...first }, { ...second }]) : undefined;
    if (!gap || derived.inicio !== `${gap.date}T${gap.time}` || derived.fim !== `${gap.date}T${gap.end_time}` || derived.professional && derived.professional !== gap.professional.ref)
      return { status: "MISMATCH", code: "AGENT_BETWEEN_MISMATCH" };
    return { status: "OK", fields: { date: gap.date, time: gap.time, end_time: gap.end_time, professional_ref: gap.professional.ref },
      premise: `No intervalo livre entre ${who(first)} e ${who(second)}.`, basis: { type: "ENTRE_ACOES", keys: [...derived.keys], expect } };
  }
  if (derived.type === "LIBERADO_POR") {
    if (derived.inicio !== first.startLocal || derived.professional && derived.professional !== first.professional_ref) return { status: "MISMATCH", code: "AGENT_RELEASE_MISMATCH" };
    return { status: "OK", fields: { date: first.startLocal.slice(0, 10), time: first.startLocal.slice(11, 16), professional_ref: first.professional_ref },
      premise: `No horário que ${who(first)} libera.`, basis: { type: "LIBERADO_POR", keys: [...derived.keys], expect } };
  }
  const value = derived.direction === "AFTER" ? shift(first.endLocal, derived.offset) : shift(first.startLocal, -derived.offset);
  if (derived.inicio !== value) return { status: "MISMATCH", code: "AGENT_SEQUENCE_MISMATCH" };
  return { status: "OK", fields: { date: value.slice(0, 10), time: value.slice(11, 16) }, premise: `Logo depois de ${who(first)}.`, basis: { type: "SEQUENCIA", keys: [...derived.keys], expect } };
}

// ---------------------------------------------------------------- V23 before the Confirmar writes
export type AgentBasisVerdict = { ok: true } | { ok: false; code: "AGENT_BASIS_CHANGED"; failed: AgentBasis["type"][] };
type PlanValue = (key: string) => { startLocal: string; endLocal: string } | undefined;
/** V23: every derived basis of one action re-checked against fresh rows (anchor still there and unchanged, the delegated professional still
 * the unique least busy eligible one, the exception interval with exactly the kept appointments, the workday end, the kept clock, the
 * referenced proposals). Any change → AGENT_BASIS_CHANGED: the caller holds the whole group (REVIEW_REQUIRED), zero writes. */
export async function agentBasisStillHolds(reader: AgentFactReader, basis: readonly AgentBasis[], options: { planValue?: PlanValue } = {}): Promise<AgentBasisVerdict> {
  const failed: AgentBasis["type"][] = [];
  for (const item of basis) if (!await holds(reader, item, options.planValue)) failed.push(item.type);
  return failed.length ? { ok: false, code: "AGENT_BASIS_CHANGED", failed } : { ok: true };
}
async function holds(reader: AgentFactReader, item: AgentBasis, planValue?: PlanValue): Promise<boolean> {
  switch (item.type) {
    case "DELEGADO": {
      // The same set the validator computed: a change's new professional is never the appointment's own one.
      const set: string[] = [];
      for (const row of await reader.performers(item.services)) if (row.id !== item.exclude && await reader.bookable(row.id, item.services, item.start)) set.push(row.id);
      if (!set.includes(item.chosen)) return false;
      if (set.length === 1) return true;
      const counts: Record<string, number> = {};
      for (const id of set) counts[id] = await reader.activeCount(id, item.start.slice(0, 10));
      const least = Math.min(...Object.values(counts));
      return set.filter(id => counts[id] === least).length === 1 && counts[item.chosen] === least;
    }
    case "ANCORA": {
      const list = await reader.dayAppointments(item.professionalId, item.date), anchor = item.anchor;
      if (!list) return false;
      if (anchor.kind === "f") return !list.some(row => row.startLocal < anchor.end && row.endLocal > anchor.start);
      const row = await reader.appointment(anchor.id);
      if (!row || !["PENDING", "CONFIRMED"].includes(row.status) || row.revision !== anchor.revision || row.startLocal !== anchor.start || row.endLocal !== anchor.end) return false;
      if (item.ordinal) {
        const ranked = [...list].sort((x, y) => x.startLocal.localeCompare(y.startLocal) || x.id.localeCompare(y.id));
        const at = ranked[item.ordinal === "first" ? 0 : item.ordinal === "last" ? ranked.length - 1 : ranked.length - 2];
        if (at?.id !== row.id) return false;
      }
      return (item.direction === "AFTER" ? shift(row.endLocal, item.offset) : shift(row.startLocal, -item.offset)) === item.value;
    }
    case "EXCECAO": {
      const list = await reader.dayAppointments(item.professionalId, item.date);
      if (!list) return false;
      const busy = list.filter(row => row.startLocal < item.end && row.endLocal > item.start).map(row => row.id).sort();
      return JSON.stringify(busy) === JSON.stringify([...item.kept].sort());
    }
    case "FIM_EXPEDIENTE": {
      const facts = await reader.dayFacts(item.date, [item.professionalId]), own = facts?.staff.find(row => row.id === item.professionalId), start = minuteOf(item.start);
      const holding = own?.work.filter(span => span.start <= start && start < span.end) ?? [];
      return holding.length === 1 && holding[0].end < 1440 && hm(holding[0].end) === item.end;
    }
    case "MANTIDO": {
      const row = await reader.appointment(item.appointment);
      return !!row && ["PENDING", "CONFIRMED"].includes(row.status) && row.revision === item.revision && row.startLocal.slice(11, 16) === item.time;
    }
    default: {
      const expect = item.expect;
      if (!expect || !planValue) return true;
      return item.keys.every((key, index) => { const value = planValue(key); return !!value && !!expect[index] && value.startLocal === expect[index].startLocal && value.endLocal === expect[index].endLocal; });
    }
  }
}
/** V23 (1): the WHOLE group checked before its first write (confirmActionPlanGroup, and before each group of "Confirmar tudo", since an
 * earlier group may have changed a basis). Any failing child → the group stays REVIEW_REQUIRED, nothing written. */
export async function agentGroupBasisPrecheck(reader: AgentFactReader, children: readonly { key: string; basis: readonly AgentBasis[] }[], options: { planValue?: PlanValue } = {}):
  Promise<{ ok: true } | { ok: false; code: "AGENT_BASIS_CHANGED"; failed: { key: string; types: AgentBasis["type"][] }[] }> {
  const failed: { key: string; types: AgentBasis["type"][] }[] = [];
  for (const child of children) {
    const verdict = await agentBasisStillHolds(reader, child.basis, options);
    if (!verdict.ok) failed.push({ key: child.key, types: verdict.failed });
  }
  return failed.length ? { ok: false, code: "AGENT_BASIS_CHANGED", failed } : { ok: true };
}
/** V23 (2): the precondition run INSIDE the confirm's transaction (after lockOperationalResources), on that same tx. */
export const agentBasisPrecondition = (actor: ServiceActor, basis: readonly AgentBasis[], now: () => Date = () => new Date()) => async (tx: Tx) => {
  const verdict = await agentBasisStillHolds(await agentFactReader(tx, actor, now()), basis);
  if (!verdict.ok) throw Error("AGENT_BASIS_CHANGED");
};

// ---------------------------------------------------------------- the tenant reader
const DAY_SCAN = 1000;
/** Domain refusals of an availability probe that mean "not free here", not a failing database. */
const NOT_BOOKABLE = new Set(["PRO_SERVICE_MISMATCH", "RESOURCE_UNAVAILABLE", "SERVICE_INVALID"]);
const APPOINTMENT = { id: true, status: true, startAt: true, endAt: true, timezone: true, version: true, professionalId: true, clientId: true, serviceId: true,
  client: { select: { name: true } }, professional: { select: { user: { select: { name: true } } } }, service: { select: { name: true } },
  serviceItems: { orderBy: { position: "asc" as const }, select: { serviceId: true, serviceName: true } } } as const;
type AppointmentRow = { id: string; status: string; startAt: Date; endAt: Date; timezone: string; version: number; professionalId: string; clientId: string; serviceId: string;
  client: { name: string }; professional: { user: { name: string } }; service: { name: string }; serviceItems: { serviceId: string; serviceName: string }[] };
const appointmentFact = (row: AppointmentRow): AgentApptFact => ({ id: row.id, status: row.status, startLocal: toLocalDateTime(row.startAt, row.timezone),
  endLocal: toLocalDateTime(row.endAt, row.timezone), startAt: row.startAt, professionalId: row.professionalId, professionalName: row.professional.user.name,
  customerId: row.clientId, customerName: row.client.name, serviceIds: row.serviceItems.length ? row.serviceItems.map(item => item.serviceId) : [row.serviceId],
  serviceNames: row.serviceItems.length ? row.serviceItems.map(item => item.serviceName) : [row.service.name], revision: row.version });
/** The AgentFactReader of one tenant transaction (the actor's salon; reads only, in sequence). */
export async function agentFactReader(tx: Tx, actor: ServiceActor, now = new Date()): Promise<AgentFactReader> {
  const timezone = await schedulingTimezone(tx, actor), salonId = actor.salonId;
  const performerWhere = (ids: readonly string[]) => ({ salonId, active: true, AND: ids.map(serviceId => ({ services: { some: { serviceId, service: { salonId, active: true } } } })) });
  return Object.freeze({
    timezone, now,
    async appointment(id: string) { const row = await tx.appointment.findFirst({ where: { id, salonId }, select: APPOINTMENT }); return row ? appointmentFact(row) : undefined; },
    async professionals() {
      const rows = await tx.professional.findMany({ where: { salonId, active: true }, select: { id: true, user: { select: { name: true } } }, orderBy: { id: "asc" }, take: NAME_TOKEN_SCAN + 1 });
      return rows.length > NAME_TOKEN_SCAN ? undefined : rows.map(row => ({ id: row.id, name: row.user.name }));
    },
    async services() {
      const rows = await tx.service.findMany({ where: { salonId, active: true }, select: { id: true, name: true, durationMin: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: NAME_TOKEN_SCAN + 1 });
      return rows.length > NAME_TOKEN_SCAN ? undefined : rows;
    },
    async customer(id: string) { return await tx.clientProfile.findFirst({ where: { id, salonId, mergedIntoId: null }, select: { id: true, name: true } }) ?? undefined; },
    async customerSet(literal: string) { const set = await agentCustomerTokenSet(tx, actor, literal); return { rows: set.rows?.map(row => ({ id: row.id, name: row.name })), total: set.total }; },
    async selfProfessional() { return await schedulingSelfProfessional(tx, actor) ?? undefined; },
    async performers(ids: readonly string[]) {
      const rows = await tx.professional.findMany({ where: performerWhere(ids), select: { id: true, user: { select: { name: true } } }, orderBy: { id: "asc" }, take: NAME_TOKEN_SCAN });
      return rows.map(row => ({ id: row.id, name: row.user.name }));
    },
    async bookable(professionalId: string, ids: readonly string[], startLocal: string) {
      try {
        const found = await getSchedulingAvailability(tx, actor, { service_ref: ids[0], ...(ids.length > 1 ? { service_refs: [...ids] } : {}), professional_ref: professionalId,
          date: startLocal.slice(0, 10), time: startLocal.slice(11, 16) }, now, undefined, undefined, 0);
        return !!found.plan;
      } catch (error) { if (error instanceof Error && NOT_BOOKABLE.has(error.message)) return false; throw error; }
    },
    activeCount: (professionalId: string, date: string) => activeAppointmentCount(tx, actor, professionalId, date, timezone),
    dayFacts: (date: string, ids: readonly string[]) => loadDayFacts(tx, salonId, timezone, date, ids, now),
    async dayAppointments(professionalId: string, date: string) {
      const rows = await tx.appointment.findMany({ where: { salonId, professionalId, status: { in: ["PENDING", "CONFIRMED"] },
        startAt: { gte: startOfDateInTimeZone(date, timezone), lt: endExclusiveOfDateInTimeZone(date, timezone) } }, select: APPOINTMENT, orderBy: [{ startAt: "asc" }, { id: "asc" }], take: DAY_SCAN + 1 });
      return rows.length > DAY_SCAN ? undefined : rows.map(appointmentFact);
    },
    async locate(fields: SchedulingFields, operation: string) {
      try { return (await locateSchedulingAppointments(tx, actor, fields, operation)).map(row => row.appointment_ref); }
      catch (error) { if (error instanceof Error && /^[A-Z][A-Z_]+$/.test(error.message)) return []; throw error; }
    },
  });
}
/** §2.1: every re-read of one validation in ONE tenant transaction, in sequence (pool of one connection). */
export function validateAgentPlanInTenant(actor: ServiceActor, plan: AgentPlan, input: Omit<AgentValidationInput, "reader"> & { now?: Date }) {
  return withTenant(actor, async tx => validateAgentPlan(plan, { ...input, reader: await agentFactReader(tx, actor, input.now ?? new Date()) }));
}
