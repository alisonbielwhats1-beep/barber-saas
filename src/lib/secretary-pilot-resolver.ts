import type { PilotDestination, PilotOrigin, PilotTempoDia, PilotTempoHora } from "../../packages/salon-secretary/src/pilot-reschedule-contract";

/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE, default off; docs/c5-spike/12-piloto-remarcacao.md §0, §3): the deterministic
 * resolver after Luna. It never re-reads the owner's Portuguese: it normalizes the MENTIONS Luna extracted (lower case, no accents, the name
 * particles of the existing nameTokens) to find real records of the session's salon, computes days and clocks from the typed operators and the
 * frozen received_at in the salon's timezone, detects real ambiguity (2+ records, two valid readings in the data) and locates the appointment
 * once. The owner's message is used for one thing only, the narrow provenance check: a hint may choose among 2+ real appointments only when its
 * mention appears in the message (normalized search); otherwise it is ignored and the Secretária asks. That check never drops the action nor
 * changes a value. No word lists, no case or punctuation as evidence. Pure functions over an injected, tenant-scoped reader.
 * E1 contract, tests first: the types are final; the functions are pending (PILOT_NOT_IMPLEMENTED). */
export type PilotPerson = { id: string; name: string };
export type PilotProfessionalRow = PilotPerson & { serviceIds: readonly string[] };
export type PilotServiceRow = { id: string; name: string; durationMin: number; priceCents: number };
/** A booked appointment in the salon's local time ("YYYY-MM-DDTHH:mm"); `status` as stored (only PENDING and CONFIRMED are ever candidates). */
export type PilotAppointmentRow = { id: string; customerId: string; professionalId: string; professionalName: string; serviceId: string; serviceName: string;
  startLocal: string; endLocal: string; status: string; durationMin: number; priceCents: number };
/** One working interval of a local day, in minutes [start, end). */
export type PilotWindow = { start: number; end: number };
/** What occupies a professional on a local day: an appointment (its id) or a block (null). */
export type PilotBusy = { appointmentId: string | null; startLocal: string; endLocal: string };
/** Tenant-scoped reads (the session's salon only). A failing read throws; the resolver turns it into "unavailable", never into "not found". */
export interface PilotReader {
  /** Customers that may match the mention: at least every one sharing a folded name token with it (more is allowed, never fewer). */
  customers(mencao: string): Promise<readonly PilotPerson[]>;
  /** The customer's appointments; `fromLocal` (received_at, local) may prefilter, and the resolver keeps only PENDING/CONFIRMED from it on. */
  appointmentsOf(customerId: string, fromLocal: string): Promise<readonly PilotAppointmentRow[]>;
  /** The salon's active professionals with the services each one performs. */
  team(): Promise<readonly PilotProfessionalRow[]>;
  catalog(): Promise<readonly PilotServiceRow[]>;
  /** Working intervals on a local day: of the professional, or of the salon (null: the union of its professionals'). */
  workingWindows(professionalId: string | null, date: string): Promise<readonly PilotWindow[]>;
  busy(professionalId: string, date: string): Promise<readonly PilotBusy[]>;
}
/** The turn's frozen received_at and the salon's IANA timezone. */
export type PilotClock = { receivedAt: Date; timezone: string };

export const PILOT_IDENTITY_STATES = ["exact", "partial", "ambiguous", "contradictory", "not_found", "unavailable"] as const;
export type PilotIdentityState = (typeof PILOT_IDENTITY_STATES)[number];
/** exact: the mention's tokens equal one record's and no other record holds them all (bound); partial: they are contained in ONE record (bound;
 * the proposal shows its full name); ambiguous: 2+ records hold them all (asked with those records); contradictory: no record holds them all
 * and exactly one shares some of them ("Encontrei X, mas você escreveu Y": asked, never substituted); not_found: asked, with tolerant suggestions
 * of real records when there are any (never bound); unavailable: the search failed (a safe error, never "does not exist"). */
export type PilotIdentity =
  | { state: "exact" | "partial"; id: string; name: string; mencao: string; provenance: "explicit" }
  | { state: "ambiguous"; options: PilotPerson[]; mencao: string; provenance: "unresolved" }
  | { state: "contradictory"; candidate: PilotPerson; mencao: string; provenance: "unresolved" }
  | { state: "not_found"; suggestions: PilotPerson[]; mencao: string; provenance: "unresolved" }
  | { state: "unavailable"; mencao: string; provenance: "unresolved" };
