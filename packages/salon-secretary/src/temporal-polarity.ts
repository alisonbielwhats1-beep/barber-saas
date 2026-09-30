import { z } from "zod";
import { clockComponentWire, dayComponentWire, temporalComponent } from "./temporal-components";

/** C4 polarity (rec 13), flag SALON_SECRETARY_TEMPORAL_POLARITY (default off). A value the user NEGATED
 * or corrected ("para 11h, não 10h", "às dez, não, às onze", "qualquer horário menos 14h") is reported
 * by Luna as an exclusion of its role: {field, value, literal}. The value has the shape of the role's
 * value (legacy YYYY-MM-DD / HH:mm, or a component in components mode) and the literal is the clause
 * fragment with the negation and the excluded value. It is transport only: decoded into per-turn
 * evidence entries that never become a domain field. The backend proves the fragment (one negator,
 * one atom, disjoint from the positive quotes) before that negator stops denying the positive values;
 * an unproven exclusion changes nothing. With the flag off the wire and the prompt are historical. */
export const temporalPolarityEnabled = () => process.env.SALON_SECRETARY_TEMPORAL_POLARITY === "true";
export const exclusionFields = ["date", "time", "source_date", "source_time", "end_time"] as const;
export type ExclusionField = typeof exclusionFields[number];
const literal = z.string().min(1).max(600).regex(/\S/);
/** Decoder view of one published exclusion (the value is checked per field by the backend, never here). */
export const temporalExclusion = z.object({ field: z.enum(exclusionFields), value: z.union([z.string().min(1).max(20), temporalComponent]), literal }).strict();
export type TemporalExclusion = z.infer<typeof temporalExclusion>;
export const temporalExclusionsTransport = z.array(temporalExclusion).max(6).nullable();

/** The rule, stated once inside the field it governs (rec 15): the wire description. */
export const temporalExclusionInstructions = 'Valor negado/corrigido pelo usuário ("11h, não 10h", "às dez, não, às onze": exclui 10h; "menos 14h"); o afirmado vai no seu campo. literal: só a negação e o valor excluído. Sem exclusão: null.';

type Schema = Record<string, unknown>;
/** Hand-written compact schema. `literalSchema` is the exact published literal schema and the component
 * values are the components container's own schemas, so $defs compaction shares all of them. */
export function temporalExclusionsWire(literalSchema: Schema, components: boolean): Schema {
  const value = components ? { anyOf: [dayComponentWire(), clockComponentWire()] } : { type: "string" };
  const item = { type: "object", properties: { field: { type: "string", enum: [...exclusionFields] }, value, literal: literalSchema }, required: ["field", "value", "literal"], additionalProperties: false };
  return { anyOf: [{ type: "array", items: item }, { type: "null" }], description: temporalExclusionInstructions };
}
