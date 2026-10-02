/** Reschedule pilot E2-B (docs/c5-spike/12-piloto-remarcacao.md §11, Adendo 11): the contract shapes and the resolver APIs the E2-B tests are
 * written against, BEFORE the implementation. Test-local types only (no product code depends on them): the tests hand these payloads to the
 * product's own functions through `wire()`, so they compile against the E2-A types today and keep compiling once the contract moves.
 *
 * Contract (§11.1, §11.2):
 *  - day `deslocamento`: { tipo, quantidade: int, unidade: "dias" | "semanas", ancoras: 1..2 DISTINCT of "origem" | "hoje" | "data_citada",
 *    data_citada: { dia: 1-31, mes: 1-12 | null, mencao } | null (present exactly when the anchors hold "data_citada"), mencao };
 *  - clock `deslocamento`: { tipo, minutos: int, ancoras: 1..2 DISTINCT of "origem" | "agora", mencao };
 *  - `relativo_hoje`, `origem_mais_dias` and `origem_mais_minutos` are gone (a stored E2-A state is converted by the loader:
 *    relativo_hoje → hoje, origem_mais_dias → origem, origem_mais_minutos → origem);
 *  - `destino.profissional.modo` gains "outro" (someone other than the current professional); "qualquer" is whoever is free, the current included.
 * Luna says the operation and the plausible anchor(s); it never computes the final date or clock. The code computes ONE reading per anchor the
 * model listed (origem: the appointment's own day/clock; hoje/agora: the frozen received_at of the turn that SAID the operator, in the salon's
 * timezone; data_citada: the literal date, computed like the "data" operator) and asks when the readings differ. It never picks an anchor from words.
 *
 * Resolver APIs the tests call (E2-B):
 *  - resolveTargetDate(dia, origin, clock, target?, current?): unchanged signature (`clock` is the turn that said the operator). Two differing
 *    readings → { state: "ask", options: [the dates, sorted], reason: "ANCHOR_TWO_READINGS", mencao }.
 *  - resolveTargetTime(reader, hora, { origin, date, professionalId, clock }): `clock` (NEW) is the received_at of the turn that said the clock
 *    operator (the "agora" anchor). Two differing readings → { state: "ask", options: [sorted "HH:mm"], reason: "ANCHOR_TWO_READINGS", mencao }.
 *  - resolveProfessional(reader, profissional, { current, appointmentId, serviceId, durationMin, slot, origin }): `origin` (NEW) is the
 *    appointment's own { date, time }, so the resolver can see the FACT that the destination is the origin slot (decision 15 as amended by §11.2).
 *  - The plan's question reason "ANCHOR_TWO_READINGS" is bound to field "date" or "time", its options the real readings.
 * Invented names, services and sentences only. */
export const E2B_DAY_ANCHORS = ["origem", "hoje", "data_citada"] as const;
export const E2B_TIME_ANCHORS = ["origem", "agora"] as const;
export const E2B_UNITS = ["dias", "semanas"] as const;
export const E2B_PROFESSIONAL_MODES = ["manter", "nomeado", "qualquer", "outro"] as const;
export const E2B_WEEKDAYS = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"] as const;
/** The E2-A operators §11.1 removes (they may only appear in a stored state, converted on load). */
export const E2B_REMOVED_OPERATORS = ["relativo_hoje", "origem_mais_dias", "origem_mais_minutos"] as const;
/** Bounds kept from E2-A (§11.1 "Limites: os mesmos de antes"). */
export const E2B_LIMITS = Object.freeze({ days: 366, minutes: 1440, mention: 120 });
export type E2bDayAnchor = (typeof E2B_DAY_ANCHORS)[number];
export type E2bTimeAnchor = (typeof E2B_TIME_ANCHORS)[number];
export type E2bUnit = (typeof E2B_UNITS)[number];
export type E2bWeekday = (typeof E2B_WEEKDAYS)[number];
export type E2bMode = (typeof E2B_PROFESSIONAL_MODES)[number] | null;
export type E2bCited = { dia: number; mes: number | null; mencao: string };
export type E2bDayShift = { tipo: "deslocamento"; quantidade: number; unidade: E2bUnit; ancoras: E2bDayAnchor[]; data_citada: E2bCited | null; mencao: string };
export type E2bClockShift = { tipo: "deslocamento"; minutos: number; ancoras: E2bTimeAnchor[]; mencao: string };
export type E2bDay =
  | { tipo: "data"; dia: number; mes: number | null; mencao: string }
  | { tipo: "mes_relativo"; dia: number; meses: number; mencao: string }
  | { tipo: "dia_semana"; dia_semana: E2bWeekday; qualificador: "este" | "proximo" | null; mencao: string }
  | { tipo: "mesmo_da_origem"; mencao: string }
  | E2bDayShift;
export type E2bClock =
  | { tipo: "relogio"; hora: number; minuto: number; periodo: "manha" | "tarde" | "noite" | null; mencao: string }
  | { tipo: "mesmo_da_origem"; mencao: string }
  | { tipo: "a_definir"; mencao: string }
  | E2bClockShift;
