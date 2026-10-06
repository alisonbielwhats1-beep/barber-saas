import type { Tx } from "./prisma-tenant";

/** C5 ("cancela a Amanda e passa o Fábio para o horário dela"): a read-only view of the agenda in which the appointment
 * that a PENDING cancellation of the same plan will release does not exist. Appointment and resource-booking reads leave
 * it out: the projection loadVisitDay already applies to the atomic cancel→create pair, here for a move's availability
 * check while the change is prepared. Preparation only: the executor re-reads the committed agenda under its locks
 * after the cancellation ran (the change never executes into an occupied slot). */
export function releasedAgendaView(tx: Tx, appointmentId: string): Tx {
  const reads = new Set(["findFirst", "findFirstOrThrow", "findMany", "count"]);
  const without = (delegate: object, filter: object) => new Proxy(delegate, { get(target, key) {
    const value = Reflect.get(target, key) as unknown;
    if (typeof value !== "function") return value;
    return reads.has(String(key)) ? (args: { where?: object } = {}) => value.call(target, { ...args, where: { AND: [args.where ?? {}, filter] } }) : value.bind(target);
  } });
  return new Proxy(tx, { get(target, key) {
    const value = Reflect.get(target, key) as unknown;
    if (key === "appointment") return without(value as object, { id: { not: appointmentId } });
    if (key === "resourceBooking") return without(value as object, { appointmentId: { not: appointmentId } });
    return typeof value === "function" ? value.bind(target) : value;
  } }) as Tx;
}
