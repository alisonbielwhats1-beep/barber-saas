import { createHash } from "node:crypto";
import type { SlotConflict } from "./appointment-overlap-policy";
import { schedulingOverlapEnabled } from "./scheduling-conflict-contract";

/** Owner decision 05/10 (flag SALON_SECRETARY_SCHEDULE_EXCEPTIONS, default off; it rides on the review machinery of
 * SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED): the Secretária offers the same schedule exceptions the agenda offers, for a
 * new booking and a reschedule, asks "quer … mesmo assim?" before proposing and still needs Confirmar. The reason is
 * optional. A salon closure, a past time, a resource or a waitlist offer stay hard blocks. With the flag off nothing here
 * runs. The model contract is untouched: consent comes from a backend-published option or from this deterministic reader. */
export const scheduleExceptionsEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.SALON_SECRETARY_SCHEDULE_EXCEPTIONS === "true" && schedulingOverlapEnabled();

export const SCHEDULE_EXCEPTION_CAUSES = ["OUTSIDE_WORKING_HOURS", "WORKING_HOURS_BREAK", "AFTER_WORKING_HOURS", "PROFESSIONAL_UNAVAILABLE", "SLOT_TAKEN"] as const;
export type ScheduleExceptionCause = (typeof SCHEDULE_EXCEPTION_CAUSES)[number];
/** Same roles as the agenda (src/app/(admin)/agenda/actions.ts): the professional's own schedule (outside hours, day off,
 * break) also for PROFESSIONAL; a block, finishing after hours and an overlap only for OWNER and MANAGER. */
export const EXCEPTION_ROLES: Record<ScheduleExceptionCause, readonly string[]> = {
  OUTSIDE_WORKING_HOURS: ["OWNER", "MANAGER", "PROFESSIONAL"],
  WORKING_HOURS_BREAK: ["OWNER", "MANAGER", "PROFESSIONAL"],
  AFTER_WORKING_HOURS: ["OWNER", "MANAGER"],
  PROFESSIONAL_UNAVAILABLE: ["OWNER", "MANAGER"],
  SLOT_TAKEN: ["OWNER", "MANAGER"],
};
export const canGrantException = (role: string, causes: readonly string[]) =>
  causes.length > 0 && causes.every(cause => (EXCEPTION_ROLES as Record<string, readonly string[] | undefined>)[cause]?.includes(role) === true);
/** A schedule cause (not a plain overlap: a review also lists conflict kinds like "APPOINTMENT"): the ones the encaixe flow never covered. */
const SCHEDULE_CAUSES: readonly string[] = ["OUTSIDE_WORKING_HOURS", "WORKING_HOURS_BREAK", "AFTER_WORKING_HOURS", "PROFESSIONAL_UNAVAILABLE"];
export const hasScheduleCause = (causes: readonly string[]) => causes.some(cause => SCHEDULE_CAUSES.includes(cause));
export const EXCEPTION_DEFAULT_REASON = "Exceção confirmada pela Secretária";

export type ExceptionSkips = { skipSchedule?: boolean; skipTimeOff?: boolean; skipWorkingHoursBreak?: boolean; skipAfterHours?: boolean };
type Inspection = { violation: string | null; conflicts: readonly SlotConflict[] };
/** Every cause of one slot, not only the first one the domain returns: re-inspects with each overridable cause skipped.
 * `skipSchedule` (the agenda's own schedule override) also hides a block, so a block is probed apart once it is used.
 * Anything not overridable (closure, booking window, resource, waitlist, a cause that survives its own skip) is `hard`. */
export async function collectExceptionCauses<T extends Inspection>(inspect: (skips: ExceptionSkips) => Promise<T>, probeTimeOff: () => Promise<boolean>) {
  const causes: ScheduleExceptionCause[] = [], hard: string[] = [], skips: ExceptionSkips = {};
  let final: T | undefined;
  for (let round = 0; round < 6; round++) {
    final = await inspect({ ...skips });
    const nonAppointment = final.conflicts.filter(conflict => conflict.kind !== "APPOINTMENT").map(conflict => conflict.kind);
    if (nonAppointment.length) { hard.push(...nonAppointment); break; }
    const violation = final.violation;
    if (!violation) break;
    if ((causes as string[]).includes(violation) || !(SCHEDULE_EXCEPTION_CAUSES as readonly string[]).includes(violation)) { hard.push(violation); break; }
    causes.push(violation as ScheduleExceptionCause);
    if (violation === "SLOT_TAKEN") break; // the last check of the domain: nothing is inspected after it
    if (violation === "OUTSIDE_WORKING_HOURS") {
      skips.skipSchedule = true;
      if (!causes.includes("PROFESSIONAL_UNAVAILABLE") && await probeTimeOff()) causes.push("PROFESSIONAL_UNAVAILABLE");
    }
    if (violation === "PROFESSIONAL_UNAVAILABLE") skips.skipTimeOff = true;
    if (violation === "WORKING_HOURS_BREAK") skips.skipWorkingHoursBreak = true;
    if (violation === "AFTER_WORKING_HOURS") skips.skipAfterHours = true;
  }
  return { causes, hard: [...new Set(hard)], skips, final };
}

/** Binds a consent to the exact slot and causes it answered (a changed slot or a new cause asks again). */
export const exceptionHash = (review: { causes: readonly string[]; startLocal: string; endLocal: string; conflicts: readonly unknown[] }) =>
  createHash("sha256").update(JSON.stringify({ causes: [...review.causes].sort(), startLocal: review.startLocal, endLocal: review.endLocal, conflicts: review.conflicts })).digest("hex");

