import { withTenant, type Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import type { SchedulingFields } from "./scheduling-contract";
import type { PendingTemporalAmbiguity } from "./scheduling-temporal-ambiguity";
import { matchesSchedulingPeriod } from "./scheduling-temporal";
import { clauseBounds, entityQuoteDenied, governingNegators, quoteTemporalFacts, temporalAtomSpans, temporalQuoteDenied } from "./scheduling-temporal-source";
import { UNSPECIFIED_DAYPART_ASKED_HOURS, dayDirection, resolveClockComponent, resolveDayComponent, temporalQuoteFacts, temporalVocabulary, verifyClockComponent,
  verifyDayComponent } from "./scheduling-temporal-reference";
import { weekScopes, type ClockComponent, type DayComponent } from "../../packages/salon-secretary/src/temporal-components";
import { betweenBookingsGap, readOrdinal, selfReferenceProven, singlesOut, statedClockComponent, statedDayComponent } from "./secretary-same-as";
import { loadDayFacts, openReadings, type DayFacts, type DaypartPurpose } from "./scheduling-daypart-facts";
import { freeIntervals } from "./secretary-block-guard";
import { comboWithOwnPart, isCombo } from "./secretary-combo-guard";
import { comboParts } from "./secretary-multi-service";
import { groundSchedulingReasons } from "./scheduling-literal-source";
import { recurrenceOperation, statedRecurrence } from "./secretary-recurrence";
import { HONORIFICS, SUGGESTION_THRESHOLD, foldName, nameTokens, tokenSimilarity, withoutArticle } from "./name-search";
import { NAME_TOKEN_SCAN, nameHasTokens } from "./secretary-name-tokens";
import { getSchedulingAvailability, schedulingSelfProfessional, schedulingTimezone, serviceNameKey } from "./scheduling-catalog";
import { locateSchedulingAppointments } from "./scheduling-mutations";
import { AGENT_GLUE_WORDS, activeAppointmentCount, agentCustomerTokenSet } from "./secretary-agent-lookups";
import { subtractIntervals, unionIntervals } from "./intervals";
import { addCalendarDays, dateKeyInTimeZone, endExclusiveOfDateInTimeZone, startOfDateInTimeZone, toLocalDateTime, weekdayOfDateKey } from "./time";
import { formatClock, formatDay, formatLocal } from "./secretary-datetime-format";
import { durationLiterals, durationText } from "./scheduling-duration-literal";
import { foldedLiteral, literalProofSpans, literalSpans } from "../../packages/salon-secretary/src/literal-match";
import { dependencyGraph } from "../../packages/salon-secretary/src/dependency-graph";
import { AGENT_NAME_TOKEN_MIN, agentMessage, agentMicroEnabled, sanitizeAgentName, type AgentBinding } from "../../packages/salon-secretary/src/agent-context";
import { AGENT_BASE_REQUIRED_FIELDS, AGENT_MUTATING_OPERATIONS, AGENT_PLAN_LIMITS, AgentPlanError, decodeAgentPlan, type AgentBaseField, type AgentBaseType, type AgentPlan, type AgentPlanAction,
  type AgentPlanBase, type AgentPlanDecodeOptions, type AgentPlanOperation, type AgentPlanResult, type AgentQuestionField, type AgentServiceMode } from "../../packages/salon-secretary/src/agent-plan";

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
  "AGENT_PREMISE_MISMATCH", "AGENT_FIELD_QUESTION", "AGENT_BASIS_CHANGED", "AGENT_PROFESSIONAL_DERIVED", "AGENT_CUSTOMER_UNPICKED", "AGENT_PATCH_OPERATION", "AGENT_PATCH_DONE",
  "AGENT_PATCH_BASIS", "AGENT_PATCH_UNPROVEN", "AGENT_RELEASED_ROLE", "AGENT_NAME_ASSUMED", "AGENT_ORIGIN_INHERITED", "AGENT_PATCH_TARGET"] as const;
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
  AGENT_PATCH_OPERATION: "Esse pedido já está no plano com outra operação. Diga de novo o que devo fazer nele.",
  AGENT_REF_STALE: "O agendamento deste pedido mudou ou não está mais ativo. Qual agendamento devo usar?",
  AGENT_NEGATED: "Parece que você voltou atrás neste pedido. Devo seguir com ele?",
  AGENT_RELEASE_MISMATCH: "O horário que vai vagar é de um profissional que não confere com a sua mensagem. Com quem e em que horário devo marcar?",
  AGENT_PATCH_UNPROVEN: "Não encontrei na sua mensagem o valor que mudou neste pedido. Pode repetir o dia, o horário ou o agendamento que devo usar?",
  AGENT_RELEASED_ROLE: "Não consegui usar o horário que outro pedido libera para este. Para qual dia e horário devo passar?",
  AGENT_PATCH_TARGET: "Outro pedido deste plano está esperando a sua resposta. Esta mudança é mesmo para este pedido, que já estava pronto?",
});
/** A change whose services the owner wrote but the model's refs do not prove: asked, never dropped in silence (V15's rule for services). */
export const AGENT_SERVICE_CHANGE_QUESTION = "Não consegui confirmar quais serviços mudam neste agendamento. Quais serviços devo trocar, incluir ou tirar?";
/** Round 2, F0: a change's new value the validator could not prove, which an empty field would turn into the appointment's current one
 * (prepare() keeps the origin's): asked by the backend, field by field. */
export const AGENT_ORIGIN_QUESTIONS: Readonly<Record<"date" | "time" | "target_professional_ref" | "service_changes", string>> = Object.freeze({
  date: "Não consegui confirmar o novo dia deste agendamento. Para qual dia devo passar?",
  time: "Não consegui confirmar o novo horário deste agendamento. Para qual horário devo passar?",
  target_professional_ref: "Não consegui confirmar com qual profissional este agendamento deve ficar. Com quem devo marcar?",
  service_changes: AGENT_SERVICE_CHANGE_QUESTION,
});
/** A6 (owner decision 14): the customer a booking took from the owner's own words, said back in the owner's spelling. */
export const agentUnpickedPremise = (name: string) => `Considerei «${name}» como cliente, pelo nome escrito no pedido.`;
/** Owner decision 14 (people): the one registered person kept on a low-risk action although the owner wrote beside the name a word no
 * registered name holds; said back with the registered name, in A6's style (the customer's text is A6's own). */
export const agentPersonPremise = (name: string, role: "cliente" | "profissional") => `Considerei «${name}» como ${role}, pelo nome escrito no pedido.`;
/** V5-E when the denied person or service was a value of the action: that value left, and prepare()'s own question for it follows. */
export const AGENT_ENTITY_DENIED_OPEN = "Sua mensagem também nega alguém ou algo deste pedido, então deixei esse dado em aberto.";
const DROP_NOTICES: Readonly<Partial<Record<AgentValidatorCode, string>>> = {
  AGENT_NEGATED: "Deixei de fora um pedido que aparece negado na sua mensagem.",
  AGENT_QUOTE_ABSENT: "Deixei de fora um pedido que não encontrei na sua mensagem.",
  AGENT_PATCH_DONE: "Um pedido desta conversa já foi feito; não fiz de novo.",
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
 * of a change was picked among everyone but the appointment's own professional (`exclude`), and is re-checked the same way. `sole` (owner
 * decision 14, A2): a professional the owner did not name, taken only because the salon's data leave exactly one who performs the services
 * and is free then; it holds only while that is still true (never a pick among several). */
export type AgentBasis =
  | { type: "DELEGADO"; field: "profissional" | "novo_profissional"; chosen: string; set: string[]; counts: Record<string, number>; start: string; services: string[]; exclude?: string;
      sole?: true }
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
  /** Phase 2 (A7): this action has the key of an action of the open plan (`open`). `fields` are then the open action's validated values with
   * this message's changes; READY applies them, ASK holds the open action with the question (never confirmable meanwhile), DROP leaves the
   * open action as it was (AGENT_PATCH_DONE: an action already confirmed is never done again). Absent on a new action. */
  patch?: true;
  /** Round 2, F0 (review C2): a change's new day or clock the owner wrote that no field carries (AGENT_ORIGIN_INHERITED): prepare() keeps it
   * asked (its own temporal question, the draft's temporal_missing) through any later preparation of the action (a card click, a continuation),
   * so the appointment's own value never fills it. Absent when there is none. */
  temporalMissing?: ("date" | "time")[];
};
/** Phase 2 (A7): one action of the open agent plan this message continues, as the app holds it (ids, never refs): its validated fields and
 * registered names, the appointment it changes or cancels, its customer, services and duration, its derived bases (V23) and the card it waits
 * on (ids in the card's order). DONE: already confirmed. */
export type AgentOpenAction = { key: string; operation: AgentPlanOperation; status: "OPEN" | "DONE"; fields: SchedulingFields; names: Record<string, string>; appointment?: string;
  customer?: string; serviceIds?: string[]; durationMin?: number; basis: AgentBasis[]; card?: { kind: AgentCardKind; items: string[] };
  /** Micro P0c (flag SALON_SECRETARY_AGENT_MICRO; absent without it): the action waits on the owner (a field, a card or a review), i.e. it asked. */
  asked?: boolean };
export type AgentOpenPlan = { actions: readonly AgentOpenAction[] };
export type AgentValidation =
  | { ok: false; code: "AGENT_SCHEMA" | "AGENT_DAG"; reasons: string[] }
  | { ok: true; result: AgentPlanResult; actions: AgentActionOutcome[]; notices: string[]; question: { field: "operacao"; text: string } | null; reply: string | null;
      codes: AgentValidatorCode[] };
/** `open` (Phase 2): the open agent plan this message continues; required whenever the message context has one (agentMessage().open). */
export type AgentValidationInput = { owner: readonly string[]; binding: AgentBinding; reader: AgentFactReader; criteria?: AgentValidatorCriteria; open?: AgentOpenPlan };

