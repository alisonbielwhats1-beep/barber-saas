import { PILOT_RESCHEDULE_PARAMETERS } from "../../packages/salon-secretary/src/pilot-reschedule-contract";
import { e2bLuna, type E2bClock, type E2bDay, type E2bInterpretation, type E2bMode } from "./secretary-pilot-e2b";

/** Reschedule pilot, completion of E2-B (the owner's requirements on E2-B: one general temporal model, typed delegation with an exclusion LIST and an
 * ASK on a tie, one question per ambiguity, the worst real payload proved): the contract shapes and outcomes the gap tests are written against,
 * BEFORE the implementation (docs/c5-spike/12-piloto-remarcacao.md §11, §11.3, and the §11.4+ amendments that will record them). Test-local types
 * only: payloads reach the product through `wire()` or the scripted model, so the tests compile against today's types.
 *
 * Contract assumed by the tests (every name below is the one they pin):
 *  - `destino.profissional` = { modo, mencao, excluidos: string[] }. `excluidos` lists, with the owner's own words for each name, the team members who
 *    must NOT attend (one or several); it goes with "qualquer" (whoever is free, the current one included unless excluded) and "outro" (someone other
 *    than the current one); [] when nobody was excluded. Each is resolved against the team: exact/partial, that member; ambiguous, every member it may
 *    be; not_found/contradictory, ASKED (field "professional"), never ignored. A frame with no exclusion carries `excluidos: []` only once the
 *    published schema has the key (`e2b2Pro`), so the same test frames decode before and after the contract moves.
 *  - day and clock `deslocamento.ancoras` may be [] — the owner gave the operation (± days, weeks or minutes) but no anchor the contract has (origem,
 *    hoje/agora, data_citada): the code ASKS (reason "ANCHOR_MISSING", bound to `date` or `time`) and never computes from an anchor nobody said.
 *  - the day operator { tipo: "a_definir", mencao }: the owner left the day open or dropped the one said before; the day is ASKED, the old one is never kept.
 * Outcomes:
 *  - resolveProfessional → { state: "tie", options: PilotPerson[], provenance: "unresolved" } when decision 15 (the fewest appointments that day) leaves
 *    more than one candidate; the plan asks on field "professional", reason "PROFESSIONAL_TIE", the tied members as options (never the name order).
 *  - resolveTargetDate / resolveTargetTime → { state: "ask", reason: "ANCHOR_MISSING", ... } for an offset with no anchor.
 *  - a turn whose request cannot carry the whole needed context (catalog, team, open question, repair note) fails safely: no model call, an outcome
 *    code matching PILOT_SAFE_FAILURE, nothing prepared, the reply says nothing changed. A request that IS sent carries all of it and fits the cap.
 * Invented names, services and sentences only. */
export const E2B2_REASONS = Object.freeze({ anchorMissing: "ANCHOR_MISSING", tie: "PROFESSIONAL_TIE" } as const);
/** The outcome codes a turn that cannot carry its whole context may end with (the existing PILOT_BUDGET, or a more specific code of the same family). */
export const PILOT_SAFE_FAILURE = /^PILOT_(BUDGET|CONTEXT|CATALOG|TEAM)/;
export type E2b2Professional = { modo: E2bMode; mencao: string | null; excluidos?: string[] };
export type E2b2OpenDay = { tipo: "a_definir"; mencao: string };
export type E2b2Destination = { dia: E2bDay | E2b2OpenDay | null; hora: E2bClock | null; profissional: E2b2Professional };
export type E2b2Interpretation = Omit<E2bInterpretation, "destino"> & { destino: E2b2Destination };
type Json = Record<string, unknown>;
/** Whether the published wire already has `destino.profissional.excluidos` (the schema the model is told, read as data). */
export function publishesExclusions(): boolean {
  const pro = (((PILOT_RESCHEDULE_PARAMETERS.properties as Json).destino as Json).properties as Json).profissional as Json;
  return Object.prototype.hasOwnProperty.call(pro.properties as Json, "excluidos");
}
/** The destination professional: `excluidos` is always sent when it names someone; an empty one only once the schema publishes the key. */
export const e2b2Pro = (modo: E2bMode, excluidos: string[] = [], mencao: string | null = null): E2b2Professional =>
  excluidos.length || publishesExclusions() ? { modo, mencao, excluidos: [...excluidos] } : { modo, mencao };
export const e2b2OpenDay = (mencao: string): E2b2OpenDay => ({ tipo: "a_definir", mencao });
export const e2b2To = (dia: E2b2Destination["dia"], hora: E2bClock | null, profissional: E2b2Professional = e2b2Pro(null)): E2b2Destination =>
  ({ dia, hora, profissional: e2b2Pro(profissional.modo, profissional.excluidos ?? [], profissional.mencao) });
/** A full payload (every key present; null states absence), its professional in the shape the published schema takes. */
export const e2b2Luna = (over: Partial<E2b2Interpretation> = {}): E2b2Interpretation => {
  const frame = { ...(e2bLuna() as unknown as E2b2Interpretation), destino: e2b2To(null, null), ...over };
  return { ...frame, destino: e2b2To(frame.destino.dia, frame.destino.hora, frame.destino.profissional) };
};