const clock = (local: string) => { const [h, m] = local.slice(11, 16).split(":"); return m === "00" ? `${Number(h)}h` : `${Number(h)}h${m}`; };
export function exceptionClauses(causes: readonly string[], professional: string | undefined, endLocal: string, conflictStarts: readonly string[] = []) {
  const of = professional ? ` de ${professional}` : " do profissional";
  const clauses: string[] = [];
  if (causes.includes("OUTSIDE_WORKING_HOURS")) clauses.push(`fica fora do expediente${of}`);
  if (causes.includes("PROFESSIONAL_UNAVAILABLE")) clauses.push(`está bloqueado na agenda${of} (folga ou bloqueio)`);
  if (causes.includes("WORKING_HOURS_BREAK")) clauses.push(`cai no intervalo${of}`);
  if (causes.includes("AFTER_WORKING_HOURS")) clauses.push(`termina depois do expediente${of} (vai até ${clock(endLocal)})`);
  if (causes.includes("SLOT_TAKEN")) clauses.push(conflictStarts[0] ? `tem outro atendimento às ${clock(conflictStarts[0])}` : "tem outro atendimento no horário");
  return clauses;
}
const joinClauses = (clauses: string[]) => clauses.length < 2 ? clauses.join("") : `${clauses.slice(0, -1).join(", ")} e ${clauses.at(-1)}`;
/** "Esse horário fica fora do expediente do Otávio. Quer agendar mesmo assim ou escolher outro horário? Livres: 10h, 11h." */
export function exceptionQuestion(operation: "appointment.create" | "appointment.change", causes: readonly string[], professional: string | undefined,
  endLocal: string, conflictStarts: readonly string[], free: readonly string[]) {
  const verb = operation === "appointment.create" ? "agendar" : "remarcar";
  return `Esse horário ${joinClauses(exceptionClauses(causes, professional, endLocal, conflictStarts))}. Quer ${verb} mesmo assim ou escolher outro horário?${free.length ? ` Livres: ${free.map(clock).join(", ")}.` : ""}`;
}
/** The short label of the review card: "fora do expediente, bloqueio". */
export function exceptionLabel(causes: readonly string[]) {
  const names: Record<string, string> = { OUTSIDE_WORKING_HOURS: "fora do expediente", PROFESSIONAL_UNAVAILABLE: "horário bloqueado",
    WORKING_HOURS_BREAK: "no intervalo", AFTER_WORKING_HOURS: "termina depois do expediente", SLOT_TAKEN: "sobre outro atendimento" };
  return causes.map(cause => names[cause] ?? cause).join(", ");
}

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const NEGATION = /\b(nao|nunca|jamais|nem|cancela|cancelar|desiste|deixa pra la|outro horario)\b/;
/** A new date or time in the reply is a new request for the model, never a consent. */
const TEMPORAL = /\d|\b(hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|manha|tarde|noite|meio dia|meia noite|hora|horas|semana|dia)\b/;
const EXPLICIT = /\bmesmo assim\b|\b(pode|quero|vamos|pode sim)\s+(agendar|remarcar|marcar|manter|encaixar|abrir)\b|\b(autorizo|confirmo|libero|liberar|abre|abrir)\s+(a\s+)?(excecao|agenda|horario)\b/;
const BARE = /^(sim|pode|pode sim|ok|claro|isso|beleza|sim pode|sim por favor)$/;
const REASON = /\b(?:porque|pois|ja que|motivo(?: e)?)\b\s*:?\s*(.+)$/i;
/** Deterministic reading of a reply to a live exception question (the model never decides it): CONSENT with the owner's
 * literal reason when given, REFUSAL, or undefined (anything else goes to the model as before). A bare "sim" counts only
 * where the caller allows it (the question on screen is about this one action). */
export function exceptionReply(message: string, options: { bareAllowed?: boolean } = {}):
  { decision: "CONSENT"; reason?: string } | { decision: "REFUSAL" } | undefined {
  const text = fold(message);
  if (!text) return undefined;
  const reasonMatch = REASON.exec(message.normalize("NFC"));
  const head = reasonMatch ? fold(message.slice(0, reasonMatch.index)) : text;
  if (NEGATION.test(head)) return /^(nao|nao obrigado|nao quero|cancela|deixa pra la)$/.test(head) ? { decision: "REFUSAL" } : undefined;
  if (TEMPORAL.test(head)) return undefined;
  if (!EXPLICIT.test(head) && !(options.bareAllowed && BARE.test(head))) return undefined;
  const reason = reasonMatch?.[1]?.trim().replace(/[.!]+$/, "");
  return { decision: "CONSENT", ...(reason && reason.length >= 3 && reason.length <= 200 && !EXPLICIT.test(fold(reason)) ? { reason } : {}) };
}

type PendingHolder = { exception_pending?: { operation: string; hash: string; causes: string[]; expires_at: string }; operation?: string; waiting_for?: string;
  proposal?: unknown; receipt?: unknown; candidates?: unknown };
/** The live exception question of an action (flag on, same operation, not expired, still waiting for that very answer). */
export function scheduleExceptionPending(c: PendingHolder | undefined) {
  const pending = c?.exception_pending;
  if (!c || !pending || !scheduleExceptionsEnabled() || c.proposal || c.receipt || c.candidates || pending.operation !== c.operation || !(Date.parse(pending.expires_at) > Date.now())) return undefined;
  return c.waiting_for === "schedule_exception" || c.waiting_for === "override_requested" ? pending : undefined;
}
