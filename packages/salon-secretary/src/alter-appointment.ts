import { z } from "zod";

/** P2a (flag SALON_SECRETARY_ALTER_APPOINTMENT, default off): alter an existing appointment's data with appointment.change —
 * who attends (`target_professional_name`: the NEW professional; professional_name keeps locating the current one) and which
 * services (`service_changes`: SET = the complete new list, INCLUDE, REMOVE; names as the owner wrote them; service_name keeps
 * locating the current appointment). Published only with the flag and only in the wire family of appointment.change; a
 * value on any other operation (or with the flag off) is CAPABILITY_FIELD_MISMATCH. The backend proves the literals,
 * resolves the names (homonyms are asked), checks eligibility and availability for the new duration, keeps the slot when no
 * new day/time was said, and only an authenticated confirmation writes. */
export const alterAppointmentEnabled = () => process.env.SALON_SECRETARY_ALTER_APPOINTMENT === "true";
export const serviceChangeModes = ["SET", "INCLUDE", "REMOVE"] as const;
export const serviceChange = z.object({ mode: z.enum(serviceChangeModes), service_name: z.string().trim().min(2).max(200) }).strict();
export type ServiceChange = z.infer<typeof serviceChange>;
/** Review B (budget): the descriptions no longer repeat "Só appointment.change": both fields are published only in that family.
 * C4 R-A (same bytes): the service_changes description states the guard below (a complete new list is SET entries only, never
 * mixed with INCLUDE/REMOVE), which the wire did not publish. */
export const alterationFields = {
  target_professional_name: z.string().trim().min(2).max(200)
    .describe("NOVO profissional; professional_name é o atual."),
  service_changes: z.array(serviceChange).min(1).max(10)
    .describe("Lista nova toda=só SET; INCLUDE acrescenta; REMOVE tira; trocar X por Y=REMOVE X e INCLUDE Y."),
};
export const alterationKeys = ["target_professional_name", "service_changes"] as const;
export type AlterationKey = (typeof alterationKeys)[number];
/** The catalog sentence the flag replaces (checked replace: a drifted target fails at module load). */
export const ALTERATION_REPLACED_SENTENCE = "Não alterar serviço/profissional de um agendamento.";
/** C4 R-B: one short sentence states the construction "put service X on Y's (existing) appointment" = service_changes INCLUDE
 * on that appointment, never a new one; its bytes are paid by wording only (here and in the two alteration descriptions). */
export const alterationInstruction = "Trocar quem atende ou serviços de um agendamento é appointment.change com target_professional_name/service_changes; sem dia/hora novos, date/time null mantêm o horário. Pôr serviço no horário de alguém: INCLUDE, não novo agendamento. Duração/preço não mudam.";
/** Capability guard (validateSelection): alteration values only on appointment.change, only with the flag, and SET never
 * mixed with INCLUDE/REMOVE (a complete list and a delta cannot both hold). The mode names avoid the turn modes' vocabulary
 * (NEW/ADD/PATCH). */
export function assertAlterationScope(op: { operation: string } & Partial<Record<AlterationKey, unknown>>) {
  if (alterationKeys.every(key => op[key] == null)) return;
  if (!alterAppointmentEnabled() || op.operation !== "appointment.change") throw Error("CAPABILITY_FIELD_MISMATCH");
  const modes = new Set((op.service_changes as readonly ServiceChange[] | null | undefined)?.map(change => change.mode));
  if (modes.has("SET") && modes.size > 1) throw Error("CAPABILITY_FIELD_MISMATCH");
}
