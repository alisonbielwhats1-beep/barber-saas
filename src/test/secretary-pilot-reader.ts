import type { PilotAppointmentRow, PilotBusy, PilotClock, PilotPerson, PilotProfessionalRow, PilotReader, PilotServiceRow, PilotWindow } from "../lib/secretary-pilot-resolver";

/** In-memory PilotReader for the reschedule pilot's unit tests (docs/c5-spike/12-piloto-remarcacao.md §7): one synthetic salon, no database,
 * no network. It returns SUPERSETS on purpose (every customer for any mention, every appointment of a customer whatever its status or day),
 * so what the tests observe is the resolver's own filtering. `fail` makes a read throw (the "unavailable" states); `calls` records each read. */
export type MemorySalon = {
  customers?: PilotPerson[]; team?: PilotProfessionalRow[]; catalog?: PilotServiceRow[]; appointments?: PilotAppointmentRow[];
  /** Working intervals by professional id and by local date ("YYYY-MM-DD") or UTC weekday of the date (0 Sunday … 6 Saturday). */
  hours?: Record<string, Record<string, PilotWindow[]>>;
  blocks?: { professionalId: string; startLocal: string; endLocal: string }[];
  fail?: Partial<Record<keyof PilotReader, boolean>>;
};
export type MemoryReader = PilotReader & { calls: { method: keyof PilotReader; args: unknown[] }[] };
export const TZ = "America/Sao_Paulo";
/** Monday 2031-03-10, 09:00 in São Paulo. */
export const RECEIVED_AT = "2031-03-10T12:00:00.000Z";
export const clockAt = (iso = RECEIVED_AT, timezone = TZ): PilotClock => ({ receivedAt: new Date(iso), timezone });
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const BUSY = new Set(["PENDING", "CONFIRMED", "IN_PROGRESS"]);

export function memoryReader(salon: MemorySalon): MemoryReader {
  const calls: MemoryReader["calls"] = [];
  const read = async <T>(method: keyof PilotReader, args: unknown[], value: () => T): Promise<T> => {
    calls.push({ method, args });
    if (salon.fail?.[method]) throw Error("SYNTHETIC_READ_FAILURE");
    return structuredClone(value());
  };
  const windowsOf = (id: string, date: string) => salon.hours?.[id]?.[date] ?? salon.hours?.[id]?.[String(weekday(date))];
  return {
    calls,
    customers: mencao => read("customers", [mencao], () => salon.customers ?? []),
    appointmentsOf: (customerId, fromLocal) => read("appointmentsOf", [customerId, fromLocal],
      () => (salon.appointments ?? []).filter(row => row.customerId === customerId).sort((a, b) => a.startLocal.localeCompare(b.startLocal))),
    team: () => read("team", [], () => salon.team ?? []),
    catalog: () => read("catalog", [], () => salon.catalog ?? []),
    workingWindows: (professionalId, date) => read("workingWindows", [professionalId, date], () =>
      professionalId === null ? windowsOf("*", date) ?? (salon.team ?? []).flatMap(pro => windowsOf(pro.id, date) ?? []) : windowsOf(professionalId, date) ?? []),
    busy: (professionalId, date) => read("busy", [professionalId, date], (): PilotBusy[] => [
      ...(salon.appointments ?? []).filter(row => row.professionalId === professionalId && row.startLocal.startsWith(date) && BUSY.has(row.status))
        .map(row => ({ appointmentId: row.id, startLocal: row.startLocal, endLocal: row.endLocal })),
      ...(salon.blocks ?? []).filter(block => block.professionalId === professionalId && block.startLocal.startsWith(date))
        .map(block => ({ appointmentId: null, startLocal: block.startLocal, endLocal: block.endLocal })),
    ]),
  };
}

const minutes = (local: string) => Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
const local = (date: string, minute: number) => `${date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
/** A booked appointment of `service` with `professional` at a local day and clock (end = start + the service's duration, same day). */
export function booked(id: string, customer: PilotPerson, professional: PilotPerson, service: PilotServiceRow, date: string, clock: string, status = "CONFIRMED"): PilotAppointmentRow {
  const start = `${date}T${clock}`;
  return { id, customerId: customer.id, professionalId: professional.id, professionalName: professional.name, serviceId: service.id, serviceName: service.name,
    startLocal: start, endLocal: local(date, minutes(start) + service.durationMin), status, durationMin: service.durationMin, priceCents: service.priceCents };
}
/** Every day of the week with the same working interval(s), "HH:mm"-"HH:mm". */
export const everyDay = (...spans: [string, string][]): Record<string, PilotWindow[]> =>
  Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), spans.map(([a, b]) => ({ start: minutes(`xxxx-xx-xxT${a}`), end: minutes(`xxxx-xx-xxT${b}`) }))]));