// ---------------------------------------------------------------- closed classes and small helpers
type Span = readonly [number, number];
/** One word of the owner's text: its offsets and its folded form. */
type WordAt = { readonly start: number; readonly end: number; readonly word: string };
const meets =(a: Span, b: Span) => a[0] < b[1] && b[0] < a[1];
const inside = (s: Span, r: Span) => s[0] >= r[0] && s[1] <= r[1];
const words = (text: string) => foldedLiteral(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Closed grammatical classes (folded): glue that never names anyone (the executor's own list, AGENT_GLUE_WORDS), personal/possessive pronouns,
 * indefinite pronouns, first person. */
const GLUE = AGENT_GLUE_WORDS;
const PRONOUNS = new Set(["ela", "ele", "elas", "eles", "dela", "dele", "delas", "deles", "nela", "nele", "nelas", "neles"]);
const PLURAL_PRONOUNS = new Set(["elas", "eles", "delas", "deles", "nelas", "neles"]);
const INDEFINITE = new Set(["quem", "qualquer", "alguem"]);
const FIRST_PERSON = new Set(["eu", "mim", "comigo", "meu", "minha", "meus", "minhas"]);
/** The head nouns of an agenda row ("o horário da X", "o atendimento dela"): never part of a name. */
const APPT_WORDS = new Set(["horario", "horarios", "atendimento", "atendimentos", "agendamento", "agendamentos", "cliente", "clientes", "marcacao", "marcacoes", "reserva", "vez"]);
/** Micro P2: the low-risk operations (owner decision 14) a shared or antecedent value may reach. */
const SHARED_OPERATIONS = new Set<string>(["appointment.create", "appointment.change", "availability.get"]);
/** Words that make a region speak of another value than a shared one (the D4 rule): negators and alterity words. */
const NOT_SHARED = new Set(["nao", "nem", "nunca", "sem", "menos", "exceto", "outro", "outra", "outros", "outras", "diferente", "diferentes"]);
/** A2: the alterity words (closed class) by which a change asks another professional than the appointment's. */
const ALTERITY = new Set(["outro", "outra", "outros", "outras", "diferente", "diferentes"]);
/** V14: the generic exception (closed class): every appointment of the interval is kept. */
const GENERIC_EXCEPTION = new Set(["cliente", "clientes", "agendamento", "agendamentos", "atendimento", "atendimentos", "marcado", "marcados", "marcada", "marcadas",
  "marcacao", "marcacoes", "vazio", "vazios", "livre", "livres", "ocupado", "ocupados"]);
const EXCEPTION_GLUE = new Set(["menos", "exceto", "fora", "tirando", "salvo", "sem", "nao", "somente", "apenas", "hora", "horas"]);
/** V12: the direction words of an anchor (closed classes), and every other word an anchor quote may hold besides names and a duration. */
const AFTER = new Set(["depois", "apos", "seguida", "terminar", "termina", "terminou", "acabar", "acaba", "acabou"]);
const BEFORE = new Set(["antes"]);
const ORDINAL_WORDS = new Set(["primeiro", "primeira", "ultimo", "ultima", "penultimo", "penultima"]);
const ANCHOR_WORDS = new Set([...AFTER, ...BEFORE, ...ORDINAL_WORDS, ...APPT_WORDS, "logo", "assim", "em", "que", "min", "minuto", "minutos", "hora", "horas", "meia", "livre", "livres"]);
/** Fixer: every word of the closed classes above (anchors, ordinals, negators and alterity, exceptions): never a name word in lowercase text. */
const CLOSED_WORDS = new Set<string>([...ANCHOR_WORDS, ...NOT_SHARED, ...EXCEPTION_GLUE, ...GENERIC_EXCEPTION]);
const NEGATOR = /(?<![\p{L}\p{N}])(?:n[aã]o|nunca|jamais|nem)(?![\p{L}\p{N}])/giu;
const BOUNDARY = /[,.;!?()\n]/;
/** S1c: the exclusion leads (closed class: "menos", "exceto", "salvo", "tirando", "fora", "sem ser"; "pelo/ao menos" excludes nothing) with
 * only glue up to a date atom: the owner excluded that day, it is never a day to read. */
const EXCLUSION_LEAD = /(?<![\p{L}\p{N}])(?<!(?:pelo|ao)\s+)(?:menos|exceto|salvo|tirando|fora|sem\s+ser)(?:\s+(?:o|a|os|as|de|do|da|dos|das|em|no|na|nos|nas|pra|pro|para|dia))*\s+$/iu;
const excludedDay = (text: string, atom: { kind: string; start: number }) => atom.kind === "date" && EXCLUSION_LEAD.test(text.slice(Math.max(0, atom.start - 48), atom.start));
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
/** A3: the connectors of a list of services (closed class) and the articles that may follow one. */
const LIST_JOINERS = new Set([",", "+", "e", "com", "mais"]), LIST_ARTICLES = new Set(["o", "a", "os", "as", "um", "uma"]);
/** A3: `token` is an item coordinated with a chosen service's word in the owner's quote: "X e Y", "X, Y", "X + Y", "X com Y", "X mais Y" (an
 * article may follow the connector), on either side. */
function coordinated(text: string, token: string, chosen: ReadonlySet<string>) {
  const list = [...foldedLiteral(text).matchAll(/[\p{L}\p{N}]+|[,+]/gu)].map(match => match[0]);
  const beside = (at: number, step: 1 | -1) => {
    let j = at + step;
    if (step === -1) { if (LIST_ARTICLES.has(list[j] ?? "")) j--; if (!LIST_JOINERS.has(list[j] ?? "")) return false; j--; }
    else { if (!LIST_JOINERS.has(list[j] ?? "")) return false; j++; if (LIST_ARTICLES.has(list[j] ?? "") && !chosen.has(list[j])) j++; }
    return chosen.has(list[j] ?? "");
  };
  return list.some((word, at) => word === token && (beside(at, -1) || beside(at, 1)));
}
/** A7: a typed choice on a card (closed class): ordinal words, a number, an ordinal number ("2ª"), with only an article and the card's own
 * nouns around it ("a segunda", "opção 2", "o 1º"). The position (1-based), or undefined. */
const ORDINALS: Readonly<Record<string, number>> = { primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5,
  sexto: 6, sexta: 6 };
const CHOICE_WORDS = new Set(["a", "o", "opcao", "numero", "n", "item", "alternativa", "linha"]);
const choiceWords = (text: string) => foldedLiteral(text).split(/[^\p{L}\p{N}ºª]+/u).filter(Boolean).filter(word => !CHOICE_WORDS.has(word));
function ordinalOf(text: string): number | undefined {
  const list = choiceWords(text);
  if (list.length !== 1) return undefined;
  const number = /^(\d{1,2})[ºªoa]?$/u.exec(list[0]);
  const value = number ? Number(number[1]) : ORDINALS[list[0]];
  return value && value >= 1 ? value : undefined;
}
/** A typed ordinal that also names a weekday (closed class: "segunda", "quarta", "quinta", "sexta", "2ª"-"6ª"; the C4's `bare` weekday, whose
 * choiceAnswer asks it): on a card of appointments it names a day as much as a position. */
const weekdayOrdinal = (text: string) => { const list = choiceWords(text); return list.length === 1 && /^(?:segunda|quarta|quinta|sexta|[2-6][ªa])$/u.test(list[0]); };
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
/** The words the reading of an atom takes around it (dayOf, clockOf): a day's scope before ("essa", "próxima") and after ("que vem"); a
 * clock's lead before ("às", "pras", "das") and its daypart after ("da tarde"). */
const DAY_SCOPE = /(?:^|[^\p{L}\p{N}])((?:[nd]?ess[ae]|[nd]?est[ae]|pr[oó]xim[oa])\s+)$/iu, DAY_NEXT = /^\s+que\s+vem(?![\p{L}\p{N}])/iu;
/** Review C4: the prepositions that make an hour a time of the day (closed class), right before it. */
const TIME_LEAD = /(?:^|[^\p{L}\p{N}])(?:[àa]s?|pelas|umas|pras?|para|pros?|das|las|at[ée])\s+$/iu;
const CLOCK_LEAD = /(?:^|[^\p{L}\p{N}])((?:l[aá]\s+)?(?:[àa]s|pelas|umas|pras|pra|das|las)\s+)$/iu, CLOCK_DAYPART = /^\s+(?:da|de|[àa])\s+(?:manh[ãa]|tarde|noite)(?![\p{L}\p{N}])/iu;
/** An atom with the words its reading takes (Round 2, F0: what the owner wrote beside them is read apart). */
function widened(text: string, atom: Atom): Span {
  const before = (atom.kind === "date" ? DAY_SCOPE : CLOCK_LEAD).exec(text.slice(0, atom.start)), after = (atom.kind === "date" ? DAY_NEXT : CLOCK_DAYPART).exec(text.slice(atom.end));
  return [atom.start - (before?.[1].length ?? 0), atom.end + (after?.[0].length ?? 0)];
}
const spanMinutes = (start: string, end: string) => (Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`)) / 60_000;

/** The day(s) an owner quote [span] of `text` states: the C4's own day grammar on the message's date atoms that meet the quote, widened in
 * the message to their scope words ("essa", "próxima", "que vem"), so a clipped quote never proves a day the owner did not say. undefined:
 * no day in it; "UNREAD": a day the grammar does not read (effect NOME). `atoms`: the date atoms read (A1: one atom, one date). */
function dayOf(text: string, all: readonly Atom[], span: Span, role: "date" | "source_date" | "end_date", operation: string, timezone: string, now: Date):
  { dates: string[]; atoms: Span[] } | "UNREAD" | undefined {
  const atoms = all.filter(atom => atom.kind === "date" && meets([atom.start, atom.end], span));
  if (!atoms.length) return undefined;
  let from = Math.min(...atoms.map(atom => atom.start)), to = Math.max(...atoms.map(atom => atom.end));
  const scope = DAY_SCOPE.exec(text.slice(0, from));
  if (scope) from -= scope[1].length;
  const next = DAY_NEXT.exec(text.slice(to));
  if (next) to += next[0].length;
  const today = dateKeyInTimeZone(now, timezone), direction = dayDirection(role, operation), components = dayComponents(text.slice(from, to), today, operation, role);
  // Every reading the grammar accepts ("sexta" verifies as the nearest and as this week's: one date; "sexta que vem" is a choice of two).
  const dates = new Set<string>();
  for (const component of components) {
    const resolved = resolveDayComponent(component, today, direction);
    if (resolved.status === "REJECTED") return "UNREAD";
    for (const date of resolved.status === "OK" ? [resolved.date] : resolved.candidates) dates.add(date);
  }
  return dates.size ? { dates: [...dates].sort(), atoms: atoms.map((atom): Span => [atom.start, atom.end]) } : "UNREAD";
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
 * day unless a daypart written in the quote settles it. `pick`: an interval's first or last clock; "only" refuses two clocks. `atom`: the clock
 * atom read (A1: one clock atom proves one clock role). */
function clockOf(text: string, all: readonly Atom[], span: Span, operation: string, pick: "first" | "last" | "only", timezone: string, now: Date):
  { readings: string[]; atom: Span } | "UNREAD" | undefined {
  const atoms = all.filter(atom => atom.kind === "clock" && meets([atom.start, atom.end], span)).sort((a, b) => a.start - b.start);
  if (!atoms.length) return undefined;
  if (pick === "only" && atoms.length > 1) return "UNREAD";
  const atom = pick === "last" ? atoms.at(-1)! : atoms[0], read: Span = [atom.start, atom.end];
  let from = atom.start, to = atom.end;
  const lead = CLOCK_LEAD.exec(text.slice(0, from));
  if (lead && !/^(?:[àa]s|pelas|umas|pras|pra|das|las)\s/iu.test(text.slice(from, to))) from -= lead[1].length;
  const part = CLOCK_DAYPART.exec(text.slice(to));
  if (part) to += part[0].length;
  const piece = text.slice(from, to), component = statedClockComponent(piece, operation) ?? atomClock(piece, operation);
  if (!component) return "UNREAD";
  const resolved = resolveClockComponent(component);
  if (resolved.status !== "OK") return "UNREAD";
  if (component.daypart !== "UNSPECIFIED") return { readings: [resolved.time], atom: read };
  const [low, high] = UNSPECIFIED_DAYPART_ASKED_HOURS, period = quoteTemporalFacts(text.slice(Math.min(span[0], from), Math.max(span[1], to)), timezone, now).period;
  const readings = component.hour >= low && component.hour <= high ? [resolved.time, twin(resolved.time)].sort() : [resolved.time];
  const settled = period ? readings.filter(time => matchesSchedulingPeriod(time, period)) : readings;
  return { readings: settled.length ? settled : readings, atom: read };
}
/** A5 (parity with the C4): a clock atom the C4's own atom grammar marked that statedClockComponent does not take as said (a unit suffix or
 * "HH:MM" with no lead) is read by the C4's own verifier: its one written hour, the minute the proof accepts (exactly one) and its daypart.
 * Never a day, a count, two hours or two dayparts; a value the verifier rejects is no reading. */
function atomClock(piece: string, operation: string): ClockComponent | undefined {
  const facts = temporalQuoteFacts(piece), hours = facts.clockSeq.filter(token => token.part !== "minute");
  if (facts.relative.length || facts.weekdays.length || facts.months.length || facts.dateNums.length || facts.countNums.length || facts.dayparts.length > 1 || hours.length !== 1) return;
  const daypart = (facts.dayparts[0] ?? "UNSPECIFIED") as ClockComponent["daypart"];
  const found = [...new Set([0, ...facts.clockSeq.filter(token => token !== hours[0]).map(token => token.n)])].map(minute => ({ hour: hours[0].n, minute, daypart }))
    .filter(value => verifyClockComponent(piece, value, { role: "time", operation }).status !== "REJECTED");
  return found.length === 1 ? found[0] : undefined;
}

// ---------------------------------------------------------------- per action state
/** `inherited` (A7): a professional base the backend re-derives for a patch (the open action's delegated or derived professional whose time or
 * services changed); it carries no quote of this message. */
type Located = { base: AgentPlanBase; span?: Span; text?: string; code?: AgentValidatorCode; inherited?: true;
  /** Micro P2 (flag SALON_SECRETARY_AGENT_MICRO): admitted as an antecedent customer or as a complement V0 shared (each shown as a premise). */
  via?: "antecedent" | "shared" };
/** `inherited` (A7): the open action's validated entity kept by a patch (its tokens: the registered name's, for V5-E). */
type Entity = { id?: string; name?: string; tokens: string[]; spans: Span[]; pronoun?: boolean; plural?: boolean; proven?: boolean; inherited?: true };
type Service = { id: string; name: string; tokens: string[]; spans: Span[]; mode: AgentServiceMode; durationMin: number; claims: Span[]; inherited?: true };
/** A1: one temporal atom of the owner's words read for one role of an action (the appointment's origin, the start, a block's end, a day). */
type Read = { role: "origin" | "start" | "end" | "day"; kind: "date" | "clock"; atom: Span; value: string };
/** `claims`: the owner's name words (whole-token spans) that already proved a person or service of this action (V4: one span proves one role).
 * `anchor`: a free-interval anchor's basis and premise, withdrawn when another action of the plan fills that interval. `reads`: the atoms
 * each temporal role read (A1). `clockPremises`: the start's half-day premise as shown and, once an end merged into it, the start's own (A8).
 * `open`: the open action this one patches (A7);
 * `held`: a patch the validator holds whole (negated, another operation, a stale appointment): its fields stay the open action's. */
type Work = {
  a: AgentPlanAction; quote?: Span; own?: Span;
  status: "READY" | "ASK" | "DROP"; question?: AgentQuestion; notice?: string; card?: AgentCard; asked: AgentQuestionField | null;
  fields: SchedulingFields; cleared: Set<string>; ambiguities: PendingTemporalAmbiguity[]; origin?: AgentOrigin; derived?: AgentDerived; recurrence?: string;
  basis: AgentBasis[]; premises: string[]; note: string[]; codes: AgentValidatorCode[]; names: Record<string, string>;
  bases: Map<AgentBaseField, Located>; consumed: Span[]; claims: Span[]; reason?: Span;
  customer?: Entity; professional?: Entity; target?: Entity; services: Service[];
  appt?: AgentApptFact; date?: string; time?: string; endDate?: string; endTime?: string; durationMin?: number;
  anchor?: { basis: AgentBasis; premise: string };
  reads: Read[]; clockPremises: { start?: string; unmerged?: string }; open?: AgentOpenAction; held?: true;
  /** A6: the premise of a customer taken from the owner's words (withdrawn with that customer). */
  customerPremise?: string;
  /** Owner decision 14 (people): a person kept past an unknown word the owner wrote beside the name (`text`: the owner's words of that run,
   * NOME if it leaves), with its premise; withdrawn with that person, or with the owner's words back on a high-risk action (settle). */
  assumed?: { field: AssumedField; text: string; premise: string }[];
  /** Round 2, F0: the change's new day or clock asked instead of inherited (AgentActionOutcome.temporalMissing). */
  missing?: ("date" | "time")[];
};
type AssumedField = "cliente" | "profissional" | "novo_profissional";
const MUTATING = new Set<string>(AGENT_MUTATING_OPERATIONS);
const BOOKING = new Set<string>(["appointment.create", "availability.get"]);
const ORIGIN_OPERATIONS = new Set<string>(["appointment.change", "appointment.cancel", "appointment.read", "appointment.list"]);
const TEMPORAL_FIELDS = new Set<AgentBaseField>(["inicio", "fim", "dia"]);
const DERIVED_TYPES = new Set<AgentBaseType>(["SEQUENCIA", "ENTRE_ACOES", "LIBERADO_POR"]);
/** The fields of a create the slot it takes owns (LIBERADO_POR: agentDerivedCheck writes its date, time and professional). */
const RELEASED_SLOT_FIELDS = new Set<AgentQuestionField>(["dia", "inicio", "profissional"]);
function newWork(a: AgentPlanAction, open?: AgentOpenAction): Work {
  return { a, status: "READY", asked: null, fields: {}, cleared: new Set(), ambiguities: [], basis: [], premises: [], note: [], codes: [], names: {}, bases: new Map(),
    consumed: [], claims: [], services: [], reads: [], clockPremises: {}, ...open ? { open } : {} };
}
const code = (w: Work, value: AgentValidatorCode) => { if (!w.codes.includes(value)) w.codes.push(value); };
/** A1: the atoms a role of the action read for the value it took. */
const readAtoms = (w: Work, role: Read["role"], kind: Read["kind"], spans: readonly Span[], value: string) => { for (const atom of spans) w.reads.push({ role, kind, atom, value }); };
function ask(w: Work, value: AgentValidatorCode, field: string | null = null, text?: string) {
  code(w, value);
  if (w.status === "DROP") return;
  w.question ??= { code: value, field, text: text ?? AGENT_QUESTIONS[value] ?? AGENT_QUESTIONS.AGENT_QUOTE_AMBIGUOUS! };
  w.status = "ASK";
}
function drop(w: Work, value: AgentValidatorCode) { code(w, value); w.status = "DROP"; w.notice ??= DROP_NOTICES[value]; }
/** A7: a patch held whole: its open action keeps every value and waits on the backend question (nothing of the patch applies). */
function hold(w: Work, value: AgentValidatorCode) { w.held = true; ask(w, value); }
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
/** A7: the open action holds a value for this professional (its ref, or the owner's words prepare() still resolves). */
function personHeld(open: AgentOpenAction, field: AgentBaseField) {
  const keys: readonly (keyof SchedulingFields)[] = field === "profissional" ? PROFESSIONAL_KEYS : field === "novo_profissional" ? TARGET_KEYS : [];
  return keys.some(key => !!open.fields[key]);
}
/** Micro P0c: a clause of the owner names an open action by its identity: one of its words (≥ 3 letters, no glue) is close to a word of that
 * action's customer (the registered name of its customer or appointment's customer, or the owner's words for it) that is no word of a waiting
 * action's customer. Never by its professional or services: in an answer those words are values the waiting action may be asking for. */
function namesOpenAction(text: string, open: AgentOpenAction, waiting: readonly AgentOpenAction[], salon: ReadonlySet<string>): boolean {
  const tokensOf = (item: AgentOpenAction) => { const f = item.fields, id = f.customer_ref ?? item.customer;
    return [id ? item.names[id] : undefined, f.customer_name]
      .flatMap(name => name ? nameTokens(withoutArticle(name)) : []).filter(token => [...token].length >= AGENT_NAME_TOKEN_MIN && !GLUE.has(token) && !salon.has(token)); };
  const others = new Set(waiting.flatMap(tokensOf)), own = tokensOf(open).filter(token => !others.has(token));
  return words(text).some(word => [...word].length >= AGENT_NAME_TOKEN_MIN && !GLUE.has(word) && own.some(token => tokenSimilarity(word, token) >= SUGGESTION_THRESHOLD));
}
/** A2: a word that names a time or an agenda row: an alterity word beside it asks another time or row ("outro horário", "outro dia", "horário
 * diferente"), never another person. */
const rowWord = (word: string) => APPT_WORDS.has(word) || temporalWord(word) && !GLUE.has(word) && !ALTERITY.has(word);

// ---------------------------------------------------------------- validation
/** §5: validate a decoded plan against the owner's messages of this turn, the message's binding and the tenant (through `reader`). */
export async function validateAgentPlan(plan: AgentPlan, input: AgentValidationInput): Promise<AgentValidation> {
  // A7: a message on an open agent plan is checked against that plan; a message context holding one without it is a wiring error (refused).
  const openActions = input.open?.actions ?? [];
  if (!input.open && agentMessage()?.open) return { ok: false, code: "AGENT_SCHEMA", reasons: ["OPEN_PLAN_MISSING"] };
  // V1: decoded, at most 4 actions, acyclic graph, released slot of a cancel/change it depends on (of this plan or the open one).
  const checked = decodedPlan(plan, input.open ? { openKeys: openActions.map(item => item.key), doneKeys: openActions.filter(item => item.status === "DONE").map(item => item.key) } : undefined);
  if ("reasons" in checked) return { ok: false, code: "AGENT_SCHEMA", reasons: checked.reasons };
  const decoded = checked.plan, graph = graphViolation(decoded, openActions);
  if (graph) return { ok: false, code: "AGENT_DAG", reasons: [graph] };
  const result = decoded.resultado;
  if (result === "CONVERSA" || result === "FORA_DO_ESCOPO")
    return { ok: true, result, actions: [], notices: [], question: null, reply: `${clean(decoded.resposta ?? "", AGENT_PLAN_LIMITS.reply)}\n${AGENT_NOTHING_CHANGED}`, codes: [] };
  if (result === "PERGUNTA" && decoded.pergunta?.campo === "operacao")
    return { ok: true, result, actions: [], notices: [], question: { field: "operacao", text: `${clean(decoded.pergunta.texto, AGENT_PLAN_LIMITS.question)}\n${AGENT_NOTHING_CHANGED}` }, reply: null, codes: [] };
  const reader = cachedReader(input.reader), binding = input.binding, criteria = input.criteria ?? AGENT_REGISTERED_CRITERIA;
  const timezone = reader.timezone, now = reader.now, today = dateKeyInTimeZone(now, timezone), src = ownerSource(input.owner);
  const atoms: Atom[] = temporalAtomSpans(src.text, timezone, now) ?? [];
  const openByKey = new Map(openActions.map(item => [item.key, item] as const));
  // A4 (S2): a released slot is a create's (the C4's released-slot rule); on another operation the edge leaves that action alone, its order
  // (depende_de) stays, and the action asks when a value of it stood on that slot (releasedRole). A cycle or a create's bad edge still refuses
  // the plan (graphViolation).
  const releasedRole = new Set(decoded.acoes.filter(action => action.ocupa_horario_de !== null && action.operacao !== "appointment.create").map(action => action.chave));
  const works = decoded.acoes.map(action => newWork(releasedRole.has(action.chave) ? { ...action, ocupa_horario_de: null } : action, openByKey.get(action.chave)));
  /** The plan's execution order (the C4's: dependencies first, then the plan's order), for V8's least busy count. */
  const rank = new Map(dependencyGraph(planEdges(decoded.acoes)).order.map((key, index) => [key, index] as const));
  /** The owner's words (original offsets, folded form), for V4's name runs (runOf). */
  const wordList = [...src.text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu)].map(match => ({ start: match.index!, end: match.index! + match[0].length, word: foldedLiteral(match[0]) }));
  /** A word at `at` opens a sentence of the owner (nothing but marks since its message's start or a sentence boundary): its capital says nothing. */
  const opening = (at: number) => { const bound = src.bounds.find(item => at >= item[0] && at <= item[1]); return !bound || /(?:^|[.!?:;\n])[^\p{L}\p{N}]*$/u.test(src.text.slice(bound[0], at)); };
  /** The other actions whose clause is theirs alone (the pieces of one excepted interval share theirs; an action that asks because it
   * came out of an earlier action's segment does not take that action's words). */
  const rivals = (w: Work) => works.filter(other => other !== w && other.own && !exceptionPieces(w, other) && !other.codes.includes("AGENT_SCOPE_OVERLAP"));
  const ownSpans = () => works.flatMap(w => w.own ? [w.own] : []);
  const dayAtoms = (region: Span) => atoms.filter(atom => atom.kind === "date" && inside([atom.start, atom.end], region));
  const segmentOf = (span: Span): Span => { const bounds = clauseBounds(src.text, span[0], span[1]); return bounds ? [bounds.start, bounds.end] : span; };

  // ---- A7: a patch of a confirmed action never runs again; a patch that changes the open action's operation holds it and asks.
  for (const w of works) {
    if (w.open?.status === "DONE") drop(w, "AGENT_PATCH_DONE");
    else if (w.open && w.open.operation !== w.a.operacao) hold(w, "AGENT_PATCH_OPERATION");
  }
  // ---- A3 (S2): a value of the appointment, the start, the end or the day the plan repeats with no base (the decoder admits one only on a
  // patch, fix B2). Equal to the open action's validated value, it is that value: the patch leaves the field alone (kept, re-checked as any kept
  // value). Any other value is never taken: the patch holds its open action whole with the question (nothing of it applies); a new action that
  // carried one loses it to the same question.
  for (const w of works) {
    if (w.status === "DROP") continue;
    const unbased = AGENT_BASE_REQUIRED_FIELDS.filter(field => w.a[field] !== null && !w.a.bases.some(item => item.campo === field && item.tipo !== "NAO_DITO"));
    if (!unbased.length) continue;
    const same = !!w.open && unbased.every(field => inheritedValue(w.open!, w.a, field, binding));
    const next = { ...w.a };
    for (const field of unbased) next[field] = null;
    w.a = next;
    if (same) continue;
    if (!w.open) ask(w, "AGENT_PATCH_UNPROVEN");
    else if (!w.held) hold(w, "AGENT_PATCH_UNPROVEN");
  }
  // ---- V0: the backend's clause of every action; two mutations from the same segment: the later one asks.
  for (const w of works) {
    if (w.status === "DROP") continue;
    const spans = spansOf(src, w.a.citacao_acao);
    // A patch whose words are not in this message changes nothing (the open action stays as it was; no notice).
    if (!spans.length) { drop(w, "AGENT_QUOTE_ABSENT"); if (w.open) w.notice = undefined; continue; }
    // A patch whose words cannot be placed holds its open action whole (every value it had, with the question), never emptied.
    if (spans.length > 1) { if (w.open) hold(w, "AGENT_QUOTE_AMBIGUOUS"); else ask(w, "AGENT_QUOTE_AMBIGUOUS"); continue; }
    const bounds = clauseBounds(src.text, spans[0][0], spans[0][1]);
    if (!bounds) { if (w.open) hold(w, "AGENT_QUOTE_AMBIGUOUS"); else ask(w, "AGENT_QUOTE_AMBIGUOUS"); continue; }
    w.quote = spans[0]; w.own = [bounds.start, bounds.end];
  }
  const placed = works.filter(w => w.own && MUTATING.has(w.a.operacao)).sort((a, b) => a.quote![0] - b.quote![0]);
  /** Micro P0c/P2: the team's and the services' name words (a professional or a service is never a customer's identity nor another person). */
  const microTeam = new Set(agentMicroEnabled() ? (await reader.professionals() ?? []).flatMap(row => nameTokens(row.name)) : []);
  const microSalon = new Set([...microTeam, ...agentMicroEnabled() ? (await reader.services() ?? []).flatMap(row => nameTokens(row.name)) : []]);
  placed.forEach((w, index) => { if (placed.slice(0, index).some(prior => !exceptionPieces(w, prior) && meets(prior.own!, w.own!))) ask(w, "AGENT_SCOPE_OVERLAP"); });
  // ---- Micro P0c (CF09 mechanism, flag SALON_SECRETARY_AGENT_MICRO): an answer only changes the action that asked. A patch of an open action
  // that was ready (it asked nothing) while another open action waits on the owner holds its action whole, unless its own clause names it by
  // its customer (namesOpenAction: never by a professional or a service, which an answer may give the waiting action).
  if (agentMicroEnabled()) for (const w of works) {
    if (!w.open || w.held || w.status === "DROP" || !w.own || w.open.asked !== false) continue;
    const waiting = openActions.filter(item => item.key !== w.open!.key && item.asked);
    if (waiting.length && !namesOpenAction(src.text.slice(w.own[0], w.own[1]), w.open, waiting, microSalon)) hold(w, "AGENT_PATCH_TARGET");
  }

  // ---- V4/V6: every base located in the regions its action admits; the reasons (V21) located the same way.
  /** (a) the action's own segment and (b) any later segment that is no other action's clause; (c) before it only for a day said once for
   * coordinated actions (the D4 rule: the action's own segment states no day and no negator or alterity word; the day lies outside every
   * clause, undenied, and does not single one person out). A span that meets another action's clause is never admitted. */
  const admits = (w: Work, span: Span, dayField: boolean) => {
    if (!w.own) return false;
    if (rivals(w).some(other => meets(other.own!, span))) return dayField && agentMicroEnabled() && sharedComplement(w, span);
    if (span[0] >= w.own[0]) return true;
    if (!dayField || ownSpans().some(own => meets(own, [span[0], Math.min(span[1], w.own![0])])) || dayAtoms(w.own).length) return false;
    if (words(src.text.slice(w.own[0], w.own[1])).some(word => NOT_SHARED.has(word))) return false;
    return !singlesOut(src.text, span, ownSpans()) && !temporalQuoteDenied(src.text, span[0], span[1], w.a.operacao);
  };
  /** Micro P2 (V0 clause scope, flag SALON_SECRETARY_AGENT_MICRO): a day or start said once at the tail of the NEXT action's clause, when that
   * action is coordinated with this one under one verb (its clause's governing lead reaches back to this clause's start; the same operation),
   * belongs to both: neither clause holds any other complement (this one: at most its lead word before its own customer's or appointment's
   * words, and glue; the next one: only its customer's or appointment's words and glue before the complement; a professional or a service
   * of either is another reading), this action's own clause states no day or clock, neither clause holds a negator or alterity word, the
   * complement is undenied and singles nobody out; never on a cancellation or a block (high risk, decision 14). Shown as a premise (shared). */
  const identity = (v: Work) => v.a.bases.filter(base => base.campo === "cliente" || base.campo === "atendimento").flatMap(base => spansOf(src, base.citacao).filter(item => inside(item, v.own!)));
  const sharedComplement = (w: Work, span: Span) => {
    const holders = rivals(w).filter(other => meets(other.own!, span)), other = holders[0];
    if (holders.length !== 1 || !other.quote || other.a.operacao !== w.a.operacao || !SHARED_OPERATIONS.has(w.a.operacao) || !inside(span, other.own!) || other.own![0] < w.own![1]) return false;
    if (ownSpans().some(own => own !== w.own && own !== other.own && own[0] >= w.own![1] && own[1] <= other.own![0])) return false;
    const lead = clauseBounds(src.text, other.quote[0], other.quote[1])?.lead;
    if (lead === undefined || lead > w.own![0] || atoms.some(atom => meets([atom.start, atom.end], w.own!))) return false;
    if ([w.own!, other.own!].some(own => words(src.text.slice(own[0], own[1])).some(word => NOT_SHARED.has(word)))) return false;
    if (/[\p{L}\p{N}]/u.test(src.text.slice(span[1], other.own![1]))) return false;
    const people = identity(other), mine = identity(w), loose = wordList.filter(item => inside([item.start, item.end], w.own!) && !GLUE.has(item.word) && !mine.some(own => inside([item.start, item.end], own)));
    if (!mine.length || loose.length > 1 || loose.some(item => mine.some(own => own[0] < item.start))) return false;
    if (wordList.some(item => item.start >= other.own![0] && item.end <= span[0] && !GLUE.has(item.word) && !people.some(own => inside([item.start, item.end], own)))) return false;
    return !singlesOut(src.text, span, ownSpans()) && !temporalQuoteDenied(src.text, span[0], span[1], w.a.operacao);
  };
  /** The premise of a complement V0 shared (sharedComplement), in the owner's words. */
  const sharedPremise = (text: string) => `Considerei «${clean(text, 60)}» também para este pedido: foi dito uma vez para os dois.`;
  /** Micro P2 (admits() locality, flag SALON_SECRETARY_AGENT_MICRO): the customer named in an earlier sentence of the same message (an
   * antecedent) is this action's when its own clause refers to one person by a singular pronoun and names no customer and no unknown capitalized
   * word, the text from that sentence's start to this clause names nobody else (no other customer this message shows, no one of the team, no
   * other capitalized word, no other noun phrase that may be a person) and holds no negator or alterity word, and no other action's clause lies
   * between; never on a cancellation or a block (high risk, decision 14). The customer it gives is an assumption, said as a premise (assume). */
  const antecedent = (w: Work, span: Span) => {
    if (!w.own || span[1] > w.own[0] || !SHARED_OPERATIONS.has(w.a.operacao) || ownSpans().some(own => meets(own, [span[0], w.own![0]]))) return false;
    if (!/[.!?;\n]/.test(src.text.slice(span[1], w.own[0]))) return false;
    const start = Math.max(0, ...[...src.text.slice(0, span[0]).matchAll(/[.!?;\n]/g)].map(match => match.index! + 1));
    const mine = new Set(nameTokens(withoutArticle(src.text.slice(span[0], span[1])))), shown = new Set(binding.entries("c").flatMap(entry => nameTokens(String((entry.facts as { shown?: string }).shown ?? ""))));
    const capital = (item: WordAt) => /^\p{Lu}/u.test(src.text.slice(item.start, item.end)) && !opening(item.start) && /\p{Ll}/u.test(src.text);
    const own = wordList.filter(item => inside([item.start, item.end], w.own!)), before = wordList.filter(item => item.start >= start && item.end <= w.own![0]);
    if (!own.some(item => PRONOUNS.has(item.word) && !PLURAL_PRONOUNS.has(item.word))) return false;
    if (own.some(item => !mine.has(item.word) && !microTeam.has(item.word) && (shown.has(item.word) || capital(item)))) return false;
    // Another noun phrase between (a word right after an article, a preposition or a possessive: closed classes) may be the pronoun's person:
    // two readings, unless that word is an agenda noun, a temporal word or a word of the salon's (none of them a person).
    const nominal = (item: WordAt) => { const prior = wordList[wordList.indexOf(item) - 1];
      return !!prior && prior.start >= start && (GLUE.has(prior.word) || FIRST_PERSON.has(prior.word)) && /^[^\S\n]+$/u.test(src.text.slice(prior.end, item.start)) &&
        !GLUE.has(item.word) && !PRONOUNS.has(item.word) && !APPT_WORDS.has(item.word) && !temporalWord(item.word) && !microSalon.has(item.word); };
    return !before.some(item => !mine.has(item.word) && (NOT_SHARED.has(item.word) || shown.has(item.word) || microTeam.has(item.word) || capital(item) || nominal(item)));
  };
  const reasonSpans = () => works.flatMap(w => w.reason ? [w.reason] : []);
  // S1c: a later segment belongs to the nearest clause before it: with another action's clause between the cancellation's own and the
  // reason's words, those words are that action's, never this cancellation's cause (V21 asks it).
  const attached = (w: Work, span: Span) => !works.some(other => other !== w && other.own && other.own[0] >= w.own![1] && other.own[1] <= span[0]);
  for (const w of works) {
    if (!w.own || !w.a.motivo) continue;
    const found = spansOf(src, w.a.motivo).filter(span => admits(w, span, false) && attached(w, span));
    if (found.length === 1) w.reason = found[0];
  }
  for (const w of works) {
    if (!w.own) continue;
    for (const base of w.a.bases) {
      // A1: NAO_DITO states that nothing was said; its quote proves nothing and is never located (the eligible set is the backend's, V8). A7: a
      // patch keeps the person its open action holds (one derived before is derived again from a changed ground: keptBases); only an alterity
      // word of its clause lets that person go (deferredProfessional: never that one again, never a pick in its place).
      if (base.tipo === "NAO_DITO") { if (!w.open || !personHeld(w.open, base.campo) || asksAnother(w)) w.bases.set(base.campo, { base }); continue; }
      const spans = spansOf(src, base.citacao), dayField = base.campo === "dia" || base.campo === "inicio";
      let admitted = spans.filter(span => admits(w, span, dayField)), via: Located["via"];
      if (!admitted.length && base.campo === "cliente" && agentMicroEnabled()) { admitted = spans.filter(span => antecedent(w, span)); via = "antecedent"; }
      else if (agentMicroEnabled() && admitted.length === 1 && dayField && rivals(w).some(other => meets(other.own!, admitted[0]))) via = "shared";
      const located: Located = !spans.length ? { base, code: "AGENT_QUOTE_ABSENT" } : !admitted.length ? { base, code: "AGENT_QUOTE_FOREIGN" }
        : admitted.length > 1 ? { base, code: "AGENT_QUOTE_AMBIGUOUS" } : { base, span: admitted[0], text: src.text.slice(admitted[0][0], admitted[0][1]), ...via ? { via } : {} };
      if (located.span && base.tipo !== "EXCECAO") {
        const [start, end] = located.span, operation = w.a.operacao;
        // S1c: a day the owner excluded ("menos sexta") is denied as much as a negated one: a temporal quote over it never gives that day.
        const denied = TEMPORAL_FIELDS.has(base.campo) ? temporalQuoteDenied(src.text, start, end, operation, reasonSpans()) ||
          atoms.some(atom => meets([atom.start, atom.end], [start, end]) && excludedDay(src.text, atom)) : entityQuoteDenied(src.text, start, end, operation);
        if (denied) located.code = "AGENT_QUOTE_NEGATED";
      }
      w.bases.set(base.campo, located);
    }
    // A1: overlapping quotes are no longer refused as such. A name word proves one role (V4: claimed/claims); a clock atom proves one clock
    // role and a day atom one date (temporalRoles, after the reads).
  }

  // ---- V5-N: a negator governing the action's clause (or inside its own quote, a value correction or a sibling's reason aside) drops it.
  // A7: a negated patch never leaves its open action confirmable: the open action is held with the question (nothing of the patch applies).
  for (const w of works) {
    if (!w.quote || w.status === "DROP" || w.held) continue;
    const governing = governingNegators(src.text, w.quote[0], w.quote[1], reasonSpans());
    if (!governing || governing.length || innerNegator(w)) { if (w.open) hold(w, "AGENT_NEGATED"); else drop(w, "AGENT_NEGATED"); }
  }
  const live = () => works.filter(w => w.status !== "DROP" && w.own && !w.held);
  // Round 2: the appointment each change names, re-read (review M2: an anchor on it is its own only when its words name nobody else; C5: its
  // own professional is no other one); (review C4) the durations the owner wrote (the closed duration reader), never a clock of the day.
  const moved = new Map<Work, AgentApptFact>(), durations = durationLiterals(src.text).map((item): Span => [item.start, item.end]);
  /** Review C4: a clock atom the duration reader reads as an amount of time ("em 1h", a bare "2h") and no time preposition leads (closed
   * class: "para 11h", "pra 11h", "às 11h" are clocks of the day). */
  const duration = (span: Span) => durations.some(item => meets(item, span)) && !TIME_LEAD.test(src.text.slice(Math.max(0, span[0] - 12), span[0]));
  for (const w of live()) {
    if (w.a.operacao !== "appointment.change") continue;
    const id = w.a.atendimento ? binding.resolve(w.a.atendimento, "a")?.id : w.open?.appointment, row = id ? await reader.appointment(id) : undefined;
    if (row) moved.set(w, row);
  }
  /** F0's reading of the owner's words per change (ownerTemporal; fixed once the change's origin is read). */
  const ownerSaid = new Map<Work, { day: "NONE" | "SAME" | "OTHER"; clock: "NONE" | "SAME" | "OTHER"; loose: boolean }>();

  // ---- pass 1: people (V2, V3, V4-E, V7, V8 first person); rule 7's topic (V18; A7: with none here, the open plan's one customer).
  const professionals = await reader.professionals() ?? [], services = await reader.services() ?? [];
  const directoryTokens = new Set([...professionals, ...services].flatMap(row => nameTokens(row.name))), serviceTokens = new Set(services.flatMap(row => nameTokens(row.name)));
  /** Fixer: the words of a person's name this message can see (the team's; the customers the lookups bound, as shown): never widened into a service. */
  const peopleWords = new Set([...professionals.flatMap(row => nameTokens(row.name)),
    ...binding.entries("c").flatMap(entry => nameTokens(String((entry.facts as { shown?: string }).shown ?? "")))]);
  for (const w of live()) {
    await customerStep(w);
    // Micro P2 (flag SALON_SECRETARY_AGENT_MICRO): a customer taken from an earlier sentence (antecedent) is an assumption: said as a premise
    // (assume; settle() sends it back on a high-risk action).
    const ante = agentMicroEnabled() ? baseOf(w, "cliente") : undefined;
    if (ante?.via === "antecedent" && !ante.code && w.customer?.id && w.fields.customer_ref === w.customer.id && !w.assumed?.some(item => item.field === "cliente"))
      assume(w, "cliente", trimmedName(ante.text ?? "") ?? w.customer.name ?? "", w.customer.name ?? "");
    await personStep(w, "profissional");
  }
  // Owner decision 14 (people): a person assumed past an unknown word stands only on a low-risk action; the lot is counted once, before any
  // person leaves, so no action's outcome depends on another's.
  const lot = lotCustomers();
  for (const w of live()) await settle(w, ["cliente", "profissional"], lot);
  const topicOf = live().filter(w => MUTATING.has(w.a.operacao) && w.customer?.proven && w.customer.id).sort((a, b) => a.quote![0] - b.quote![0])[0];
  const topic = topicOf?.customer ?? openTopic(), assumedTopic = !!topicOf?.assumed?.some(item => item.field === "cliente");
  for (const w of live()) {
    if (!w.customer?.pronoun) continue;
    // An assumed topic never reaches a high-risk action through a pronoun: that customer is asked there.
    if (w.customer.plural || !topic?.id || w.customer.id !== undefined && w.customer.id !== topic.id || assumedTopic && await highRisk(w, lot)) {
      clear(w, CUSTOMER_KEYS); ask(w, "AGENT_PRONOUN_TOPIC", "customer_ref"); continue;
    }
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
    if (w.a.operacao === "appointment.change") { await personStep(w, "novo_profissional"); await settle(w, ["novo_profissional"], lot); }
    reasonStep(w);
    recurrenceStep(w);
  }
  // ---- A4 (S2): an action that is no create and named the slot another action frees: the value it read from that slot left with the edge
  // (derivedStep's mismatch), and the backend asks it instead of a value nobody proved.
  for (const w of live()) {
    if (!releasedRole.has(w.a.chave)) continue;
    code(w, "AGENT_RELEASED_ROLE");
    if (w.a.bases.some(item => item.tipo === "LIBERADO_POR")) ask(w, "AGENT_RELEASED_ROLE", "time");
  }
  // ---- A1: one clock atom proves one clock role; a day atom serves several fields only with one date. A7: a patch's derived bases after
  // this message's changes.
  for (const w of live()) { temporalRoles(w); if (w.open) keptBases(w); }
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
  for (const w of live()) { entityDenied(w); if (w.open) keptDenied(w); retraction(w); }
  for (const w of live()) await releasedProfessional(w);
  const notices = coverage();
  for (const w of works) notes(w);
  if (decoded.acoes_fora > 0) notices.push(agentActionsLeftText(decoded.acoes_fora));
  // A1: a field question (on a PLANO or the recorded PERGUNTA) marks its action; the operation question of one unclear part, on a PLANO,
  // is shown next to the other actions (a question, never a value nor a write; the owner's answer reaches the C4 continuation).
  if (decoded.pergunta && decoded.pergunta.campo !== "operacao") {
    const target = works.find(w => w.a.chave === decoded.pergunta!.acao);
    // S1c: what a released slot owns (its day, clock and professional) is never the owner's to answer: such a question marks nothing.
    if (target && !(target.derived?.type === "LIBERADO_POR" && RELEASED_SLOT_FIELDS.has(decoded.pergunta.campo))) { target.asked = decoded.pergunta.campo; code(target, "AGENT_FIELD_QUESTION"); }
    // Fixer: a change's services are optional to prepare(), so its question on them would leave the change proposed without them: the backend
    // asks them here (the C4 continuation takes the answer), never the change alone.
    if (target && decoded.pergunta.campo === "servicos" && target.a.operacao === "appointment.change" && !target.fields.service_changes?.length)
      ask(target, "AGENT_FIELD_QUESTION", "service_changes", AGENT_SERVICE_CHANGE_QUESTION);
  }
  // ---- Round 2, F0: what a change leaves empty, prepare() keeps from the appointment; a value the plan moved off it that the validator emptied
  // is asked here, never inherited in silence.
  for (const w of live()) originInherited(w);
  if (result === "PLANO" && decoded.pergunta?.campo === "operacao") { const text = clean(decoded.pergunta.texto, AGENT_PLAN_LIMITS.question); if (text) notices.push(text); }
  for (const w of [...works].reverse()) if (w.status === "DROP" && w.notice && !notices.includes(w.notice)) notices.unshift(w.notice);
  // Micro P2: a day or start V0 shared that stands is said as a premise.
  if (agentMicroEnabled()) for (const w of live()) {
    const shared = [...w.bases.values()].find(item => item.via === "shared" && !item.code && item.text), premise = shared ? sharedPremise(shared.text!) : undefined;
    if (premise && (w.fields.date || w.fields.time) && !w.premises.includes(premise)) w.premises.push(premise);
  }
  // A7: a held patch keeps every value and basis of its open action; a patch's names are the open action's for the ids it still holds.
  const actions = works.map((w): AgentActionOutcome => {
    const held = !!w.held && !!w.open, fields = held ? structuredClone(w.open!.fields) : { ...w.fields };
    return { key: w.a.chave, operation: w.a.operacao, status: w.status, fields, cleared: held ? [] : [...w.cleared], card: w.card ?? null, question: w.question ?? null, asked: w.asked,
      ambiguities: held ? [] : [...w.ambiguities], origin: held ? null : w.origin ?? null, derived: held ? null : w.derived ?? null, recurrence: held ? null : w.recurrence ?? null,
      dependsOn: [...w.a.depende_de], releasedSlotOf: w.a.ocupa_horario_de, basis: held ? [...w.open!.basis] : [...w.basis], premises: held ? [] : [...w.premises], note: [...w.note],
      notice: w.notice ?? null, codes: [...w.codes], names: w.open ? { ...keptNames(w.open, fields, w.appt?.id ?? w.open.appointment), ...held ? {} : w.names } : { ...w.names },
      ...w.open ? { patch: true as const } : {}, ...w.missing?.length && !held && w.status !== "DROP" ? { temporalMissing: [...w.missing] } : {} };
  });
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
   * customers). The appointment's own quote is shared on purpose whatever its type (it names its customer and professional, V7-A, A1). */
  function claimed(w: Work, field: AgentBaseField): Span[] {
    return [...w.claims, ...[...w.bases.values()].flatMap(item => item.span && item.base.campo !== field && (item.base.tipo === "DITO" && ENTITY_FIELDS.has(item.base.campo) && !nameless(w, item) ||
      field === "cliente" && item.base.campo !== "atendimento" && (item.base.tipo === "ANCORA" && !ownAnchor(w, item) || item.base.tipo === "EXCECAO")) ? [item.span] : [])];
  }
  /** Round 2, F3 (review M3): a DITO base of a professional or of the services, with the rows the plan chose there, whose quote holds no word
   * (≥ 3 letters) that is, or nearly is, a word of ANY registered row of that role names nobody of that role: it proves nothing for its own
   * field (literalOf asks or clears it there) and takes no word from another role (a customer's name quoted as a professional's base stays
   * the customer's). A quote nearly naming another row of the role keeps its words, and so does a base with no chosen row or a row this
   * message cannot read (the owner's words for that role, NOME). */
  function nameless(w: Work, item: Located) {
    const field = item.base.campo, refs: (string | null)[] = field === "servicos" ? (w.a.servicos ?? []).map(entry => entry.ref) : field === "profissional" || field === "novo_profissional" ? [w.a[field]] : [];
    if (!refs.length || refs.some(ref => !ref)) return false;
    const rows: (AgentNamed | undefined)[] = refs.map(ref => field === "servicos" ? services.find(row => row.id === binding.resolve(ref!, "s")?.id) : professionals.find(row => row.id === binding.resolve(ref!, "p")?.id));
    if (rows.some(row => !row)) return false;
    const role = [...new Set((field === "servicos" ? services : professionals).flatMap(row => nameTokens(withoutArticle(row.name)))
      .filter(token => [...token].length >= AGENT_NAME_TOKEN_MIN && !GLUE.has(token)))];
    return !nameTokens(withoutArticle(item.text ?? "")).some(token => [...token].length >= AGENT_NAME_TOKEN_MIN && !GLUE.has(token) &&
      role.some(word => tokenSimilarity(token, word) >= SUGGESTION_THRESHOLD));
  }
  /** Round 2 (F1, F3): an anchor base on the appointment its own change moves (the plan's `atendimento`, or the one V7-A accepted): it anchors
   * nothing (V12 never takes that appointment) and its words name that appointment, so its customer is this action's own. Review M2: never on
   * the model's ref alone: a quote holding a name word of a customer this message showed (or of the plan's own customer) that the moved
   * appointment's customer lacks names another row, and is not this one. */
  function ownAnchor(w: Work, item: Located) {
    if (w.a.operacao !== "appointment.change" || item.base.tipo !== "ANCORA") return false;
    const id = binding.resolve(item.base.ref ?? "", "a")?.id;
    if (!id || ![w.appt?.id, w.origin?.expected, w.a.atendimento ? binding.resolve(w.a.atendimento, "a")?.id : undefined].includes(id)) return false;
    const mine = new Set(nameTokens((moved.get(w) ?? w.appt)?.customerName ?? ""));
    const shown = new Set([...binding.entries("c").flatMap(entry => nameTokens(String((entry.facts as { shown?: string }).shown ?? ""))),
      ...w.a.cliente ? nameTokens(String((binding.resolve(w.a.cliente, "c")?.facts as { shown?: string } | undefined)?.shown ?? "")) : []]);
    return !nameCore(item.text ?? "").some(token => [...token].length >= AGENT_NAME_TOKEN_MIN && !directoryTokens.has(token) && shown.has(token) && !mine.has(token));
  }
  /** V4-E: the chosen name's whole tokens (≥ 3 letters) the owner wrote in the action's own region (its clause and the later segments that
   * are no other action's clause, V4 (a)/(b)), outside every temporal atom, undenied (V6) and unclaimed by another role (V4). A customer is
   * never proven by the salon's professional or service words alone: such a word counts only inside a run the customer's own words hold
   * ("Iolanda Serafim"), never as the professional said apart ("com o Serafim"). `claims`: the spans used. */
  function namedIn(w: Work, name: string, field: AgentBaseField): { tokens: string[]; spans: Span[]; claims: Span[] } {
    const out = { tokens: [] as string[], spans: [] as Span[], claims: [] as Span[] }, taken = claimed(w, field), hits = new Map<string, Span[]>();
    // Fixer: a glue word of a service's name ("com" of "X com Y") is no word the owner used for that service ("pedicure com a Teodora").
    for (const token of new Set(nameTokens(withoutArticle(name)).filter(item => [...item].length >= AGENT_NAME_TOKEN_MIN && !(field === "servicos" && GLUE.has(item))))) {
      const found = literalSpans(src.text, token).filter(span => withinOne(src, span) && span[0] >= w.own![0] && admits(w, span, false) &&
        !atoms.some(atom => meets([atom.start, atom.end], span)) && !taken.some(item => meets(item, span)) && !entityQuoteDenied(src.text, span[0], span[1], w.a.operacao));
      if (found.length) hits.set(token, found);
    }
    const personal = field === "cliente" ? [...hits].filter(([token]) => !directoryTokens.has(token)).flatMap(([, spans]) => spans.map(runOf)) : undefined;
    for (const [token, spans] of hits) {
      const inRun = personal && directoryTokens.has(token) ? spans.filter(span => personal.some(run => inside(span, run))) : spans;
      if (inRun.length) { out.tokens.push(token); out.spans.push(...inRun); }
    }
    out.claims = [...out.spans];
    return out;
  }
  /** S2 (the specificity of the owner's words, people; V4-E and DITO alike, case not alone, initials), recalibrated by owner decision 14 (risk):
   * the name the owner wrote around the chosen name's words found (their runs, in the owner's text, past a DITO quote too) may hold a word the
   * chosen name lacks. That word names someone else (`firm`: the chosen row never stands; the owner's words of that run go back, NOME) when it
   * is (a) capitalized, (b) a word of a registered person's name in this salon (registered: any case, either side of the name) or (c) an
   * initial (one letter; a glue letter only with its period or in uppercase, "P.", "P") that begins none of the chosen name's other words.
   * Any other word written in lowercase after the chosen name's words, when the owner wrote those in lowercase too (the owner's case then tells
   * nothing; the words before them are left alone), is unknown (`firm` false): a verb, the "toda" of a recurrence or a surname nobody here
   * has. Then the one registered holder of the owner's words stands with a premise on a low-risk action and the words go back on a high-risk
   * one (assume, settle). Never a word opening a sentence, an honorific (closed class), a service word, a word another role of this action
   * proved or, for a customer, a word of the action's own professionals; in lowercase, never a word of the closed classes (CLOSED_WORDS). No
   * list of verbs (AGENT_RULES). `text`: the owner's words from the run's first marked word to its last. */
  async function foreignName(w: Work, field: AgentBaseField, name: string, found: readonly Span[]): Promise<{ text: string; firm: boolean } | undefined> {
    if (field === "servicos" || !found.length) return undefined;
    // Words this action's reason or its own stated times proved are theirs, never a surname of this person. Quotes that may name people
    // (the appointment, anchors, exceptions, sequences) stay in the check.
    const bases = [...w.bases.entries()].filter(([other, item]) => other !== field && ["motivo", "inicio", "fim", "dia"].includes(other) &&
      ["DITO", "MANTIDO", "FIM_EXPEDIENTE"].includes(item.base.tipo)).flatMap(([, item]) => item.span ? [item.span] : []);
    const own = new Set(nameTokens(withoutArticle(name))), taken = [...claimed(w, field), ...bases], raw = (item: WordAt) => src.text.slice(item.start, item.end);
    // A message with no lowercase letter says nothing by its case: no capital and no uppercase initial counts there.
    const shouting = !/\p{Ll}/u.test(src.text);
    const roles = new Set(field === "cliente" ? [w.a.profissional, w.a.novo_profissional].flatMap(ref => {
      const id = ref ? binding.resolve(ref, "p")?.id : undefined; return professionals.filter(row => row.id === id).flatMap(row => nameTokens(row.name)); }) : []);
    const letter = (item: WordAt) => [...item.word].length === 1 && /\p{L}/u.test(item.word);
    const text = (list: readonly WordAt[], marked: readonly WordAt[]) => {
      const picked = list.filter(item => own.has(item.word) || marked.includes(item)).sort((x, y) => x.start - y.start);
      return src.text.slice(picked[0].start, picked.at(-1)!.end);
    };
    let loose: string | undefined;
    for (const run of found.map(runOf)) {
      const list = wordList.filter(item => inside([item.start, item.end], run));
      // An initial right after the run, with its period or in uppercase: a glue letter ("P.", "P") ends the run, never the name.
      const next = wordList.find(item => item.start >= run[1]);
      if (next && letter(next) && (src.text[next.end] === "." || !shouting && /^\p{Lu}/u.test(raw(next))) && /^[^\S\n]+$/u.test(src.text.slice(run[1], next.start))) list.push(next);
      const mine = list.filter(item => own.has(item.word));
      if (!mine.length) continue;
      const cased = !shouting && mine.some(item => /^\p{Lu}/u.test(raw(item)) && !opening(item.start)), after = Math.max(...mine.map(item => item.end));
      const rest = [...own].filter(token => !mine.some(item => item.word === token));
      const firm: WordAt[] = [], unknown: WordAt[] = [];
      for (const item of list) {
        if (own.has(item.word) || roles.has(item.word) || serviceTokens.has(item.word) || HONORIFICS.has(item.word) || opening(item.start) ||
          taken.some(span => meets(span, [item.start, item.end]))) continue;
        if (letter(item)) { if (!rest.some(token => token.startsWith(item.word))) firm.push(item); continue; }
        const capital = !shouting && /^\p{Lu}/u.test(raw(item));
        if (!capital && CLOSED_WORDS.has(item.word)) continue;
        if (capital || await registered(item.word)) firm.push(item);
        else if (!cased && item.start >= after) unknown.push(item);
      }
      if (firm.length) return { text: text(list, firm), firm: true };
      if (unknown.length) loose ??= text(list, unknown);
    }
    return loose === undefined ? undefined : { text: loose, firm: false };
  }
  /** (b) of foreignName: a word of a registered person's name in this salon: a professional's (the team), else any customer's, through the
   * tenant's own token scan (V7's S over the whole scan; past the scan its count). */
  async function registered(word: string) {
    if (professionals.some(row => nameTokens(row.name).includes(word))) return true;
    const set = await reader.customerSet(word);
    return set.total > 0 || !!set.rows?.length;
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
   * quote uses the salon's professional and service words only inside a run its own words hold. `assumed`: the owner's words of a run holding an
   * unknown word beside the name (foreignName), for the caller's risk policy. */
  async function literalOf(w: Work, field: AgentBaseField, name: string):
    Promise<{ tokens: string[]; spans: Span[]; claims: Span[]; assumed?: string } | { code: AgentValidatorCode; text?: string }> {
    const located = baseOf(w, field);
    if (located && located.base.tipo === "DITO") {
      if (located.code) return { code: located.code };
      const taken = claimed(w, field), free = unclaimed(located.span!, taken), all = nameCore(free), own = new Set(nameTokens(withoutArticle(name))), caps = capitals(free);
      const text = trimmedName(free), within = (token: string) => literalSpans(src.text, token).filter(span => inside(span, located.span!) && !taken.some(item => meets(item, span)));
      const runs = field === "cliente" ? all.filter(token => !directoryTokens.has(token)).flatMap(token => within(token).map(runOf)) : undefined;
      const core = runs ? all.filter(token => !directoryTokens.has(token) || within(token).some(span => runs.some(run => inside(span, run)))) : all;
      // Fixer: an initial of the quote ("S.") that begins another word of the chosen name is no contradiction and proves nothing (S stays over
      // whole words); one that begins none still contradicts it.
      const initial = (token: string) => [...token].length === 1 && [...own].some(item => item !== token && item.startsWith(token));
      const tokens = core.filter(token => (own.has(token) || caps.has(token)) && !initial(token));
      if (!all.length) return { code: "AGENT_QUOTE_ABSENT" };
      if (!tokens.length || tokens.some(token => !own.has(token))) return { code: "AGENT_NAME_MISMATCH", text };
      // The quote may stop short of the name the owner wrote ("Genoveva" of "Genoveva Luz"): the run around it decides as for V4-E.
      const foreign = await foreignName(w, field, name, tokens.flatMap(within));
      if (foreign?.firm) return { code: "AGENT_NAME_MISMATCH", text: foreign.text };
      return { tokens, spans: [located.span!], claims: tokens.flatMap(within), ...foreign ? { assumed: foreign.text } : {} };
    }
    const found = namedIn(w, name, field);
    if (!found.tokens.length) return { code: "AGENT_QUOTE_ABSENT" };
    const foreign = await foreignName(w, field, name, found.spans);
    if (foreign?.firm) return { code: "AGENT_NAME_MISMATCH", text: foreign.text };
    return foreign ? { ...found, assumed: foreign.text } : found;
  }
  /** Owner decision 14 (people): the one registered holder of the owner's words stands past an unknown word written beside them (`text`: the
   * owner's words of that run), said as a backend premise; settle() sends the words back on a high-risk action. */
  function assume(w: Work, field: AssumedField, text: string, name: string) {
    const premise = agentPersonPremise(label(name), field === "cliente" ? "cliente" : "profissional");
    code(w, "AGENT_NAME_ASSUMED");
    (w.assumed ??= []).push({ field, text, premise });
    w.premises.push(premise);
  }
  /** Owner decision 14 (risk): cancelling, blocking over appointments and one action touching several customers at once are high-risk;
   * booking, moving, changing services, blocking free time and reading are not. A plan that books different customers in separate
   * actions is not "several at once" for a person's identity (decision 21's review dialog covers the batch). `lot` stays for telemetry. */
  async function highRisk(w: Work, lot: number) {
    void lot;
    const operation = w.a.operacao;
    if (operation === "appointment.cancel") return true;
    if (operation === "schedule.block") return !await freeBlock(w);
    return MUTATING.has(operation) && !!w.customer?.plural;
  }
  /** A block of free time only: its own interval (the plan's start and end, one day) holds no PENDING/CONFIRMED appointment of its
   * professional now. An interval the plan does not give, or over two days, is no such block. */
  async function freeBlock(w: Work) {
    const id = w.fields.professional_ref, start = w.a.inicio, end = w.a.fim;
    if (!id || !start || !end || start.slice(0, 10) !== end.slice(0, 10) || end <= start) return false;
    const rows = await reader.dayAppointments(id, start.slice(0, 10));
    return !!rows && !rows.some(row => row.startLocal < end && row.endLocal > start);
  }
  /** Owner decisions 14 and 21: the customers one lot touches at once (this plan's live bookings, moves and cancellations, and the open plan's
   * pending ones this plan leaves as they are): by id (accepted, or that of the appointment the plan names), else by the owner's words; a
   * pronoun is the topic, never one more. */
  function lotCustomers() {
    const ids = new Set<string>(), add = (id: string | undefined, said: string | undefined) => { const key = id ?? (said ? `?${foldedLiteral(said)}` : undefined); if (key) ids.add(key); };
    const customers = (operation: string) => MUTATING.has(operation) && operation !== "schedule.block";
    for (const v of live()) if (customers(v.a.operacao) && !v.customer?.pronoun)
      add(v.fields.customer_ref ?? (v.a.atendimento ? binding.resolve(v.a.atendimento, "a")?.facts.customerId : undefined), v.fields.customer_name);
    for (const item of unpatched()) if (item.status === "OPEN" && customers(item.operation)) add(item.fields.customer_ref ?? item.customer, item.fields.customer_name);
    return ids.size;
  }
  /** Owner decision 14: an assumed person of `fields` stands only on a low-risk action; on a high-risk one it leaves with its premise and the
   * owner's words of that run go back (NOME), as for a contradiction. */
  async function settle(w: Work, fields: readonly AssumedField[], lot: number) {
    if (!w.assumed?.some(item => fields.includes(item.field)) || !await highRisk(w, lot)) return;
    for (const field of fields) unassume(w, field, true);
  }
  /** An assumed person leaves: its premise goes (and the code with the last one); `back`: the person too, with the owner's words (NOME). */
  function unassume(w: Work, field: AssumedField, back = false) {
    const item = w.assumed?.find(entry => entry.field === field);
    if (!item) return;
    w.assumed = w.assumed!.filter(entry => entry !== item);
    w.premises = w.premises.filter(text => text !== item.premise);
    if (!w.assumed.length) w.codes = w.codes.filter(value => value !== "AGENT_NAME_ASSUMED");
    if (!back) return;
    const entity = field === "cliente" ? w.customer : field === "profissional" ? w.professional : w.target;
    if (entity?.id) delete w.names[entity.id];
    if (field === "cliente") w.customer = undefined; else if (field === "profissional") w.professional = undefined; else w.target = undefined;
    for (const key of field === "cliente" ? CUSTOMER_KEYS : field === "profissional" ? PROFESSIONAL_KEYS : TARGET_KEYS) delete w.fields[key];
    code(w, "AGENT_NAME_MISMATCH");
    nome(w, field === "cliente" ? "customer_name" : field === "profissional" ? "professional_name" : "target_professional_name", item.text);
  }
  function nome(w: Work, key: "customer_name" | "professional_name" | "target_professional_name" | "service_name", text: string | undefined) {
    const value = text?.trim();
    if (value && value.length >= 2) { w.fields[key] = value.slice(0, 200); return; }
    const refKey = ({ customer_name: "customer_ref", professional_name: "professional_ref", target_professional_name: "target_professional_ref", service_name: "service_ref" } as const)[key];
    clear(w, [key, refKey]);
  }
  // ================================================================ A7: what a patch keeps of its open action
  /** A field of a patch the plan leaves null with no base keeps the open action's validated value. */
  function kept(w: Work, field: AgentBaseField) { return !!w.open && w.a[field] === null && !w.bases.has(field); }
  function keepFields(w: Work, keys: readonly (keyof SchedulingFields)[]) {
    const from = w.open!.fields as Record<string, unknown>, to = w.fields as Record<string, unknown>;
    for (const key of keys) if (from[key] !== undefined) to[key] = structuredClone(from[key]);
  }
  /** A registered name's words that can name its person in the owner's words (≥ 3 letters; a customer's without the salon's words): V5-E's
   * tokens of a kept entity. */
  function nameWords(name: string, customer: boolean) {
    return nameTokens(withoutArticle(name)).filter(token => [...token].length >= AGENT_NAME_TOKEN_MIN && !GLUE.has(token) && !(customer && directoryTokens.has(token)));
  }
  function keepCustomer(w: Work) {
    const open = w.open!, id = open.fields.customer_ref, name = id ? open.names[id] ?? open.fields.customer_name ?? "" : open.fields.customer_name ?? "";
    keepFields(w, CUSTOMER_KEYS);
    if (id || name) w.customer = { ...id ? { id } : {}, name, tokens: nameWords(name, true), spans: [], proven: !!id, inherited: true };
  }
  function keepPerson(w: Work, field: "profissional" | "novo_profissional") {
    const open = w.open!, [refKey, nameKey] = field === "profissional" ? ["professional_ref", "professional_name"] as const : ["target_professional_ref", "target_professional_name"] as const;
    const id = open.fields[refKey], name = id ? open.names[id] ?? professionals.find(item => item.id === id)?.name ?? "" : open.fields[nameKey] ?? "";
    keepFields(w, [refKey, nameKey]);
    if (!id && !name) return;
    const entity: Entity = { ...id ? { id } : {}, name, tokens: nameWords(name, false), spans: [], proven: !!id, inherited: true };
    if (field === "profissional") w.professional = entity; else w.target = entity;
  }
  /** A typed choice on the open action's card: a DITO quote that is only an ordinal or a number (closed class) naming item n of that card.
   * "OK": the model's ref is exactly that item (a backend card of real rows); "MISMATCH": it is not, and the same card is shown again;
   * undefined: no typed choice (the usual proof follows). */
  function typedChoice(w: Work, field: AgentBaseField, kind: AgentCardKind, id: string): "OK" | "MISMATCH" | undefined {
    const located = baseOf(w, field), held = w.open?.card;
    if (!held || held.kind !== kind || !located?.span || located.code || located.base.tipo !== "DITO") return undefined;
    // An appointment card's rows are told apart by their days: a weekday spelled as an ordinal, or any day the quote states, is no typed proof
    // (the owner's words locate the appointment as usual).
    if (kind === "appointment_ref" && (weekdayOrdinal(located.text!) || atoms.some(atom => atom.kind === "date" && meets([atom.start, atom.end], located.span!)))) return undefined;
    const index = ordinalOf(located.text!);
    if (index === undefined) return undefined;
    if (index > held.items.length || held.items[index - 1] !== id) {
      card(w, kind, held.items.map(item => ({ id: item, name: label(w.open!.names[item] ?? "") })), "AGENT_NAME_MISMATCH");
      return "MISMATCH";
    }
    w.consumed.push(located.span);
    return "OK";
  }
  /** A6: a booking whose customer the model left empty with no base: the words of the customers this message showed (their unmasked tokens,
   * never the salon's words) that the owner wrote in the action's own clause, outside every temporal atom, undenied and unclaimed, go back
   * as the owner's words (NOME). prepare() searches them as the C4 does: one holder resolves, several are its card. Never a ref. The reading
   * is shown as a backend premise (owner decision 14: the assumption is said), in the owner's own spelling. */
  function unpicked(w: Work) {
    const shown = new Set(binding.entries("c").flatMap(entry => nameTokens(String((entry.facts as { shown?: string }).shown ?? "")))
      .filter(token => [...token].length >= AGENT_NAME_TOKEN_MIN && !directoryTokens.has(token)));
    const taken = claimed(w, "cliente");
    const hits = wordList.filter(item => { const span: Span = [item.start, item.end];
      return shown.has(item.word) && inside(span, w.own!) && !atoms.some(atom => meets([atom.start, atom.end], span)) && !taken.some(other => meets(other, span)) &&
        !entityQuoteDenied(src.text, span[0], span[1], w.a.operacao); }).map((item): Span => [item.start, item.end]);
    if (!hits.length) return;
    code(w, "AGENT_CUSTOMER_UNPICKED");
    nome(w, "customer_name", spelled(hits));
    if (!w.fields.customer_name) return;
    w.claims.push(...hits);
    w.customer = { tokens: [...new Set(hits.map(span => foldedLiteral(src.text.slice(span[0], span[1]))))], spans: hits };
    w.customerPremise = agentUnpickedPremise(w.fields.customer_name);
    w.premises.push(w.customerPremise);
  }

  /** Micro P2 (name fallback, flag SALON_SECRETARY_AGENT_MICRO): no customer holds every word of the quote. The owner's name run (runOf: the
   * words beside the first one up to glue), written capitalized where a capital says something (no word of it opens a sentence), stands for the
   * name when every word left outside it is written in lowercase, names no registered person and nothing of the salon (`tokens` already leave
   * the salon's words out), and exactly one customer holds the run's words: that one, as an assumption (assume: its premise; settle() sends
   * the words back on a high-risk action). A run in lowercase or at a sentence's start says nothing of where the name ends (a lowercase
   * surname): false, as otherwise (the caller's NOME of every word). */
  async function nameRunHolder(w: Work, quoted: Located, tokens: readonly string[], spans: readonly Span[]): Promise<boolean> {
    if (!/\p{Ll}/u.test(src.text) || !spans.length) return false;
    const run = runOf([...spans].sort((x, y) => x[0] - y[0])[0]), inRun = spans.filter(span => inside(span, run)), outside = spans.filter(span => !inside(span, run));
    if (wordList.some(item => inside([item.start, item.end], run) && (opening(item.start) || !/^\p{Lu}/u.test(src.text.slice(item.start, item.end))))) return false;
    const kept = [...new Set(inRun.map(span => foldedLiteral(src.text.slice(span[0], span[1]))))].filter(token => tokens.includes(token));
    if (!kept.length || !outside.length) return false;
    for (const span of outside) if (/^\p{Lu}/u.test(src.text.slice(span[0], span[1])) || await registered(foldedLiteral(src.text.slice(span[0], span[1])))) return false;
    const set = await reader.customerSet(kept.join(" "));
    if (set.rows?.length !== 1) return false;
    const row = set.rows[0], foreign = await foreignName(w, "cliente", row.name, inRun);
    if (foreign?.firm) return false;
    w.customer = { id: row.id, name: row.name, tokens: kept, spans: [quoted.span!], proven: true };
    w.fields.customer_ref = row.id; w.names[row.id] = row.name;
    assume(w, "cliente", trimmedName(quoted.text!) || kept.join(" "), row.name);
    return true;
  }
  async function customerStep(w: Work) {
    const a = w.a, located = baseOf(w, "cliente"), identifies = a.operacao === "appointment.change" || a.operacao === "appointment.cancel";
    // A7: a patch that leaves the customer alone keeps the open action's (a change or cancellation re-identified by new words reads them first).
    if (kept(w, "cliente") && (!identifies || kept(w, "atendimento"))) { keepCustomer(w); return; }
    if (located && located.base.tipo !== "DITO") { clear(w, CUSTOMER_KEYS, "AGENT_BASE_TYPE"); return; }
    const origin = a.cliente === null && identifies ? baseOf(w, "atendimento") : undefined;
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
      if (!tokens.length) {
        if (!located && w.open) keepCustomer(w);
        else if (!located && a.operacao === "appointment.create") unpicked(w);
        return;
      }
      // V4: these words are the customer's (no one else's proof in this action).
      const spans = tokens.flatMap(token => literalSpans(src.text, token).filter(span => inside(span, quoted!.span!)));
      w.claims.push(...spans);
      const set = await reader.customerSet(tokens.join(" "));
      if (set.rows?.length === 1) {
        // The quote may stop short of the name the owner wrote: the run around its words decides as on the ref's path (S2, owner decision 14).
        const row = set.rows[0], foreign = await foreignName(w, "cliente", row.name, spans);
        if (foreign?.firm) { code(w, "AGENT_NAME_MISMATCH"); nome(w, "customer_name", foreign.text); return; }
        w.customer = { id: row.id, name: row.name, tokens, spans: [quoted!.span!], proven: true };
        w.fields.customer_ref = row.id; w.names[row.id] = row.name;
        if (foreign) assume(w, "cliente", foreign.text, row.name);
        return;
      }
      if (set.rows?.length === 0 && agentMicroEnabled() && await nameRunHolder(w, quoted!, tokens, spans)) return;
      code(w, !set.rows || set.rows.length > CARD_MAX ? "AGENT_TOO_MANY" : set.rows.length ? "AGENT_HOMONYM" : "AGENT_NAME_MISMATCH");
      nome(w, "customer_name", tokens.join(" "));
      return;
    }
    const said = ownerWords(w, "cliente");
    const entry = binding.resolve(a.cliente, "c");
    if (!entry) { code(w, binding.entry(a.cliente) ? "AGENT_REF_KIND" : "AGENT_REF_UNKNOWN"); nome(w, "customer_name", said); return; }
    const row = await reader.customer(entry.id);
    if (!row) { code(w, "AGENT_REF_STALE"); nome(w, "customer_name", said); return; }
    // A7: the open action's own customer named again with no words for it here stays as validated; a typed card choice is that row.
    if (w.open && !located && row.id === w.open.fields.customer_ref) { keepCustomer(w); return; }
    const typed = typedChoice(w, "cliente", "customer_ref", row.id);
    if (typed === "MISMATCH") { clear(w, CUSTOMER_KEYS); return; }
    if (typed === "OK") {
      w.customer = { id: row.id, name: row.name, tokens: nameWords(row.name, true), spans: [], proven: true };
      w.fields.customer_ref = row.id; w.names[row.id] = row.name;
      return;
    }
    const literal = await literalOf(w, "cliente", row.name);
    if ("code" in literal) {
      if (literal.code === "AGENT_NAME_MISMATCH") { code(w, literal.code); nome(w, "customer_name", literal.text); } else clear(w, CUSTOMER_KEYS, literal.code);
      return;
    }
    w.consumed.push(...literal.spans); w.claims.push(...literal.claims);
    const text = said ?? spelled(literal.spans), set = await reader.customerSet(literal.tokens.join(" "));
    if (!set.rows || set.rows.length > CARD_MAX) { code(w, "AGENT_TOO_MANY"); nome(w, "customer_name", text); return; }
    if (!set.rows.some(item => item.id === row.id)) { code(w, "AGENT_NAME_MISMATCH"); nome(w, "customer_name", text); return; }
    w.customer = { id: row.id, name: row.name, tokens: literal.tokens, spans: literal.spans, proven: set.rows.length === 1 };
    if (set.rows.length === 1) {
      w.fields.customer_ref = row.id; w.names[row.id] = row.name;
      if (literal.assumed) assume(w, "cliente", literal.assumed, row.name);
      return;
    }
    // V7: two or more holders of the owner's words: a card on a booking; elsewhere prepare()'s own search (and the locate) decides.
    w.fields.customer_name = text;
    if (BOOKING.has(a.operacao)) card(w, "customer_ref", named(set.rows), "AGENT_HOMONYM"); else code(w, "AGENT_HOMONYM");
  }
  /** V2, V3, V7 and V8's first person for a professional (the action's own, or a change's new one when said). DELEGADO and NAO_DITO wait
   * for the services and the time (deferredProfessional). */
  async function personStep(w: Work, field: "profissional" | "novo_profissional") {
    const a = w.a, located = baseOf(w, field), value = a[field], keys = field === "profissional" ? PROFESSIONAL_KEYS : TARGET_KEYS;
    const nameKey = field === "profissional" ? "professional_name" : "target_professional_name", refKey = field === "profissional" ? "professional_ref" : "target_professional_ref";
    // A7: a patch that leaves this professional alone keeps the open action's (a derived one is re-checked with the bases: keptBases).
    if (kept(w, field)) { keepPerson(w, field); return; }
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
    if (w.open && !located && row.id === w.open.fields[refKey]) { keepPerson(w, field); return; }
    const typed = typedChoice(w, field, refKey, row.id);
    if (typed === "MISMATCH") { clear(w, keys); return; }
    if (typed === "OK") {
      w.fields[refKey] = row.id; w.names[row.id] = row.name;
      remember({ id: row.id, name: row.name, tokens: nameWords(row.name, false), spans: [], proven: true });
      return;
    }
    const literal = await literalOf(w, field, row.name);
    if ("code" in literal) {
      if (literal.code === "AGENT_NAME_MISMATCH") { code(w, literal.code); nome(w, nameKey, literal.text); } else clear(w, keys, literal.code);
      return;
    }
    w.consumed.push(...literal.spans); w.claims.push(...literal.claims);
    const set = professionals.filter(item => nameHasTokens(literal.tokens, item.name)), text = said ?? spelled(literal.spans);
    if (!set.some(item => item.id === row.id)) { code(w, "AGENT_NAME_MISMATCH"); nome(w, nameKey, text); return; }
    remember({ id: row.id, name: row.name, tokens: literal.tokens, spans: literal.spans, proven: set.length === 1 });
    if (set.length === 1) {
      w.fields[refKey] = row.id; w.names[row.id] = row.name;
      if (literal.assumed) assume(w, field, literal.assumed, row.name);
      return;
    }
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
    // A7: a patch that leaves the appointment alone keeps the open action's origin facts and its appointment, re-read now (a stale one asks).
    const keptOrigin = kept(w, "atendimento");
    if (keptOrigin) {
      keepFields(w, [dateKey, timeKey]);
      if (w.open!.appointment) {
        const row = await reader.appointment(w.open!.appointment);
        if (!row || !["PENDING", "CONFIRMED"].includes(row.status) || row.startAt <= now) { ask(w, "AGENT_REF_STALE", "appointment_ref"); return; }
        w.appt = row; w.names[row.id] = apptLabel(row); w.origin = { expected: row.id, located: [row.id] };
        return;
      }
    } else if (a.atendimento) {
      const entry = binding.resolve(a.atendimento, "a");
      if (!entry) code(w, binding.entry(a.atendimento) ? "AGENT_REF_KIND" : "AGENT_REF_UNKNOWN");
      else {
        const row = await reader.appointment(entry.id);
        if (!row || !["PENDING", "CONFIRMED"].includes(row.status) || row.startAt <= now) code(w, "AGENT_REF_STALE"); else expected = row;
      }
    }
    // A7: a typed choice on the open action's appointment card is that row of the backend's card, never another one.
    const typed = expected ? typedChoice(w, "atendimento", "appointment_ref", expected.id) : undefined;
    if (typed === "MISMATCH") return;
    if (typed === "OK") { w.appt = expected; w.names[expected!.id] = apptLabel(expected!); w.origin = { expected: expected!.id, located: [expected!.id] }; return; }
    // The origin facts the owner wrote: the atendimento quote's single day and single open clock reading (never the model's coordinates).
    const fields: SchedulingFields = {};
    if (w.fields.customer_ref) fields.customer_ref = w.fields.customer_ref;
    if (w.fields.professional_ref) fields.professional_ref = w.fields.professional_ref;
    if (keptOrigin) for (const key of [dateKey, timeKey] as const) if (w.fields[key] !== undefined) fields[key] = w.fields[key];
    let quote: string | undefined;
    if (located?.code) code(w, located.code);
    if (located?.text && !located.code) {
      quote = located.text; w.consumed.push(located.span!);
      const day = dayOf(src.text, atoms, located.span!, change ? "source_date" : "date", a.operacao, timezone, now), clock = clockOf(src.text, atoms, located.span!, a.operacao, "only", timezone, now);
      if (day && day !== "UNREAD" && day.dates.length === 1) { fields[dateKey] = day.dates[0]; readAtoms(w, "origin", "date", day.atoms, day.dates[0]); }
      if (clock && clock !== "UNREAD") {
        const open = fields[dateKey] ? await openFor(clock.readings, "LOCATE", fields[dateKey]!, expected ? [expected.professionalId] : []) : clock.readings;
        if (open.length === 1) { fields[timeKey] = open[0]; readAtoms(w, "origin", "clock", [clock.atom], open[0]); }
      }
    }
    if (!keptOrigin) await clauseOrigin(w, fields, dateKey, timeKey, expected);
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
  /** A4: the origin facts the owner wrote in the action's own clause when the appointment's quote states none. The clause's undenied atoms,
   * outside the reason and any other action's clause; a change takes only those outside its destination bases that an origin preposition
   * governs ("de/do/da/dos/das": a destination never becomes an origin), a cancellation or a read all of them. One day and one clock with one
   * open reading go to the C4 locate; two candidates give nothing (the locate decides, with its card). The atoms used are consumed. */
  async function clauseOrigin(w: Work, fields: SchedulingFields, dateKey: "date" | "source_date", timeKey: "time" | "source_time", expected: AgentApptFact | undefined) {
    if (!w.own || fields[dateKey] && fields[timeKey]) return;
    // Only a clause that is this action's alone: another action's words inside it (or a shared segment) give no origin fact.
    if (w.codes.includes("AGENT_SCOPE_OVERLAP") || works.some(other => other !== w && other.quote && meets(other.quote, w.own!))) return;
    const change = w.a.operacao === "appointment.change", role = change ? "source_date" as const : "date" as const;
    const outside = [...change ? (["inicio", "fim", "dia"] as const).flatMap(field => { const item = baseOf(w, field); return item?.span ? [item.span] : []; }) : [], ...w.reason ? [w.reason] : []];
    const free = atoms.filter(atom => { const span: Span = [atom.start, atom.end];
      return !atom.negated && inside(span, w.own!) && !outside.some(item => meets(item, span)) && !rivals(w).some(other => meets(other.own!, span)) && (!change || originLed(span)); });
    const days = free.filter(atom => atom.kind === "date").map((atom): Span => [atom.start, atom.end]), clocks = free.filter(atom => atom.kind === "clock").map((atom): Span => [atom.start, atom.end]);
    if (!fields[dateKey] && days.length) {
      const read = new Set(days.map(span => { const day = dayOf(src.text, atoms, span, role, w.a.operacao, timezone, now); return day && day !== "UNREAD" && day.dates.length === 1 ? day.dates[0] : "?"; }));
      if (read.size === 1 && !read.has("?")) { const date = [...read][0]; fields[dateKey] = date; w.consumed.push(...days); readAtoms(w, "origin", "date", days, date); }
    }
    if (fields[timeKey] || clocks.length !== 1) return;
    const clock = clockOf(src.text, atoms, clocks[0], w.a.operacao, "only", timezone, now);
    if (!clock || clock === "UNREAD") return;
    const open = fields[dateKey] ? await openFor(clock.readings, "LOCATE", fields[dateKey]!, expected ? [expected.professionalId] : []) : clock.readings;
    if (open.length === 1) { fields[timeKey] = open[0]; w.consumed.push(clocks[0]); readAtoms(w, "origin", "clock", [clock.atom], open[0]); }
  }
  /** A4: an origin preposition (closed class) governs the atom: its own first word, or the word right before it. */
  function originLed(span: Span) {
    return /^(?:de|do|da|dos|das)\s/iu.test(src.text.slice(span[0], span[1])) || /(?:^|[^\p{L}\p{N}])(?:de|do|da|dos|das)[^\S\n]+$/iu.test(src.text.slice(0, span[0]));
  }

  // ================================================================ V16 services
  /** A7: the open action's services, kept as validated (their registered words for V5-E). */
  function keepServices(w: Work) {
    const open = w.open!;
    keepFields(w, SERVICE_KEYS);
    w.durationMin = open.durationMin;
    w.services = (open.serviceIds ?? []).map(id => { const row = services.find(item => item.id === id), name = row?.name ?? open.names[id] ?? "";
      return { id, name, tokens: nameWords(name, false), spans: [], mode: "LISTA" as const, durationMin: row?.durationMin ?? 0, claims: [], inherited: true as const }; });
  }
  async function servicesStep(w: Work) {
    const a = w.a, list = a.servicos, located = baseOf(w, "servicos");
    if (!list) { if (kept(w, "servicos")) keepServices(w); else unlistedServices(w); return; }
    if (located && located.base.tipo !== "DITO") { clear(w, SERVICE_KEYS, "AGENT_BASE_TYPE"); return; }
    if (located?.code) { clear(w, SERVICE_KEYS, located.code); return; }
    const booking = BOOKING.has(a.operacao), change = a.operacao === "appointment.change";
    if (booking && list.some(item => item.modo !== "LISTA") || !booking && !change && (list.length > 1 || list[0].modo !== "LISTA")) { clear(w, SERVICE_KEYS, "AGENT_SERVICE_MODE"); return; }
    // A7: a booking's open services named again with no words for them here stay as validated; a typed card choice is that row.
    const ids = list.map(item => binding.resolve(item.ref, "s")?.id), held = w.open?.serviceIds ?? [], first = ids[0];
    if (w.open && !located && booking && ids.length === held.length && ids.every(id => typeof id === "string" && held.includes(id))) { keepServices(w); return; }
    const typed = list.length === 1 && booking && typeof first === "string" && services.some(row => row.id === first) ? typedChoice(w, "servicos", "service_ref", first) : undefined;
    if (typed === "MISMATCH") { clear(w, SERVICE_KEYS); return; }
    if (typed === "OK") {
      const row = services.find(item => item.id === first)!;
      w.services = [{ id: row.id, name: row.name, tokens: nameWords(row.name, false), spans: [], mode: "LISTA", durationMin: row.durationMin, claims: [] }];
      w.durationMin = row.durationMin; w.fields.service_ref = row.id; w.names[row.id] = row.name;
      return;
    }
    const quoted = located?.text ? nameCore(located.text) : undefined, said = located?.text ? trimmedName(located.text) : undefined;
    const chosen: Service[] = [];
    for (const item of list) {
      const entry = binding.resolve(item.ref, "s"), row = entry ? services.find(service => service.id === entry.id) : undefined;
      if (!entry || !row) return servicesUnproven(w, said, !entry ? binding.entry(item.ref) ? "AGENT_REF_KIND" : "AGENT_REF_UNKNOWN" : "AGENT_REF_STALE");
      const own = nameTokens(withoutArticle(row.name)).filter(token => [...token].length >= AGENT_NAME_TOKEN_MIN);
      const found = quoted ? undefined : namedIn(w, row.name, "servicos"), tokens = quoted ? own.filter(token => quoted.includes(token)) : found!.tokens;
      if (!tokens.length) return servicesUnproven(w, said, "AGENT_NAME_MISMATCH");
      chosen.push({ id: row.id, name: row.name, tokens, spans: quoted ? [located!.span!] : found!.spans, mode: item.modo, durationMin: row.durationMin, claims: found?.claims ?? [] });
    }
    // A3: a word of the quote left over by every chosen service contradicts them only when it can name another service: close to a word of
    // the catalog that no chosen service has, or an item coordinated with a chosen service's word ("X e Y", "X, Y", "X + Y", "X com Y",
    // "X mais Y"). A verb or any other word is no service name; a professional's own name word is not one either. Back to the owner's words
    // (NOME), so prepare() resolves every service said and none is lost.
    const chosenWords = new Set(chosen.flatMap(item => nameTokens(item.name))), catalog = [...new Set(services.flatMap(row => nameTokens(row.name)))].filter(word => !chosenWords.has(word));
    const serviceWords = new Set(services.flatMap(row => nameTokens(row.name))), personWords = new Set(professionals.flatMap(row => nameTokens(row.name)).filter(word => !serviceWords.has(word)));
    const contradicts = (token: string) => !personWords.has(token) && (catalog.some(word => tokenSimilarity(token, word) >= SUGGESTION_THRESHOLD) || coordinated(located!.text!, token, chosenWords));
    if (quoted && quoted.some(token => !chosenWords.has(token) && contradicts(token))) return servicesUnproven(w, said, "AGENT_NAME_MISMATCH");
    for (const item of chosen) { w.consumed.push(...item.spans); w.claims.push(...item.claims); }
    // V7/V16 (S2, the specificity of the owner's words): S = the rows whose name holds every word the owner used for the chosen service; it
    // stands only when S is exactly it. A row holding those words and more (a more specific service, a combo with a part never said) fits the
    // owner's words as much, so the two are the owner's choice: never the one whose whole name was said, never the shorter one. A service a
    // change takes out (REMOVER/TROCAR) is one of the re-read appointment's own, so its S is over those.
    const appt = change ? w.appt : undefined;
    const ownRows: AgentNamed[] | undefined = appt ? appt.serviceIds.map((id, index) => ({ id, name: appt.serviceNames[index] ?? services.find(row => row.id === id)?.name ?? "" })) : undefined;
    const leaves = (item: Service) => change && (item.mode === "REMOVER" || item.mode === "TROCAR");
    const pool = (item: Service): readonly AgentNamed[] => leaves(item) ? ownRows ?? [] : services;
    const holdersOf = (item: Service, tokens: readonly string[]): AgentNamed[] => pool(item).filter(row => nameHasTokens(tokens, row.name));
    const holders = (item: Service) => holdersOf(item, item.tokens);
    // Fixer (review of S2 round 1): the owner's content words written beside a row that does not stand alone (ownWords). When the rows holding
    // ALL of them are exactly one and the owner wrote every word of its name (glue aside), that row stands in the model's place by its own ref
    // (the words are never searched as such); one with a word the owner never said is no such row (the D10 mirror): the card of the row's own
    // words; several are their card.
    const spoken = chosen.map(item => { const set = holders(item);
      return set.length > 1 && set.some(row => row.id === item.id) ? ownWords(w, item, new Set(set.flatMap(row => nameTokens(row.name)))) : undefined; });
    const fuller = (index: number) => { const words = spoken[index]; return words?.wider ? holdersOf(chosen[index], words.tokens) : []; };
    const whole = (row: AgentNamed, tokens: readonly string[]) => nameTokens(row.name).filter(token => !GLUE.has(token)).every(token => tokens.includes(token));
    chosen.forEach((item, index) => {
      const exact = fuller(index), words = spoken[index];
      if (exact.length !== 1 || !words || !whole(exact[0], words.tokens)) return;
      const row = exact[0];
      if (row.id !== item.id) code(w, "AGENT_NAME_MISMATCH");
      chosen[index] = { ...item, id: row.id, name: row.name, tokens: words.tokens, spans: words.spans, claims: [...item.claims, ...words.spans],
        durationMin: services.find(entry => entry.id === row.id)?.durationMin ?? item.durationMin };
      w.consumed.push(...words.spans); w.claims.push(...words.spans);
    });
    const stands = chosen.map(item => { const set = holders(item); return set.length === 1 && set[0].id === item.id; });
    /** The card of a loose row: the rows holding every word the owner wrote for it when they are several, else those holding its own words; and
     * the owner's words the C4 searches to show it (searchText: that search never finds fewer rows than the card). */
    const looseOf = (index: number) => {
      const item = chosen[index], exact = fuller(index), words = spoken[index] ?? ownWords(w, item, new Set<string>());
      return exact.length > 1 ? { rows: exact, text: searchText(exact, words.spans, words.tokens) } : { rows: holders(item), text: searchText(holders(item), words.found, item.tokens) };
    };
    if (change) {
      // The C4 alteration path takes every change (its combo guard included): a service that stands goes with its ref; any other one goes with
      // the owner's own words and no ref, so the C4 resolves them (its card of every holder; a service the appointment lacks is asked there).
      const refs = chosen.map((item, index) => stands[index] ? item.id : null);
      const names = chosen.map((item, index) => {
        if (stands[index]) { w.names[item.id] = item.name; return item.name; }
        code(w, leaves(item) && !ownRows?.some(row => row.id === item.id) ? "AGENT_SERVICE_MODE" : holders(item).length > 1 ? "AGENT_HOMONYM" : "AGENT_NAME_MISMATCH");
        return looseOf(index).text;
      });
      w.services = chosen;
      w.fields.service_changes = chosen.map((item, index) => ({ mode: item.mode === "INCLUIR" ? "INCLUDE" as const : item.mode === "LISTA" ? "SET" as const : "REMOVE" as const,
        service_name: names[index].slice(0, 200) }));
      w.fields.service_changes_ref = refs;
      return;
    }
    if (chosen.some((item, index) => !stands[index] && !holders(item).some(row => row.id === item.id))) { code(w, "AGENT_NAME_MISMATCH"); return servicesByName(w, said); }
    let loose = chosen.findIndex((_, index) => !stands[index]);
    // Micro P2 (specificity, flag SALON_SECRETARY_AGENT_MICRO): a booking's one service whose words several rows hold stands when the
    // professional the owner named (proven) performs exactly one of those rows and it is the model's: one compatible reading, said as a premise.
    if (loose >= 0 && agentMicroEnabled() && booking && chosen.length === 1 && w.professional?.proven && w.professional.id && w.fields.professional_ref === w.professional.id) {
      const pro = w.professional, rows = looseOf(loose).rows, done: AgentNamed[] = [];
      for (const row of rows) if ((await reader.performers([row.id])).some(item => item.id === pro.id)) done.push(row);
      if (done.length === 1 && done[0].id === chosen[0].id) {
        loose = -1;
        w.premises.push(`Considerei «${label(chosen[0].name)}» como serviço: é o único desses que ${label(pro.name ?? "")} faz.`);
      }
    }
    if (loose < 0) for (const item of chosen) w.names[item.id] = item.name;
    // Rules 9 and 11: a combo, a combo beside its part, or parts a registered combo joins are resolved by the C4's own combo path from the
    // owner's words (its cards), never here.
    const joins = chosen.length > 1 && services.some(row => isCombo(row.name) && comboParts(row.name).length === chosen.length &&
      comboParts(row.name).every(part => chosen.some(item => serviceNameKey(item.name) === serviceNameKey(part))));
    if (chosen.some(item => isCombo(item.name)) || comboWithOwnPart(chosen) || joins || said && comboParts(said).length > 1 && chosen.length === 1) {
      code(w, "AGENT_COMBO");
      return servicesByName(w, said ?? stretch(chosen.flatMap(item => item.spans)));
    }
    if (loose >= 0) {
      // Several holders of the owner's words: a card of them on a booking (prepare()'s own search of words every one of them holds); elsewhere
      // the owner's words.
      const { rows, text } = looseOf(loose);
      if (booking && chosen.length === 1 && rows.length <= CARD_MAX) { card(w, "service_ref", named(rows), "AGENT_HOMONYM"); w.fields.service_name = text; return; }
      code(w, "AGENT_HOMONYM");
      return servicesByName(w, said ?? (chosen.length === 1 ? text : stretch(chosen.flatMap(entry => entry.spans))));
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
  /** S2: the model's services fail to prove. A booking or a read goes back to the owner's words (servicesByName). A change cannot take a free
   * quote as its delta: when the owner did write the services (`said`, a located quote), the backend asks which services change instead of
   * proposing the change without them; with no words of the owner for them, nothing was asked of the services and they leave. */
  function servicesUnproven(w: Work, said: string | undefined, why: AgentValidatorCode) {
    code(w, why);
    if (w.a.operacao !== "appointment.change") return servicesByName(w, said);
    clear(w, SERVICE_KEYS);
    w.services = [];
    if (said) ask(w, why, "service_changes", AGENT_SERVICE_CHANGE_QUESTION);
  }
  /** S2: the owner's own words for one service beside a row that does not stand alone: its tokens found inside the spans that proved them, each
   * widened over the CONTENT words written right beside it (spaces only between; "de/da/do/dos/das" only between two of them) that are words of
   * a row holding those tokens ("massagem" + "modeladora"). Fixer (review of S2 round 1): a content word has ≥ 3 letters and is none of the
   * closed classes (glue such as "com", "na", "em", pronouns, first person, indefinites, agenda nouns, temporal words) nor a word of a person's
   * name this message can see; it lies in the action's admitted region, outside every temporal atom, unclaimed by another role and undenied.
   * `found`: the token spans; `spans`: those and the widened ones; `tokens`: all their words (folded); `wider`: some word was added. The words
   * are never searched as such: a row is taken only as the one row holding them that they name whole; a card is shown through searchText. */
  function ownWords(w: Work, item: Service, rowWords: ReadonlySet<string>): { found: Span[]; spans: Span[]; tokens: string[]; wider: boolean } {
    const found = item.tokens.flatMap(token => literalSpans(src.text, token).filter(span => withinOne(src, span) && item.spans.some(region => inside(span, region))));
    const taken = claimed(w, "servicos"), mine = new Set(w.customer?.tokens ?? []);
    const content = (index: number) => {
      const entry = wordList[index];
      if (!entry || !w.own) return false;
      const span: Span = [entry.start, entry.end], word = entry.word;
      return [...word].length >= AGENT_NAME_TOKEN_MIN && rowWords.has(word) && !GLUE.has(word) && !PRONOUNS.has(word) && !FIRST_PERSON.has(word) && !INDEFINITE.has(word) &&
        !APPT_WORDS.has(word) && !temporalWord(word) && !peopleWords.has(word) && !mine.has(word) && withinOne(src, span) && span[0] >= w.own[0] && admits(w, span, false) &&
        !atoms.some(atom => meets([atom.start, atom.end], span)) && !taken.some(other => meets(other, span)) && !entityQuoteDenied(src.text, span[0], span[1], w.a.operacao);
    };
    const joined = (left: number) => left >= 0 && left + 1 < wordList.length && /^[^\S\n]+$/u.test(src.text.slice(wordList[left].end, wordList[left + 1].start));
    const link = (index: number) => ["de", "da", "do", "dos", "das"].includes(wordList[index]?.word ?? "");
    const spans: Span[] = [...found], tokens = new Set(item.tokens);
    let wider = false;
    const take = (from: number, to: number, index: number) => {
      spans.push([wordList[from].start, wordList[to].end]); wider ||= !tokens.has(wordList[index].word); tokens.add(wordList[index].word); };
    for (const span of found) {
      const at = wordList.findIndex(entry => entry.start === span[0]);
      if (at < 0) continue;
      // Forward, then backward: the content word straight beside, or the one past a de/da/do between two content words.
      for (let from = at; joined(from);) {
        const next = from + 1;
        if (link(next) && joined(next) && content(next + 1)) { take(next, next + 1, next + 1); from = next + 1; }
        else if (content(next)) { take(next, next, next); from = next; }
        else break;
      }
      for (let from = at; joined(from - 1);) {
        const prior = from - 1;
        if (link(prior) && joined(prior - 1) && content(prior - 1)) { take(prior - 1, prior, prior - 1); from = prior - 1; }
        else if (content(prior)) { take(prior, prior, prior); from = prior; }
        else break;
      }
    }
    return { found, spans, tokens: [...tokens], wider };
  }
  /** Fixer: the owner's words the C4 searches (prepare()'s or the alteration's substring search) to show the card of `rows`: their written text
   * when every row's name holds it as written, else the first single word of them every row holds as written (each found or widened word is a
   * whole word of every such row). That search then finds every row of the card: a card is never narrowed to one row by the words' form. */
  function searchText(rows: readonly AgentNamed[], spans: readonly Span[], tokens: readonly string[]) {
    const holds = (text: string) => { const folded = foldName(text.trim()); return folded.length >= 2 && rows.every(row => foldName(row.name).includes(folded)); };
    const text = spelled(spans);
    if (holds(text)) return text;
    const single = [...spans].sort((x, y) => x[0] - y[0]).map(span => src.text.slice(span[0], span[1])).filter(piece => !/\s/u.test(piece));
    return single.find(holds) ?? tokens.find(holds) ?? text;
  }
  /** Fixer (V15 for services, review of S2 round 1): a change whose plan names no service while its own clause holds catalog words naming only
   * services the re-read appointment does not hold (no field took them; outside every base, the other roles, the temporal atoms and any denial):
   * the owner asked a service change the plan left out. Asked, never proposed without it. Words of the appointment's own services may only
   * point at the appointment, so they stay as they are. */
  function unlistedServices(w: Work) {
    if (unlistedWords(w)) ask(w, "AGENT_COVERAGE", "service_changes", AGENT_SERVICE_CHANGE_QUESTION);
  }
  /** Round 2, F0: the clause holds such catalog words (unlistedServices; also read when the plan's services did not stand). */
  function unlistedWords(w: Work) {
    if (w.a.operacao !== "appointment.change" || !w.appt || !w.own) return false;
    const held = new Set(w.appt.serviceNames.flatMap(name => nameTokens(name)));
    const taken = [...claimed(w, "servicos"), ...w.consumed, ...[...w.bases.values()].flatMap(item => item.span ? [item.span] : [])];
    const words = [...serviceTokens].filter(word => [...word].length >= AGENT_NAME_TOKEN_MIN && !GLUE.has(word) && !temporalWord(word) && !APPT_WORDS.has(word) &&
      !peopleWords.has(word) && !held.has(word));
    return words.some(word => literalSpans(src.text, word).some(span => withinOne(src, span) && inside(span, w.own!) && admits(w, span, false) &&
      !atoms.some(atom => meets([atom.start, atom.end], span)) && !taken.some(item => meets(item, span)) && !entityQuoteDenied(src.text, span[0], span[1], w.a.operacao)));
  }

  // ================================================================ time
  async function staffOf(w: Work) {
    if (w.fields.professional_ref) return [w.fields.professional_ref];
    return w.services.length ? (await reader.performers(w.services.map(item => item.id))).map(item => item.id) : professionals.map(item => item.id);
  }
  /** The day of an action whose start quote states none: the accepted `dia`, else the one reading of the days written in its own segment,
   * else the one day said once outside every clause (region c). Never an anchor's or the model's, and never a day the owner excluded (negated,
   * inside an EXCECAO quote of the plan, or after an exclusion lead). */
  function fallbackDay(w: Work, operation: string): { dates: string[]; spans: Span[] } | undefined {
    if (w.date) return { dates: [w.date], spans: [] };
    // Round 2 (F1): a change never reads its new day from the atoms that found its appointment (destination).
    const free = destination(w);
    // S1c: a DITO `dia` base of a plan with no `dia` value is never read (dayStep) and hides nothing: its day is read as if it had no base. A
    // refused one (its quote negated) or one of another type (EXCECAO: a day excluded) still hides its day, so it never becomes the start's.
    const used = [...w.bases.entries()].filter(([field, item]) => field !== "dia" || !!w.a.dia || !!item.code || item.base.tipo !== "DITO")
      .flatMap(([, item]) => item.span ? [item.span] : []);
    const excepted = works.flatMap(other => [...other.bases.values()].flatMap(item => item.base.tipo === "EXCECAO" && item.span ? [item.span] : []));
    const readable = (atom: Atom) => !atom.negated && !excepted.some(span => meets(span, [atom.start, atom.end])) && !excludedDay(src.text, atom);
    const read = (list: Atom[]) => {
      const dates = new Set(list.flatMap(atom => { const day = dayOf(src.text, free, [atom.start, atom.end], "date", operation, timezone, now);
        return day && day !== "UNREAD" && day.dates.length === 1 ? day.dates : ["UNREAD"]; }));
      return dates.size === 1 && !dates.has("UNREAD") ? { dates: [...dates], spans: list.map((atom): Span => [atom.start, atom.end]) } : undefined;
    };
    const mine = free.filter(atom => atom.kind === "date" && inside([atom.start, atom.end], w.own!) && readable(atom) && !used.some(span => meets(span, [atom.start, atom.end])));
    if (mine.length) return read(mine);
    const shared = free.filter(atom => atom.kind === "date" && readable(atom) && !ownSpans().some(own => meets(own, [atom.start, atom.end])) && admits(w, [atom.start, atom.end], true));
    if (!shared.length && agentMicroEnabled()) { const head = headDay(w, free, readable); if (head) return read([head]); }
    return shared.length ? read(shared) : undefined;
  }
  /** Micro P2 (temporal proofs, flag SALON_SECRETARY_AGENT_MICRO): the day that opens a sentence (only glue before it) frames the coordinated
   * actions after it in that sentence: an action of the same operation as the one whose clause it opens, whose own clause states no day and no
   * negator or alterity word, when that day is the only day atom from the sentence's start to the end of this clause, readable (undenied, not
   * excepted) and singling nobody out; never on a cancellation or a block (high risk, decision 14). */
  function headDay(w: Work, free: readonly Atom[], readable: (atom: Atom) => boolean): Atom | undefined {
    if (!w.own || !SHARED_OPERATIONS.has(w.a.operacao) || words(src.text.slice(w.own[0], w.own[1])).some(word => NOT_SHARED.has(word))) return undefined;
    const start = Math.max(0, ...[...src.text.slice(0, w.own[0]).matchAll(/[.!?;\n]/g)].map(match => match.index! + 1));
    const days = atoms.filter(atom => atom.kind === "date" && atom.start >= start && atom.end <= w.own![1]), head = days[0];
    if (days.length !== 1 || !free.includes(head) || !readable(head) || wordList.some(item => item.start >= start && item.end <= head.start && !GLUE.has(item.word))) return undefined;
    const opener = works.find(other => other !== w && other.own && inside([head.start, head.end], other.own) && other.own[1] <= w.own![0] && other.a.operacao === w.a.operacao);
    return opener && !singlesOut(src.text, [head.start, head.end], []) ? head : undefined;
  }
  /** Round 2 (F1; A1, one atom one role): the atoms a change's destination may read: never one its origin read (the appointment's own day or
   * clock written in the same quote as the new one: "de sexta passa pro sábado às 10"; "troca a escova de terça", where terça only finds the
   * appointment). Its day or clock is then the appointment's own, which an empty field keeps. Any other operation reads every atom. */
  function destination(w: Work) {
    return w.a.operacao !== "appointment.change" ? atoms : atoms.filter(atom => !w.reads.some(item => item.role === "origin" && item.atom[0] === atom.start && item.atom[1] === atom.end));
  }
  /** The atoms a change's destination reads in `span`, the origin's left out (A1's code when the quote held one). */
  function destinationIn(w: Work, span: Span) {
    const free = destination(w);
    if (free.length < atoms.length && atoms.some(atom => !free.includes(atom) && meets([atom.start, atom.end], span))) code(w, "AGENT_QUOTE_REUSED");
    return free;
  }
  function dayStep(w: Work) {
    const a = w.a;
    if (!a.dia) return;
    const located = baseOf(w, "dia");
    if (!located || located.code || located.base.tipo !== "DITO") { clear(w, ["date"], located?.code ?? "AGENT_BASE_TYPE"); return; }
    const day = dayOf(src.text, destinationIn(w, located.span!), located.span!, "date", a.operacao, timezone, now);
    if (!day || day === "UNREAD" || day.dates.length !== 1 || day.dates[0] !== a.dia || a.operacao === "appointment.cancel" && w.fields.date && w.fields.date !== a.dia) {
      clear(w, ["date"], "AGENT_TEMPORAL_READING"); return;
    }
    w.consumed.push(located.span!);
    w.date = a.dia; w.fields.date = a.dia;
    readAtoms(w, "day", "date", day.atoms, a.dia);
  }
  async function startStep(w: Work) {
    const a = w.a;
    // A7: a patch that leaves its start alone keeps the open action's clock and, without a new day, its day (a cancellation's are origin facts).
    if (!a.inicio && kept(w, "inicio") && a.operacao !== "appointment.cancel") {
      keepFields(w, kept(w, "dia") ? ["date", "time", "period"] : ["time", "period"]);
      w.date = w.fields.date; w.time = w.fields.time;
      return;
    }
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
    // Round 2, F1: an anchor on the appointment this very change moves anchors nothing (V12 never takes it): its quote stands only as the
    // owner's own words for the start, a kept clock when it proves the keep (V11), else the day and clock it states (V9, as DITO).
    const own = type === "ANCORA" && ownAnchor(w, located), keep = (type === "MANTIDO" || own) && keepProven(w, located), literal = type === "DITO" || own && !keep;
    // The day: the day words of the start quote (DITO; a keep or an anchor on the moved appointment: the day the owner wrote beside it), else the
    // fallback; an anchor on another row and the kept appointment never give a day. A patch whose quote states no day (or no clock) keeps the
    // open action's, validated before, when the plan repeats it (A7).
    let days: string[] | undefined, read: Span[] = [], clock: ReturnType<typeof clockOf>;
    if (type !== "ANCORA" || own) {
      const free = destinationIn(w, located.span!), day = dayOf(src.text, free, located.span!, "date", a.operacao, timezone, now);
      if (day === "UNREAD") { clear(w, ["date", "time"], "AGENT_TEMPORAL_READING"); return; }
      days = day?.dates; read = day?.atoms ?? [];
      if (literal) {
        clock = clockOf(src.text, free, located.span!, a.operacao, a.operacao === "schedule.block" ? "first" : "only", timezone, now);
        w.consumed.push(located.span!);
      } else w.consumed.push(...read);
    }
    if (!days) {
      const fallback = fallbackDay(w, a.operacao);
      if (fallback) { days = fallback.dates; read = fallback.spans; w.consumed.push(...fallback.spans); }
    }
    if (!days && w.open?.fields.date === date) days = [date];
    if (!days) clear(w, ["date"], "AGENT_DAY_MISSING");
    else if (days.length !== 1 || days[0] !== date) clear(w, ["date"], "AGENT_TEMPORAL_READING");
    else { w.date = date; w.fields.date = date; readAtoms(w, "start", "date", read, date); }
    if (type === "MANTIDO" || keep) return keptTime(w, located, time, keep);
    if (type === "ANCORA" && !own) return anchorTime(w, located, time);
    if (clock === undefined && w.open?.fields.time === time) { w.time = time; w.fields.time = time; return; }
    if (clock === undefined) { clear(w, ["time"], a.operacao === "appointment.change" ? "AGENT_KEEP_UNPROVEN" : "AGENT_TEMPORAL_READING"); return; }
    if (clock === "UNREAD") { clear(w, ["time"], "AGENT_TEMPORAL_READING"); return; }
    const accepted = await pickClock(w, "time", clock.readings, time, a.operacao === "schedule.block" ? "BLOCK_START" : "BOOK", located.text!, undefined, clock.atom);
    if (accepted) { w.time = accepted; w.fields.time = accepted; readAtoms(w, "start", "clock", [clock.atom], accepted); }
  }
  /** V9: the model's clock must be one reading of the owner's words; two readings open in the day's real hours (or unknown hours) are the
   * C4's half-day card; exactly one open is used and said (owner decision 18). */
  async function pickClock(w: Work, field: "time" | "end_time", readings: string[], value: string, purpose: DaypartPurpose, expression: string, other?: string, atom?: Span) {
    if (!readings.includes(value)) { clear(w, [field], "AGENT_TEMPORAL_READING"); return; }
    if (readings.length === 1) return value;
    // Round 2 (F1): a change whose new day the owner's words leave as the appointment's (F0 asks no day: newDayAsked) lands on that day
    // (prepare() keeps it): its clock's open readings are that day's, for the appointment's own professional (anyone of the team while a new
    // one is asked) and its duration. Review C1/C4: never when the owner wrote another day, and never for a duration ("em 1h", "2h"): an
    // amount of time is no clock of that day (the half-day stays asked).
    const appt = w.a.operacao === "appointment.change" && !w.date && w.appt && !newDayAsked(w) && !(atom && duration(atom)) ? w.appt : undefined;
    const open = w.date ? await openFor(readings, purpose, w.date, await staffOf(w), { duration: w.durationMin, other })
      : appt ? await openFor(readings, purpose, appt.startLocal.slice(0, 10), w.a.novo_profissional || targetAsked(w) ? professionals.map(item => item.id) : [appt.professionalId],
        { duration: spanMinutes(appt.startLocal, appt.endLocal), other }) : readings;
    if (open.length === 1) {
      if (open[0] !== value) { clear(w, [field], "AGENT_TEMPORAL_READING"); return; }
      code(w, "AGENT_DAYPART_ONE"); daypartPremise(w, field, value);
      return value;
    }
    const [early, late] = [...readings].sort();
    w.ambiguities.push({ field, kind: "CLOCK_DAYPART", expression: expression.slice(0, 600), candidates: [early, late] });
    clear(w, [field], "AGENT_DAYPART_ASK");
    if (w.status !== "DROP") w.status = "ASK";
  }
  /** Owner decision 18's premise, one per clock (A8): an end read against a start that is already resolved says nothing apart; when that start
   * was itself the one reading, the two are one interval premise. */
  function daypartPremise(w: Work, field: "time" | "end_time", value: string) {
    if (field === "end_time" && w.time) {
      const start = w.clockPremises.start;
      if (!start) return;
      const merged = `Considerei ${formatClock(w.time)}–${formatClock(value)}: é a única leitura desses horários dentro do expediente.`;
      w.premises = w.premises.map(text => text === start ? merged : text); w.clockPremises = { start: merged, unmerged: start };
      return;
    }
    const text = `Considerei ${formatClock(value)}: é a única leitura desse horário dentro do expediente.`;
    if (field === "time") w.clockPremises = { start: text };
    w.premises.push(text);
  }
  /** V11: the structural proof of "mantém/mesmo horário" (selfReferenceProven) on the quote, or (round 2) on one of its pieces between clause
   * marks when the quote also holds the new day (a weekday, a comma, then the keep); only for a change with its appointment re-read, and never
   * over a new clock the quote states (that clock is the owner's, never the kept one; the clock that found the appointment is not one). */
  function keepProven(w: Work, located: Located) {
    const span = located.span;
    if (w.a.operacao !== "appointment.change" || !w.appt || !span || located.code || destination(w).some(atom => atom.kind === "clock" && meets([atom.start, atom.end], span))) return false;
    const holder = { customer: w.customer?.tokens.join(" ") || null, others: [] as string[] }, pieces: Span[] = [span];
    let from = span[0];
    for (const mark of src.text.slice(span[0], span[1]).matchAll(/[,.;!?()\n]/g)) { pieces.push([from, span[0] + mark.index!]); from = span[0] + mark.index! + 1; }
    if (pieces.length > 1) pieces.push([from, span[1]]);
    return pieces.some(([start, end]) => {
      const text = src.text.slice(start, end), lead = text.length - text.trimStart().length, piece: Span = [start + lead, start + lead + text.trim().length];
      return piece[1] > piece[0] && selfReferenceProven(src.text, src.text.slice(piece[0], piece[1]), piece, w.a.operacao, timezone, now, "time", false, holder);
    });
  }
  /** V11 MANTIDO: only a change, with the structural proof of "mantém/mesmo horário" (keepProven); the value is the re-read appointment's own clock. */
  function keptTime(w: Work, located: Located, value: string, proven: boolean) {
    if (!proven || !w.appt) { clear(w, ["time"], "AGENT_KEEP_UNPROVEN"); return; }
    const current = w.appt.startLocal.slice(11, 16);
    if (current !== value) { clear(w, ["time"], "AGENT_KEEP_UNPROVEN"); return; }
    w.consumed.push(located.span!);
    w.time = current; w.fields.time = current;
    w.basis.push({ type: "MANTIDO", appointment: w.appt.id, revision: w.appt.revision, time: current });
    w.premises.push(`Mantive o horário atual (${formatClock(current)}).`);
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
    // A7: a patch that leaves the end alone keeps the open action's.
    if (!a.fim && kept(w, "fim")) { keepFields(w, ["end_time", "end_date"]); w.endTime = w.fields.end_time; w.endDate = w.fields.end_date ?? (w.endTime ? w.date : undefined); return; }
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
    if (!clock && w.open?.fields.end_time === time) { w.endDate = date; w.endTime = time; w.fields.end_time = time; if (date !== w.date) w.fields.end_date = date; return; }
    if (!clock || clock === "UNREAD") { clear(w, keys, clock ? "AGENT_TEMPORAL_READING" : "AGENT_END_MISSING"); return; }
    const accepted = await pickClock(w, "end_time", clock.readings, time, "BLOCK_END", located.text!, w.time);
    if (!accepted) return;
    w.endDate = date; w.endTime = accepted; w.fields.end_time = accepted;
    if (date !== w.date) w.fields.end_date = date;
    readAtoms(w, "end", "clock", [clock.atom], accepted);
    if (day && !shared) readAtoms(w, "end", "date", day.atoms, date);
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
    const serviceIds = target ? w.appt?.serviceIds : w.services.map(item => item.id), start = startOf(w, target);
    clear(w, keys);
    // S1c (the C4 released-slot rule): the slot a cancellation or change of the plan frees owns the day, the clock and the professional of the
    // create that takes it (agentDerivedCheck; the pair's gate): never V8's pick, card or question.
    if (!target && w.derived?.type === "LIBERADO_POR") return;
    // A7: a patch's own NAO_DITO stands over a person its open action held only when the clause asks another one (bases): that one is no option
    // (null: held by the owner's words only), and nobody is derived in its place (a card of who can).
    const replaced = type === "NAO_DITO" && !located.inherited && w.open && personHeld(w.open, field) ? w.open.fields[kind] ?? null : undefined;
    // A7: a delegation the owner made before, re-derived for a patch's new ground, carries no quote of this message (it was marked then).
    const unmarked = type === "DELEGADO" && !located.inherited && !delegationMarked(w, located);
    // Review C3: a change whose new start is not proven yet (startOf) has nobody "free then": the card of who performs its services (never a
    // pick, never derived); the start is asked after it (F0, temporalMissing) and prepare() checks the one chosen there.
    if (target && w.appt && serviceIds?.length && !start) {
      const set = (await reader.performers(serviceIds)).filter(row => row.id !== w.appt!.professionalId && row.id !== replaced);
      if (!set.length) { ask(w, "AGENT_TARGET_UNSAID", kind); return; }
      card(w, kind, named(set), unmarked ? "AGENT_DELEGATION_UNMARKED" : type === "NAO_DITO" ? "AGENT_TARGET_UNSAID" : "AGENT_DELEGATION_TIE"); return;
    }
    if (!serviceIds?.length || !start) { if (target) ask(w, "AGENT_TARGET_UNSAID", kind); else code(w, "AGENT_PROFESSIONAL_UNSAID"); return; }
    // E: who performs every service and is free at the start, over the whole team (a change's new professional is someone else). Review M4:
    // never one an action of this plan run before this one already books or moves onto that time.
    const minutes = target && w.appt ? spanMinutes(w.appt.startLocal, w.appt.endLocal) : w.durationMin ?? 0;
    const set = (await eligible(serviceIds, start)).filter(row => (!target || row.id !== w.appt?.professionalId) && row.id !== replaced && !plannedBusy(w, row.id, start, minutes));
    if (type === "NAO_DITO" || unmarked) {
      const why: AgentValidatorCode = unmarked ? "AGENT_DELEGATION_UNMARKED" : target ? "AGENT_TARGET_UNSAID" : "AGENT_PROFESSIONAL_UNSAID";
      if (!set.length) { code(w, why); ask(w, target ? "AGENT_TARGET_UNSAID" : "AGENT_DELEGATION_NONE", kind); return; }
      // Round 2, F2: a delegation without its marker is the professional not said (spec V8), so the salon's data decide alike: exactly one who
      // performs the services and is free then is proposed with the backend's premise (owner decision 14, low risk; V23 `sole`); two or more
      // are the card, and so is a model's value that is not that one (as for a marked delegation). A high-risk action never derives anyone.
      const agrees = a[field] === null || binding.resolve(a[field]!, "p")?.id === set[0]?.id;
      if (replaced === undefined && set.length === 1 && agrees && derivable(w, field, located, set[0].id) && !await highRisk(w, 0)) {
        if (unmarked) code(w, why);
        derived(w, field, set[0], serviceIds, start); return;
      }
      card(w, kind, named(set), why); return;
    }
    if (located.span) w.consumed.push(located.span);
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
    // A2 (S2): the backend's own pick (the one least busy performer free then) stands when the model left the delegated field empty; a model
    // value that is not that pick is a card, never taken.
    if (pick.length !== 1 || !located.inherited && value !== null && pick[0].id !== chosen) { card(w, kind, named(pick), "AGENT_DELEGATION_TIE"); return; }
    const row = pick[0];
    w.fields[kind] = row.id; w.names[row.id] = row.name; w.cleared.delete(kind);
    // Its registered words: a negated mention of the one picked asks (V5-E), never a pick against the owner's words.
    const entity: Entity = { id: row.id, name: row.name, tokens: nameWords(row.name, false), spans: located.span ? [located.span] : [], proven: true };
    if (target) w.target = entity; else w.professional = entity;
    w.basis.push({ type: "DELEGADO", field, chosen: row.id, set: set.map(item => item.id), counts, start, services: [...serviceIds], ...target && w.appt ? { exclude: w.appt.professionalId } : {} });
    const what = listText((target ? w.appt?.serviceNames ?? [] : w.services.map(item => item.name)).map(name => label(name)));
    w.premises.push(set.length > 1 ? `Escolhi ${label(row.name)} para ${what}: faz o serviço, está livre às ${formatClock(start.slice(11, 16))} e tem menos atendimentos no dia (${counts[row.id]}).`
      : `Escolhi ${label(row.name)} para ${what}: é quem faz o serviço e está livre às ${formatClock(start.slice(11, 16))}.`);
  }
  /** A2 (owner decision 14): a professional the owner did not name is derived only for a booking, or for a change whose own clause asks
   * another professional (asksAnother) or that the owner delegated earlier (a patch); never for a block or a read of free times, and never when
   * the owner's words this action reads (its clause and the later parts no other action's clause holds, V4 (a)/(b)) or that no other action
   * reads name, or nearly name, another professional (the owner's word stays a card). */
  function derivable(w: Work, field: "profissional" | "novo_profissional", located: Located, chosen: string) {
    const a = w.a, booking = a.operacao === "appointment.create" && field === "profissional", change = a.operacao === "appointment.change" && field === "novo_profissional";
    if (!booking && !change || !w.own) return false;
    if (change && !located.inherited && !asksAnother(w)) return false;
    const region = wordList.filter(item => { const span: Span = [item.start, item.end];
      return !atoms.some(atom => meets([atom.start, atom.end], span)) && (admits(w, span, false) || !rivals(w).some(other => admits(other, span, false))); });
    const others = professionals.filter(item => item.id !== chosen).flatMap(item => nameWords(item.name, false));
    if (region.some(item => [...item.word].length >= AGENT_NAME_TOKEN_MIN && !GLUE.has(item.word) && !w.claims.some(span => meets(span, [item.start, item.end])) &&
      others.some(token => tokenSimilarity(item.word, token) >= SUGGESTION_THRESHOLD))) return false;
    // Settle (test report P5): nor past a name nothing proved: a capitalized word (never one opening a sentence, nor in a message with no
    // lowercase letter) that no closed class, no registered professional or service, no customer this message showed and no person an action
    // of the plan proved holds may be the professional the owner meant (an unregistered one): the card stays.
    const customer = baseOf(w, "cliente")?.span, said = new Set([...nameTokens(w.fields.customer_name ?? ""), ...w.customer?.tokens ?? [],
      ...binding.entries("c").flatMap(entry => nameTokens(String((entry.facts as { shown?: string }).shown ?? "")))]);
    return !/\p{Ll}/u.test(src.text) || !region.some(item => { const span: Span = [item.start, item.end], word = item.word;
      return /^\p{Lu}/u.test(src.text.slice(item.start, item.end)) && !opening(item.start) && !works.some(v => v.claims.some(claim => meets(claim, span))) && !(customer && meets(customer, span)) &&
        !said.has(word) && !GLUE.has(word) && !PRONOUNS.has(word) && !FIRST_PERSON.has(word) && !INDEFINITE.has(word) && !APPT_WORDS.has(word) && !temporalWord(word) &&
        !CLOSED_WORDS.has(word) && !HONORIFICS.has(word) && !directoryTokens.has(word); });
  }
  /** S1c (V13, the released-slot rule): a create in the slot a cancellation or change frees takes that slot's professional (agentDerivedCheck,
   * the pair's gate) only while the owner's words do not contradict it: no professional but the slot's named, or nearly named, in the
   * create's region (derivable's: its own clause and the later parts no other action reads; undenied, unclaimed, outside temporal atoms),
   * and the slot's professional denied nowhere in the message (V5-E's reading). Otherwise the slot proves nothing of this create: its derived
   * values leave and the backend asks (never the slot's professional over the owner's word, never one the owner refused). The slot's
   * professional is the freed appointment's (this plan's releaser, else the open plan's, re-read), else the one the releaser names; unknown,
   * every professional counts. */
  async function releasedProfessional(w: Work) {
    if (w.derived?.type !== "LIBERADO_POR" || w.a.operacao !== "appointment.create") return;
    const key = w.a.ocupa_horario_de ?? w.derived.keys[0], releaser = works.find(other => other.a.chave === key), open = key ? openByKey.get(key) : undefined;
    const freed = releaser?.appt ?? (open?.appointment ? await reader.appointment(open.appointment) : undefined);
    const slot = freed?.professionalId ?? releaser?.fields.professional_ref ?? open?.fields.professional_ref;
    const excepted = [...w.bases.values()].flatMap(item => item.base.tipo === "EXCECAO" && item.span ? [item.span] : []);
    const denied = (span: Span) => !excepted.some(item => meets(item, span)) && entityQuoteDenied(src.text, span[0], span[1], w.a.operacao);
    const others = professionals.filter(item => item.id !== slot).flatMap(item => nameWords(item.name, false));
    const named = wordList.some(item => { const span: Span = [item.start, item.end];
      return [...item.word].length >= AGENT_NAME_TOKEN_MIN && !GLUE.has(item.word) && !w.claims.some(claim => meets(claim, span)) && !atoms.some(atom => meets([atom.start, atom.end], span)) &&
        (admits(w, span, false) || !rivals(w).some(other => admits(other, span, false))) && others.some(token => tokenSimilarity(item.word, token) >= SUGGESTION_THRESHOLD) && !denied(span); });
    const refused = professionals.filter(item => !slot || item.id === slot).flatMap(item => nameWords(item.name, false))
      .some(token => literalSpans(src.text, token).some(span => withinOne(src, span) && denied(span)));
    if (!named && !refused) return;
    w.derived = undefined;
    clear(w, ["date", "time"]);
    ask(w, "AGENT_RELEASE_MISMATCH", w.fields.professional_ref || w.fields.professional_name ? null : "professional_ref");
  }
  /** A2: the action's own clause asks another person than the one it has or would keep: an undenied alterity word (closed class) outside every
   * temporal atom that qualifies no time and no agenda row (rowWord: "outro" before its noun, "diferente" on either side). */
  function asksAnother(w: Work) {
    return wordList.some((item, index) => ALTERITY.has(item.word) && inside([item.start, item.end], w.own!) && !atoms.some(atom => meets([atom.start, atom.end], [item.start, item.end])) &&
      !entityQuoteDenied(src.text, item.start, item.end, w.a.operacao) && !rowWord(wordList[index + 1]?.word ?? "") &&
      !(item.word.startsWith("diferente") && rowWord(wordList[index - 1]?.word ?? "")));
  }
  /** A2: the one professional who performs every service and is free then, shown as a backend premise and re-checked at the Confirmar (V23
   * `sole`: still the only one, else the group is held). */
  function derived(w: Work, field: "profissional" | "novo_profissional", row: AgentNamed, serviceIds: readonly string[], start: string) {
    const target = field === "novo_profissional", kind = target ? "target_professional_ref" as const : "professional_ref" as const;
    code(w, "AGENT_PROFESSIONAL_DERIVED");
    w.fields[kind] = row.id; w.names[row.id] = row.name; w.cleared.delete(kind);
    const entity: Entity = { id: row.id, name: row.name, tokens: nameWords(row.name, false), spans: [], proven: true };
    if (target) w.target = entity; else w.professional = entity;
    w.basis.push({ type: "DELEGADO", field, chosen: row.id, set: [row.id], counts: {}, start, services: [...serviceIds], sole: true, ...target && w.appt ? { exclude: w.appt.professionalId } : {} });
    const what = listText((target ? w.appt?.serviceNames ?? [] : w.services.map(item => item.name)).map(name => label(name)));
    w.premises.push(`${label(row.name)}: é quem faz ${what} e está livre às ${formatClock(start.slice(11, 16))}.`);
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
  /** V8's start for who is free then: the action's proven day and clock; for a change's new professional also the appointment's own day with
   * the new clock when the owner's words give no other day (prepare() keeps that day), or its own slot when they give neither a day nor a
   * clock (an alteration keeps the slot). Review C3: undefined while the change's new start is not proven (a day or clock F0 asks, a half-day
   * still open, a day without its clock), never the old slot in its place. */
  function startOf(w: Work, target: boolean) {
    if (w.date && w.time) return `${w.date}T${w.time}`;
    const row = target ? w.appt : undefined;
    if (!row || w.date || newDayAsked(w) || w.ambiguities.some(item => item.field === "time")) return undefined;
    if (w.time) return `${row.startLocal.slice(0, 10)}T${w.time}`;
    return newClockAsked(w) ? undefined : row.startLocal;
  }
  /** Review M4: the slot an action of the plan takes when it runs (a booking's; a change's new one, on the appointment's own day when the
   * owner's words give no other) and its professional; undefined while unknown. */
  function planSlot(v: Work) {
    const change = v.a.operacao === "appointment.change";
    if (!change && v.a.operacao !== "appointment.create" || !v.fields.time) return undefined;
    const date = v.fields.date ?? (change && v.appt && !newDayAsked(v) ? v.appt.startLocal.slice(0, 10) : undefined);
    const professional = change ? v.fields.target_professional_ref ?? v.appt?.professionalId : v.fields.professional_ref;
    if (!date || !professional) return undefined;
    const start = `${date}T${v.fields.time}`, minutes = v.durationMin ?? (v.appt ? spanMinutes(v.appt.startLocal, v.appt.endLocal) : 0);
    return { professional, start, end: shift(start, Math.max(1, minutes)) };
  }
  /** Review M4: an action of the plan run before `w` (execution order) already takes that professional's time then (V8's set leaves them out,
   * so "Confirmar tudo" never writes the second booking over the first). */
  function plannedBusy(w: Work, professionalId: string, start: string, minutes: number) {
    const mine = rank.get(w.a.chave) ?? 0, end = shift(start, Math.max(1, minutes));
    return live().some(other => { if (other === w || (rank.get(other.a.chave) ?? 0) >= mine) return false;
      const slot = planSlot(other); return !!slot && slot.professional === professionalId && slot.start < end && slot.end > start; });
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

  // ================================================================ A1: one temporal atom, one role
  /** One clock atom of the owner's words proves one clock role of an action (the appointment's origin, the start, a block's end): every later
   * role that read it loses that value, which prepare() asks (AGENT_QUOTE_REUSED: a destination never takes the origin's clock, an end never
   * its start's). A day atom may serve several fields only when all of them read the same date; else the destination's date is asked. */
  function temporalRoles(w: Work) {
    const ORDER: Read["role"][] = ["origin", "day", "start", "end"], groups = new Map<string, Read[]>();
    for (const item of w.reads) { const key = `${item.kind}:${item.atom[0]}:${item.atom[1]}`; groups.set(key, [...groups.get(key) ?? [], item]); }
    for (const group of groups.values()) {
      const roles = [...new Set(group.map(item => item.role))].sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y)), kind = group[0].kind;
      if (roles.length < 2 || kind === "date" && new Set(group.map(item => item.value)).size === 1) continue;
      for (const role of roles.slice(1)) lose(w, role, kind);
    }
  }
  function lose(w: Work, role: Read["role"], kind: Read["kind"]) {
    code(w, "AGENT_QUOTE_REUSED");
    if (role === "end") {
      clear(w, ["end_time", "end_date"]); w.endTime = w.endDate = undefined;
      // A8: the start's own premise comes back when the end it had merged leaves.
      const { start, unmerged } = w.clockPremises;
      if (start && unmerged) { w.premises = w.premises.map(text => text === start ? unmerged : text); w.clockPremises = { start: unmerged }; }
      return;
    }
    if (kind === "date") { clear(w, ["date"]); w.date = undefined; return; }
    clear(w, ["time"]); w.time = undefined;
    const start = w.clockPremises.start;
    if (start) { w.premises = w.premises.filter(text => text !== start); w.clockPremises = {}; }
  }

  // ================================================================ A7: a patch's kept bases and kept values
  /** The open action's derived bases after this message. One whose own value this message changed ends (the owner's value now); one whose
   * ground changed leaves with its derived values, which are asked (a delegated or derived professional is derived again from the new ground,
   * V8); the others stay and are re-checked at the Confirmar (V23). */
  function keptBases(w: Work) {
    const open = w.open!, changed = (keys: readonly (keyof SchedulingFields)[]) => keys.some(key => JSON.stringify(w.fields[key] ?? null) !== JSON.stringify(open.fields[key] ?? null));
    for (const item of open.basis) {
      const shape = basisShape(item);
      if (changed(shape.own)) continue;
      if (!changed(shape.stands)) { w.basis.push(item); continue; }
      code(w, "AGENT_PATCH_BASIS");
      if (item.type === "DELEGADO" && !w.bases.has(item.field)) {
        clear(w, item.field === "profissional" ? PROFESSIONAL_KEYS : TARGET_KEYS);
        if (item.field === "profissional") w.professional = undefined; else w.target = undefined;
        w.bases.set(item.field, { base: { campo: item.field, tipo: item.sole ? "NAO_DITO" : "DELEGADO", ref: null, citacao: "-" }, inherited: true });
        continue;
      }
      clear(w, shape.derived);
      if (shape.derived.includes("date")) w.date = undefined;
      if (shape.derived.includes("time")) w.time = undefined;
      if (shape.derived.includes("end_time")) w.endTime = w.endDate = undefined;
    }
  }
  /** V5 for kept values: a day or clock this message negates that a patch keeps from its open action (not read again here) leaves and is
   * asked, never kept in silence ("Nunca transforme uma negação em operação afirmativa"). */
  function keptDenied(w: Work) {
    const keys = [["date", "date"], ["end_date", "date"], ["source_date", "date"], ["time", "clock"], ["end_time", "clock"], ["source_time", "clock"]] as const;
    for (const atom of atoms) {
      if (!atom.negated) continue;
      const span: Span = [atom.start, atom.end], day = atom.kind === "date" ? dayOf(src.text, atoms, span, "date", w.a.operacao, timezone, now) : undefined;
      const clock = atom.kind === "clock" ? clockOf(src.text, atoms, span, w.a.operacao, "only", timezone, now) : undefined;
      const values = day && day !== "UNREAD" ? day.dates : clock && clock !== "UNREAD" ? clock.readings : [];
      for (const [key, kind] of keys) {
        const value = w.fields[key];
        if (kind !== atom.kind || typeof value !== "string" || w.open!.fields[key] !== value || !values.includes(value) || w.reads.some(item => item.kind === kind && item.value === value)) continue;
        clear(w, [key]);
        ask(w, "AGENT_ENTITY_DENIED", key, AGENT_ENTITY_DENIED_OPEN);
      }
    }
  }

  // ================================================================ V21 reason, V22 recurrence
  function reasonStep(w: Work) {
    if (!w.a.motivo) { if (kept(w, "motivo")) keepFields(w, ["reason", "reason_source"]); return; }
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
        // Micro P2 (exception proof, flag SALON_SECRETARY_AGENT_MICRO): the row's own words are its customer's AND its services' names ("a
        // escova da X"): every word of the exception must be one of them, and exactly one appointment of the interval must hold them all.
        const rowWords = (row: AgentApptFact) => new Set([row.customerName, ...agentMicroEnabled() ? row.serviceNames : []].flatMap(name => nameTokens(name)));
        const holders = busy.filter(row => tokens.length > 0 && (nameHasTokens(tokens, row.customerName) || agentMicroEnabled() && tokens.every(token => rowWords(row).has(token))));
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
    // A7: the open plan's own pending cancellations and bookings this plan does not patch count too (a confirmed cancellation is history, and
    // the question "remarcar em vez de cancelar?" could no longer be done); only this message's actions ask.
    const openOf = (operation: string) => unpatched().filter(item => item.status === "OPEN" && item.operation === operation);
    const openCustomer = (item: AgentOpenAction) => item.fields.customer_ref ?? item.customer;
    const creates = [...live().filter(w => w.a.operacao === "appointment.create" && w.fields.customer_ref).map(w => ({ w, customer: w.fields.customer_ref!, released: w.a.ocupa_horario_de })),
      ...openOf("appointment.create").flatMap(item => openCustomer(item) ? [{ w: undefined, customer: openCustomer(item)!, released: null }] : [])];
    const cancels = [...live().filter(w => w.a.operacao === "appointment.cancel").map(w => ({ w, customer: customerOf(w) })),
      ...openOf("appointment.cancel").map(item => ({ w: undefined, customer: openCustomer(item) }))];
    for (const create of creates) {
      const same = cancels.filter(item => item.customer === create.customer);
      const released = create.released ? works.find(w => w.a.chave === create.released) : undefined, freed = create.released ? openByKey.get(create.released) : undefined;
      if (!same.length || released && customerOf(released) !== create.customer || !released && freed && openCustomer(freed) !== create.customer) continue;
      for (const item of [create, ...same]) if (item.w) ask(item.w, "AGENT_RULE4");
    }
  }
  /** V20: one appointment with two mutating actions (A7: a pending change or cancellation of the open plan this plan does not patch counts too,
   * and a confirmed cancellation; a confirmed move may be moved again). */
  function doubleMutation() {
    const target = (w: Work) => w.origin?.expected ?? (w.origin?.located.length === 1 ? w.origin.located[0] : undefined);
    const mutations = live().filter(w => (w.a.operacao === "appointment.change" || w.a.operacao === "appointment.cancel") && target(w));
    const held = unpatched().filter(item => (item.status === "OPEN" && item.operation === "appointment.change" || item.operation === "appointment.cancel") && item.appointment).map(item => item.appointment!);
    for (const w of mutations) if (mutations.some(other => other !== w && target(other) === target(w)) || held.includes(target(w)!)) ask(w, "AGENT_DOUBLE_MUTATION");
  }
  /** Round 2, F0: on a change an empty field means "as the appointment is" (prepare(): a clock with no day keeps the appointment's day; an
   * alteration with neither keeps its slot; no new professional keeps its professional; no service change keeps its services). Review C1/M1:
   * what decides is the owner's words, never the plan's value alone. A new day or clock the owner wrote (newDayAsked, newClockAsked) that no
   * field carries is asked (AGENT_ORIGIN_QUESTIONS) and stays prepare()'s own question until answered (temporalMissing, review C2), never the
   * appointment's own value; one the plan invented over words that state none is not (the appointment's own value is what the owner said). A
   * new professional the owner named or asked for (targetAsked, review C5) that no field nor card carries is asked; so are services the plan
   * moved, or the owner wrote, that no field carries. A day and clock both empty on a plain move, or a day kept with no clock, are prepare()'s
   * own questions. A derived start waits for its action (agentDerivedCheck) and is not read here. */
  function originInherited(w: Work) {
    const a = w.a, f = w.fields, row = w.appt;
    if (a.operacao !== "appointment.change") return;
    const alteration = !!(f.target_professional_ref || f.target_professional_name || f.service_changes?.length), halfDay = w.ambiguities.some(item => item.field === "time");
    const asked: (keyof typeof AGENT_ORIGIN_QUESTIONS)[] = [], missing: ("date" | "time")[] = [];
    if (!w.derived && !f.date && (f.time || halfDay || alteration) && newDayAsked(w)) missing.push("date");
    if (!w.derived && !f.time && !halfDay && !f.date && alteration && newClockAsked(w)) missing.push("time");
    asked.push(...missing);
    if (!f.target_professional_ref && !f.target_professional_name && w.card?.kind !== "target_professional_ref" && targetAsked(w)) asked.push("target_professional_ref");
    if (a.servicos?.length && !f.service_changes?.length && (servicesMoved(a.servicos, row) || unlistedWords(w))) asked.push("service_changes");
    if (missing.length) w.missing = missing;
    for (const field of asked) if (w.question?.field !== field) ask(w, "AGENT_ORIGIN_INHERITED", field, AGENT_ORIGIN_QUESTIONS[field]);
  }
  /** F0 (review C1, M1): what the owner's own words state of a change's new day and clock, read in its region (its clause, the later parts no
   * other action's clause holds and, for a day, one said once for coordinated actions: admits), never in what found its appointment (the atoms
   * its origin read, an atom an origin preposition leads), its reason, an exception, a negated or an excluded day. `day`/`clock`: NONE (no such
   * atom), SAME (each reads exactly the re-read appointment's own day or clock, which an empty field keeps) or OTHER (another value, two, one
   * the grammar cannot read, a duration, or an appointment not known); `loose`: words of the closed temporal vocabulary (glue aside) outside
   * every atom and the words its reading takes (a day the atom grammar does not mark, "na semana seguinte"). */
  function ownerTemporal(w: Work) {
    const known = ownerSaid.get(w);
    if (known) return known;
    const free = destination(w), excepted = works.flatMap(other => [...other.bases.values()].flatMap(item => item.base.tipo === "EXCECAO" && item.span ? [item.span] : []));
    const away = (span: Span) => excepted.some(item => meets(item, span)) || !!w.reason && meets(w.reason, span) || originLed(span);
    const mine = free.filter(atom => { const span: Span = [atom.start, atom.end];
      return !atom.negated && !away(span) && !excludedDay(src.text, atom) && admits(w, span, atom.kind === "date"); });
    const days = mine.filter(atom => atom.kind === "date").map(atom => { const day = dayOf(src.text, free, [atom.start, atom.end], "date", w.a.operacao, timezone, now);
      return day && day !== "UNREAD" && day.dates.length === 1 ? day.dates[0] : "?"; });
    const clocks = mine.filter(atom => atom.kind === "clock").map(atom => { const span: Span = [atom.start, atom.end];
      if (duration(span)) return "?";
      const clock = clockOf(src.text, free, span, w.a.operacao, "only", timezone, now);
      return clock && clock !== "UNREAD" && clock.readings.length === 1 ? clock.readings[0] : "?"; });
    const level = (values: string[], own: string | undefined) => !values.length ? "NONE" as const : values.every(value => value === own) ? "SAME" as const : "OTHER" as const;
    const loose = wordList.some(item => { const span: Span = [item.start, item.end];
      return !GLUE.has(item.word) && !APPT_WORDS.has(item.word) && temporalVocabulary(item.word) && !atoms.some(atom => meets(widened(src.text, atom), span)) && !away(span) &&
        admits(w, span, false); });
    const out = { day: level(days, w.appt?.startLocal.slice(0, 10)), clock: level(clocks, w.appt?.startLocal.slice(11, 16)), loose };
    ownerSaid.set(w, out);
    return out;
  }
  /** F0: a change's new day the owner's words state other than the appointment's own (or with the words the atom grammar does not mark, beside
   * a plan that moves the day): an empty date must be asked, never the appointment's day. */
  function newDayAsked(w: Work) {
    if (w.a.operacao !== "appointment.change") return false;
    const said = ownerTemporal(w), planned = w.a.dia ?? w.a.inicio?.slice(0, 10) ?? null;
    return said.day === "OTHER" || said.loose && !!planned && planned !== w.appt?.startLocal.slice(0, 10);
  }
  /** F0: the same for the new clock. */
  function newClockAsked(w: Work) {
    if (w.a.operacao !== "appointment.change") return false;
    const said = ownerTemporal(w), planned = w.a.inicio?.slice(11, 16) ?? null;
    return said.clock === "OTHER" || said.loose && !!planned && planned !== w.appt?.startLocal.slice(11, 16);
  }
  /** F0 (review C5, M1): the change's own words ask a new professional: an alterity word (asksAnother), a word naming or nearly naming a
   * professional other than the appointment's own and the action's own one (namesAnother), or, beside a plan that names a new one, a name
   * nothing proved (looseName). A new professional only the plan holds, over words that name none, is not asked (the appointment's own stays). */
  function targetAsked(w: Work) {
    const planned = w.a.novo_profissional ? binding.resolve(w.a.novo_profissional, "p")?.id ?? "?" : undefined;
    return asksAnother(w) || namesAnother(w) || planned !== undefined && planned !== (moved.get(w) ?? w.appt)?.professionalId && looseName(w);
  }
  /** The words of a change's region another role of it proved or that name other rows (its customer's base, its own professional's base, the
   * anchors and exceptions), and the moved appointment's customer's words: never a new professional's. */
  function namedElsewhere(w: Work, span: Span, word: string) {
    const other = [...w.bases.values()].some(item => !!item.span && (["cliente", "profissional"].includes(item.base.campo) || item.base.tipo === "ANCORA" || item.base.tipo === "EXCECAO") &&
      meets(item.span, span));
    return other || w.claims.some(claim => meets(claim, span)) || nameTokens((moved.get(w) ?? w.appt)?.customerName ?? "").includes(word) || !!w.customer?.tokens.includes(word);
  }
  function namesAnother(w: Work) {
    const own = new Set([(moved.get(w) ?? w.appt)?.professionalId, w.professional?.id].filter((id): id is string => !!id));
    const others = professionals.filter(row => !own.has(row.id)).flatMap(row => nameWords(row.name, false));
    return others.length > 0 && wordList.some(item => { const span: Span = [item.start, item.end];
      return [...item.word].length >= AGENT_NAME_TOKEN_MIN && !GLUE.has(item.word) && !serviceTokens.has(item.word) && admits(w, span, false) &&
        !atoms.some(atom => meets([atom.start, atom.end], span)) && !namedElsewhere(w, span, item.word) && !entityQuoteDenied(src.text, span[0], span[1], w.a.operacao) &&
        others.some(token => tokenSimilarity(item.word, token) >= SUGGESTION_THRESHOLD); });
  }
  /** A capitalized word of the change's region (never one opening a sentence, nor in a message with no lowercase letter) that no role took and
   * that no closed class, no registered professional or service and no customer of the action holds: a name the owner wrote that nothing proved. */
  function looseName(w: Work) {
    if (!/\p{Ll}/u.test(src.text)) return false;
    return wordList.some(item => { const span: Span = [item.start, item.end], word = item.word;
      return /^\p{Lu}/u.test(src.text.slice(item.start, item.end)) && !opening(item.start) && admits(w, span, false) && !atoms.some(atom => meets([atom.start, atom.end], span)) &&
        !GLUE.has(word) && !PRONOUNS.has(word) && !FIRST_PERSON.has(word) && !INDEFINITE.has(word) && !APPT_WORDS.has(word) && !temporalWord(word) && !CLOSED_WORDS.has(word) &&
        !HONORIFICS.has(word) && !directoryTokens.has(word) && !namedElsewhere(w, span, word); });
  }
  /** F0: the plan's service delta changes the re-read appointment's services (an unknown appointment or service: it may). */
  function servicesMoved(list: NonNullable<AgentPlanAction["servicos"]>, row: AgentApptFact | undefined) {
    if (!row) return true;
    const id = (ref: string) => binding.resolve(ref, "s")?.id ?? "?", held = new Set(row.serviceIds), set = list.filter(item => item.modo === "LISTA").map(item => id(item.ref));
    const next = new Set(set.length ? set : held);
    for (const item of list) if (item.modo === "INCLUIR") next.add(id(item.ref)); else if (item.modo !== "LISTA") next.delete(id(item.ref));
    return next.size !== held.size || [...next].some(item => !held.has(item));
  }
  /** A7: the open plan's actions no live action of this plan patches (a dropped or held patch leaves its open action as it was). */
  function unpatched() { const patched = new Set(live().flatMap(w => w.open ? [w.open.key] : [])); return openActions.filter(item => !patched.has(item.key)); }
  /** A7 (V18): with no topic in this plan, the customer of the open plan's mutating actions when they all have that one customer (a customer
   * held only by the owner's words counts as another one); several customers are no topic (the pronoun is asked, never a pick among them). */
  function openTopic(): Entity | undefined {
    const held = openActions.filter(action => MUTATING.has(action.operation)).flatMap((action): { id?: string; action: AgentOpenAction }[] => {
      const id = action.fields.customer_ref ?? action.customer;
      return id ? [{ id, action }] : action.fields.customer_name ? [{ action }] : [];
    });
    const ids = new Set(held.map(item => item.id ?? `?${item.action.key}`)), id = held[0]?.id;
    if (ids.size !== 1 || !id) return undefined;
    const name = held[0].action.names[id] ?? "";
    return { id, name, tokens: nameWords(name, true), spans: [], proven: true };
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
    if (w.customer && hit.includes(w.customer) && booking) {
      cleared.push(...CUSTOMER_KEYS); forget(w.customer); w.customer = undefined; unassume(w, "cliente");
      if (w.customerPremise) { w.premises = w.premises.filter(text => text !== w.customerPremise); w.customerPremise = undefined; }
    }
    if (w.professional && hit.includes(w.professional) && (booking || w.a.operacao === "schedule.block")) {
      cleared.push(...PROFESSIONAL_KEYS); forget(w.professional); w.professional = undefined; unassume(w, "profissional");
    }
    if (w.target && hit.includes(w.target)) { cleared.push(...TARGET_KEYS); forget(w.target); w.target = undefined; unassume(w, "novo_profissional"); }
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
    /** Micro P2 (V15, flag SALON_SECRETARY_AGENT_MICRO): a clock of a move's own clause that reads exactly the located appointment's own start
     * (its origin, written beside the words that found it) is covered by that row; any other clock still asks. */
    const originClock = (w: Work, atom: Atom) => agentMicroEnabled() && atom.kind === "clock" && w.a.operacao === "appointment.change" && !!w.appt && w.origin?.located.length === 1 &&
      quoteTemporalFacts(src.text.slice(atom.start, atom.end), timezone, now).clocks.includes(w.appt.startLocal.slice(11, 16));
    for (const atom of atoms) {
      const span: Span = [atom.start, atom.end];
      if (atom.negated) continue;
      const holder = works.find(w => w.own && inside(span, w.own));
      if (holder) {
        if (holder.status !== "DROP" && !handled(span, holder.a.operacao) && !corrected(holder, atom) && !originClock(holder, atom)) ask(holder, "AGENT_COVERAGE", null, agentUncoveredText(src.text.slice(span[0], span[1])));
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
/** `options` undefined: the decoder's own default (the open plan of the current agent message, none outside one). */
function decodedPlan(plan: AgentPlan, options?: AgentPlanDecodeOptions): { plan: AgentPlan } | { reasons: string[] } {
  try { return { plan: decodeAgentPlan(plan, options) }; } catch (error) { return { reasons: error instanceof AgentPlanError ? [...error.reasons] : ["AGENT_SCHEMA"] }; }
}
/** The plan's own dependency edges (A7: an edge to an action of the open plan is outside this plan's graph; the decoder admitted it). */
const planEdges = (actions: readonly AgentPlanAction[]) => {
  const keys = new Set(actions.map(action => action.chave));
  return actions.map(action => ({ key: action.chave, depends_on: action.depende_de.filter(key => keys.has(key)) }));
};
function graphViolation(plan: AgentPlan, open: readonly AgentOpenAction[] = []): string | undefined {
  try { dependencyGraph(planEdges(plan.acoes)); } catch { return "CYCLE"; }
  const byKey = new Map(plan.acoes.map(action => [action.chave, action.operacao] as const)), opened = new Map(open.map(item => [item.key, item.operation] as const));
  for (const action of plan.acoes) {
    // A4 (S2): only a create takes a released slot; the edge of any other operation is dropped by the validation (that action asks), not the plan.
    if (action.ocupa_horario_de === null || action.operacao !== "appointment.create") continue;
    const target = byKey.get(action.ocupa_horario_de) ?? opened.get(action.ocupa_horario_de);
    if (!action.depende_de.includes(action.ocupa_horario_de) || !target || !["appointment.cancel", "appointment.change"].includes(target)) return "RELEASED_SLOT";
  }
  return undefined;
}
/** A3 (S2): a patch's value with no base is the open action's own: the appointment the open action located, or its day, start or end as accepted
 * (local wall clock). Anything else, or a value the open action does not hold, is not. */
function inheritedValue(open: AgentOpenAction, action: AgentPlanAction, field: (typeof AGENT_BASE_REQUIRED_FIELDS)[number], binding: AgentBinding): boolean {
  const f = open.fields, value = action[field];
  if (value === null) return true;
  if (field === "atendimento") return !!open.appointment && binding.resolve(value, "a")?.id === open.appointment;
  if (field === "dia") return !!f.date && value === f.date;
  if (field === "inicio") return !!f.date && !!f.time && value === `${f.date}T${f.time}`;
  return !!f.end_time && !!(f.end_date ?? f.date) && value === `${f.end_date ?? f.date}T${f.end_time}`;
}
/** A7: the open action's registered names of the ids a patch still holds (its refs and its appointment). */
function keptNames(open: AgentOpenAction, fields: SchedulingFields, appointment: string | undefined) {
  const ids = new Set<string>(appointment ? [appointment] : []);
  for (const [key, value] of Object.entries(fields)) if (key.endsWith("_ref")) for (const id of Array.isArray(value) ? value : [value]) if (typeof id === "string") ids.add(id);
  return Object.fromEntries(Object.entries(open.names).filter(([id]) => ids.has(id)));
}
/** A7: per derived basis, the fields it fills (`derived`), the owner's own fields that replace it (`own`) and the fields it stands on
 * (`stands`), as the scheduling adapter reads them for a C4 continuation (secretary-scheduling agentBasisShape). */
function basisShape(item: AgentBasis): { derived: (keyof SchedulingFields)[]; own: (keyof SchedulingFields)[]; stands: (keyof SchedulingFields)[] } {
  switch (item.type) {
    case "DELEGADO": return item.field === "novo_profissional" ? { derived: [...TARGET_KEYS], own: [...TARGET_KEYS], stands: ["date", "time", "service_changes", "service_changes_ref"] }
      : { derived: [...PROFESSIONAL_KEYS], own: [...PROFESSIONAL_KEYS], stands: ["date", "time", "service_ref", "service_name", "service_names", "service_list_ref"] };
    case "ANCORA": return { derived: ["time"], own: ["time"], stands: ["date", "professional_ref", "professional_name"] };
    case "MANTIDO": return { derived: ["time"], own: ["time"], stands: ["date"] };
    case "EXCECAO": return { derived: ["time", "end_time", "end_date"], own: ["time", "end_time"], stands: ["date", "professional_ref", "professional_name"] };
    case "FIM_EXPEDIENTE": return { derived: ["end_time", "end_date"], own: ["end_time"], stands: ["date", "time", "professional_ref", "professional_name"] };
    default: return { derived: ["date", "time"], own: ["date", "time"], stands: [] };
  }
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
      // A2: a professional taken only because the salon's data left one holds only while that one is still the only one.
      if (item.sole) return set.length === 1 && set[0] === item.chosen;
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