export async function resolveCustomer(reader: PilotReader, mencao: string): Promise<PilotIdentity> {
  void reader; void mencao;
  throw Error("PILOT_NOT_IMPLEMENTED");
}

export type PilotHint = "dia" | "hora" | "profissional" | "servico" | "posicao";
/** Over the customer's future appointments (from received_at, PENDING or CONFIRMED), filtered by the origin hints: day and clock through the
 * normalizer, professional and service by their mentions, position in the day. one: bound (derived, shown in the proposal); none: asked, showing
 * her next appointments; several: asked with the real options. `ignored`: hints with a mention absent from the message, never used to choose. */
export type PilotAppointmentResolution =
  | { state: "one"; appointment: PilotAppointmentRow; provenance: "derived"; used: PilotHint[]; ignored: PilotHint[] }
  | { state: "none"; upcoming: PilotAppointmentRow[]; provenance: "unresolved"; used: PilotHint[]; ignored: PilotHint[] }
  | { state: "several"; options: PilotAppointmentRow[]; provenance: "unresolved"; used: PilotHint[]; ignored: PilotHint[] }
  | { state: "unavailable"; provenance: "unresolved" };
export async function resolveAppointment(reader: PilotReader, input: { customerId: string; origem: PilotOrigin; message: string }, clock: PilotClock): Promise<PilotAppointmentResolution> {
  void reader; void input; void clock;
  throw Error("PILOT_NOT_IMPLEMENTED");
}

/** The target day, from the frozen received_at in the salon's timezone. one: explicit for "data" (no month: the next occurrence from today on),
 * "relativo_hoje" and a weekday with a single reading; inherited when not said or "mesmo_da_origem"; derived for "origem_mais_dias". ask: a weekday
 * whose two readings differ (decision 27: the first after today, the first after the original day), both shown; "este" takes the first reading.
 * invalid: a date that does not exist. */
export type PilotDateResolution =
  | { state: "one"; date: string; provenance: "explicit" | "inherited" | "derived"; mencao?: string }
  | { state: "ask"; options: string[]; reason: "TWO_READINGS"; mencao: string }
  | { state: "invalid"; reason: "NO_SUCH_DATE"; mencao: string };
export function resolveTargetDate(dia: PilotTempoDia | null, origin: { date: string }, clock: PilotClock): PilotDateResolution {
  void dia; void origin; void clock;
  throw Error("PILOT_NOT_IMPLEMENTED");
}

/** The target clock "HH:mm". one: explicit for 12-23 or with a period; derived for a bare hour 1-11 whose readings h and h+12 leave ONE inside the
 * professional's (or the salon's) hours that day (decision 18), and for "origem_mais_minutos"; inherited for "mesmo_da_origem" and when not said on
 * the original day. ask: both readings inside the hours (both shown), "a_definir", or not said on a new day (decision 2). none: no reading inside
 * the hours (asked). */
export type PilotTimeResolution =
  | { state: "one"; time: string; provenance: "explicit" | "inherited" | "derived"; mencao?: string }
  | { state: "ask"; options: string[]; reason: "TWO_READINGS" | "TO_DEFINE" | "NOT_SAID"; mencao?: string }
  | { state: "none"; readings: string[]; reason: "NO_READING_IN_HOURS"; mencao: string };
export async function resolveTargetTime(reader: PilotReader, hora: PilotTempoHora | null,
  context: { origin: { date: string; time: string }; date: string; professionalId: string | null }): Promise<PilotTimeResolution> {
  void reader; void hora; void context;
  throw Error("PILOT_NOT_IMPLEMENTED");
}

/** kept: not said or "manter" (the current professional, inherited); the identity states for "nomeado" (explicit when bound); chosen: "qualquer"
 * (decision 15: performs the service and is free for its whole duration at the slot, the appointment being moved aside; the fewest appointments
 * that day; derived, shown); nobody_free: asked; waiting: "qualquer" before the day and the clock are resolved. */
export type PilotProfessionalResolution =
  | { state: "kept"; id: string; name: string; provenance: "inherited" }
  | PilotIdentity
  | { state: "chosen"; id: string; name: string; provenance: "derived" }
  | { state: "nobody_free"; provenance: "unresolved" }
  | { state: "waiting"; provenance: "unresolved" };
export async function resolveProfessional(reader: PilotReader, profissional: PilotDestination["profissional"],
  context: { current: PilotPerson; appointmentId: string; serviceId: string; durationMin: number; slot: { date: string; time: string } | null }): Promise<PilotProfessionalResolution> {
  void reader; void profissional; void context;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
