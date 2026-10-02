/** Reschedule pilot E2-A (docs/c5-spike/12-piloto-remarcacao.md §10, Adendo 10): the contract shapes the E2-A tests are written against, BEFORE
 * the implementation. Test-local types only (no product code depends on them): the tests hand these payloads to the product's own functions
 * through `wire()`, so they compile against the E1 types today and keep compiling once the contract moves.
 *  - `dia_semana` is the text enum segunda|terca|quarta|quinta|sexta|sabado|domingo (origin and destination), never a number;
 *  - `origem.servico` is { mencao, catalogo } (catalog names Luna says the mention may designate) in place of `origem.servico_mencao`;
 *  - `observacoes` (≤ 20 items, each at most the message's own 1000 characters, copied from the message) holds reason and context; the code never
 *    reads it (adversarial review OBS-1: a faithful copy never fails the turn);
 *  - a `fora_do_escopo` item carries `pedido` (the words of the separate request) in place of `mencao`.
 * Invented names only. */
export const E2A_WEEKDAYS = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"] as const;
export type E2aWeekday = (typeof E2A_WEEKDAYS)[number];
export type E2aQualifier = "este" | "proximo" | null;
export type E2aDay =
  | { tipo: "data"; dia: number; mes: number | null; mencao: string }
  | { tipo: "mes_relativo"; dia: number; meses: number; mencao: string }
  | { tipo: "dia_semana"; dia_semana: E2aWeekday; qualificador: E2aQualifier; mencao: string }
  | { tipo: "relativo_hoje"; dias: number; mencao: string }
  | { tipo: "mesmo_da_origem"; mencao: string }
  | { tipo: "origem_mais_dias"; dias: number; mencao: string };
export type E2aClock =
  | { tipo: "relogio"; hora: number; minuto: number; periodo: "manha" | "tarde" | "noite" | null; mencao: string }
  | { tipo: "mesmo_da_origem"; mencao: string }
  | { tipo: "origem_mais_minutos"; minutos: number; mencao: string }
  | { tipo: "a_definir"; mencao: string };
export type E2aService = { mencao: string; catalogo: string[] };
export type E2aOrigin = { dia: E2aDay | null; hora: E2aClock | null; profissional_mencao: string | null; servico: E2aService | null;
  posicao: { valor: "primeiro" | "ultimo"; mencao: string } | null };
/** E2-B completion (§11.4) contract migration: the wire's professional carries `excluidos` (who must not attend); a frame built here gets [] unless it
 * says otherwise (shape plumbing only: no expectation depends on it). */
export type E2aProfessional = { modo: "manter" | "nomeado" | "qualquer" | null; mencao: string | null; excluidos?: string[] };
export type E2aDestination = { dia: E2aDay | null; hora: E2aClock | null; profissional: E2aProfessional };
export const E2A_OUT_OF_SCOPE_KINDS = ["cancelar", "bloquear", "trocar_servico", "agendar", "consultar", "outra_acao", "recorrencia", "mensagem"] as const;
export type E2aOutOfScopeKind = (typeof E2A_OUT_OF_SCOPE_KINDS)[number];
export type E2aOutOfScope = { tipo: E2aOutOfScopeKind; pedido: string };
export type E2aInterpretation = { tipo: "remarcar" | "fora_do_escopo" | "misto" | "conversa" | "resposta"; resposta_a: string | null; desistir: boolean;
  aceita_parcial: boolean | null; cliente: { mencao: string | null }; origem: E2aOrigin; destino: E2aDestination; observacoes: string[]; fora_do_escopo: E2aOutOfScope[] };
/** Bounds of `observacoes` (§10, as amended by the E2-A adversarial review OBS-1: the message's own maximum per item, a generous count). */
export const E2A_OBSERVATION_LIMITS = Object.freeze({ items: 20, length: 1000 });

export const E2A_NO_ORIGIN: E2aOrigin = Object.freeze({ dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null }) as E2aOrigin;
export const e2aOrigin = (over: Partial<E2aOrigin> = {}): E2aOrigin => ({ dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null, ...over });
export const e2aDay = (dia_semana: E2aWeekday, mencao: string, qualificador: E2aQualifier = null): E2aDay => ({ tipo: "dia_semana", dia_semana, qualificador, mencao });
export const e2aClock = (hora: number, mencao: string, minuto = 0, periodo: "manha" | "tarde" | "noite" | null = null): E2aClock => ({ tipo: "relogio", hora, minuto, periodo, mencao });
export const e2aService = (mencao: string, catalogo: string[]): E2aService => ({ mencao, catalogo });
export const e2aTo = (dia: E2aDay | null, hora: E2aClock | null, profissional: E2aProfessional = { modo: null, mencao: null }): E2aDestination =>
  ({ dia, hora, profissional: { excluidos: [], ...profissional } });
/** A full E2-A payload (every key present; null states absence). */
export const e2aLuna = (over: Partial<E2aInterpretation> = {}): E2aInterpretation => ({ tipo: "remarcar", resposta_a: null, desistir: false, aceita_parcial: null,
  cliente: { mencao: null }, origem: e2aOrigin(), destino: e2aTo(null, null), observacoes: [], fora_do_escopo: [], ...over });
/** The E2-A value handed to a product function typed with the E1 contract (compiles today; the value is what E2-A defines). */
export const wire = <T>(value: unknown): T => value as T;
/** Folded text (case, accents and punctuation aside) for "copied from the message" checks of the tests themselves. */
export const e2aFold = (text: string) => ` ${text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
export const e2aCopiedFrom = (message: string, words: string) => e2aFold(message).includes(e2aFold(words));