export type E2bService = { mencao: string; catalogo: string[] };
export type E2bOrigin = { dia: E2bDay | null; hora: E2bClock | null; profissional_mencao: string | null; servico: E2bService | null;
  posicao: { valor: "primeiro" | "ultimo"; mencao: string } | null };
/** E2-B completion (§11.4) contract migration: the wire's professional carries `excluidos` (who must not attend); a frame built here gets [] unless it
 * says otherwise (shape plumbing only: no expectation depends on it). */
export type E2bProfessional = { modo: E2bMode; mencao: string | null; excluidos?: string[] };
export type E2bDestination = { dia: E2bDay | null; hora: E2bClock | null; profissional: E2bProfessional };
export type E2bOutOfScope = { tipo: "cancelar" | "bloquear" | "trocar_servico" | "agendar" | "consultar" | "outra_acao" | "recorrencia" | "mensagem"; pedido: string };
export type E2bInterpretation = { tipo: "remarcar" | "fora_do_escopo" | "misto" | "conversa" | "resposta"; resposta_a: string | null; desistir: boolean;
  aceita_parcial: boolean | null; cliente: { mencao: string | null }; origem: E2bOrigin; destino: E2bDestination; observacoes: string[]; fora_do_escopo: E2bOutOfScope[] };

/** A day offset of `quantidade` days from the listed anchor(s) (`citada` only with the "data_citada" anchor). */
export const e2bDays = (quantidade: number, ancoras: E2bDayAnchor[], mencao: string, citada: E2bCited | null = null): E2bDayShift =>
  ({ tipo: "deslocamento", quantidade, unidade: "dias", ancoras: [...ancoras], data_citada: citada, mencao });
export const e2bWeeks = (quantidade: number, ancoras: E2bDayAnchor[], mencao: string, citada: E2bCited | null = null): E2bDayShift =>
  ({ tipo: "deslocamento", quantidade, unidade: "semanas", ancoras: [...ancoras], data_citada: citada, mencao });
export const e2bCited = (dia: number, mes: number | null, mencao: string): E2bCited => ({ dia, mes, mencao });
/** A clock offset of `minutos` from the listed anchor(s). */
export const e2bMinutes = (minutos: number, ancoras: E2bTimeAnchor[], mencao: string): E2bClockShift => ({ tipo: "deslocamento", minutos, ancoras: [...ancoras], mencao });
export const e2bDate = (dia: number, mes: number | null, mencao: string): E2bDay => ({ tipo: "data", dia, mes, mencao });
export const e2bWeekday = (dia_semana: E2bWeekday, mencao: string, qualificador: "este" | "proximo" | null = null): E2bDay => ({ tipo: "dia_semana", dia_semana, qualificador, mencao });
export const e2bSameDay = (mencao: string): E2bDay => ({ tipo: "mesmo_da_origem", mencao });
export const e2bSameClock = (mencao: string): E2bClock => ({ tipo: "mesmo_da_origem", mencao });
export const e2bClock = (hora: number, mencao: string, minuto = 0, periodo: "manha" | "tarde" | "noite" | null = null): E2bClock => ({ tipo: "relogio", hora, minuto, periodo, mencao });
export const e2bOrigin = (over: Partial<E2bOrigin> = {}): E2bOrigin => ({ dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null, ...over });
export const e2bTo = (dia: E2bDay | null, hora: E2bClock | null, profissional: E2bProfessional = { modo: null, mencao: null }): E2bDestination =>
  ({ dia, hora, profissional: { excluidos: [], ...profissional } });
/** A full E2-B payload (every key present; null states absence). */
export const e2bLuna = (over: Partial<E2bInterpretation> = {}): E2bInterpretation => ({ tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null,
  cliente: { mencao: null }, origem: e2bOrigin(), destino: e2bTo(null, null), observacoes: [], fora_do_escopo: [], ...over });
/** The E2-B value handed to a product function typed with the E2-A contract (compiles today; the value is what E2-B defines). */
export const wire = <T>(value: unknown): T => value as T;

/** The E2-A operators exactly as a stored E2-A state holds them (the loader converts them; nothing else may produce them). */
export const e2aStoredToday = (dias: number, mencao: string) => ({ tipo: "relativo_hoje", dias, mencao });
export const e2aStoredOriginDays = (dias: number, mencao: string) => ({ tipo: "origem_mais_dias", dias, mencao });
export const e2aStoredOriginMinutes = (minutos: number, mencao: string) => ({ tipo: "origem_mais_minutos", minutos, mencao });

/** Local São Paulo wall time (UTC-3, no DST) "YYYY-MM-DDTHH:mm" as the ISO instant of a frozen received_at. */
export const saoPauloInstant = (local: string) => new Date(Date.parse(`${local}:00Z`) + 3 * 3_600_000).toISOString();
/** Deterministic pseudo-random source (mulberry32) for the property tests. */
export function e2bRandom(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
