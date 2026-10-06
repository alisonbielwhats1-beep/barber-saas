import type { ServiceActor } from "./service-catalog";
import type { SchedulingFields } from "./scheduling-contract";
import { withTenant } from "./prisma-tenant";
import { schedulingActionSnapshot } from "./scheduling-mutations";
import { toLocalDateTime } from "./time";
import { formatClock, formatLocalRange } from "./secretary-datetime-format";

/** C5 (flag SALON_SECRETARY_BLOCK_OVERLAP_GUARD, default off; owner rule 10): a block whose interval holds a committed appointment
 * of that professional (the block snapshot's own `affected` rows) is never proposed directly, whatever the request said. The owner
 * sees those appointments and picks, on a card of real options: one free interval of the block (the interval without them), or the
 * whole block with the appointments kept. Nothing is proposed meanwhile, and each pick is rechecked against fresh tenant rows. */
export const blockOverlapGuardEnabled = () => process.env.SALON_SECRETARY_BLOCK_OVERLAP_GUARD === "true";
export const BLOCK_OVERLAP_CARD = "block_overlap_ref" as const;
export const BLOCK_ALL_REF = "block-all";
const FREE_REF = "block-free:";
/** More free intervals than this are not listed (the owner says which one, or keeps the whole block). */
const MAX_FREE = 4;
/** The whole block the owner chose to keep over its appointments (valid only for that very professional and interval). */
export type BlockOverlapChoice = { professional_ref: string; start: string; end: string };
type BlockSnapshot = { professional_ref?: string; professional_name?: string; timezone: string; startLocal: string; endLocal: string; affected: { id: string; name: string; startLocal: string }[] };
type Interval = { start: string; end: string };
const list = (names: readonly string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;

/** The parts of [start, end) outside every busy interval (local "yyyy-MM-ddTHH:mm" values, compared as text). */
export function freeIntervals(start: string, end: string, busy: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let cursor = start;
  for (const item of [...busy].sort((a, b) => a.start.localeCompare(b.start))) {
    if (item.end <= cursor) continue;
    if (item.start >= end) break;
    if (item.start > cursor) out.push({ start: cursor, end: item.start });
    cursor = item.end;
    if (cursor >= end) return out;
  }
  if (cursor < end) out.push({ start: cursor, end });
  return out;
}
export const blockOverlapChosen = (choice: BlockOverlapChoice | undefined, snap: BlockSnapshot) =>
  !!choice && choice.professional_ref === snap.professional_ref && choice.start === snap.startLocal && choice.end === snap.endLocal;
/** The card's options for a block snapshot with appointments inside: its free intervals (at most MAX_FREE) and the whole block. */
export async function blockOverlapOptions(actor: ServiceActor, snap: BlockSnapshot) {
  const ids = snap.affected.map(row => row.id);
  const rows = await withTenant(actor, tx => tx.appointment.findMany({ where: { id: { in: ids }, salonId: actor.salonId }, select: { startAt: true, endAt: true } }));
  const busy = rows.map(row => ({ start: toLocalDateTime(row.startAt, snap.timezone), end: toLocalDateTime(row.endAt, snap.timezone) }));
  const free = freeIntervals(snap.startLocal, snap.endLocal, busy);
  const listed = free.length <= MAX_FREE ? free : [];
  const kept = `${snap.affected.length} agendamento${snap.affected.length > 1 ? "s" : ""} marcado${snap.affected.length > 1 ? "s" : ""}`;
  return { free, items: [...listed.map(gap => ({ id: `${FREE_REF}${gap.start}|${gap.end}`, name: `Só o horário livre: ${formatLocalRange(gap.start, gap.end)}` })),
    { id: BLOCK_ALL_REF, name: `Período todo: ${formatLocalRange(snap.startLocal, snap.endLocal)}, mantendo ${kept}` }] };
}
/** The question and card published instead of a block proposal over appointments. */
export async function blockOverlapQuestion(actor: ServiceActor, snap: BlockSnapshot) {
  const options = await blockOverlapOptions(actor, snap), n = snap.affected.length;
  const booked = list([...snap.affected].sort((a, b) => a.startLocal.localeCompare(b.startLocal)).map(row => `${row.name} às ${formatClock(row.startLocal.slice(11, 16))}`));
  const ask = !options.free.length ? "Esse período não tem horário livre. Bloqueio o período todo, mantendo os agendamentos marcados, ou prefere outro horário?"
    : options.free.length > MAX_FREE ? "Há vários horários livres nesse período. Diga qual intervalo devo bloquear, ou escolha o período todo, mantendo os agendamentos marcados."
    : "Bloqueio só o horário livre ou o período todo, mantendo os agendamentos marcados?";
  return { message: `Nesse período, ${snap.professional_name ?? "o profissional"} tem ${n > 1 ? `${n} agendamentos` : "um agendamento"}: ${booked}. Nada foi bloqueado. ${ask} Selecione uma opção real.`,
    card: { kind: BLOCK_OVERLAP_CARD, items: options.items } };
}
/** A pick on the block card, rechecked against the block's fresh snapshot and options (else SELECTION_INVALID). The whole block is
 * recorded as the owner's choice; a free interval becomes the block's own day, start and end (backend values from real rows). */
export async function blockOverlapSelection(actor: ServiceActor, next: { fields: SchedulingFields; block_overlap?: BlockOverlapChoice }, ref: string) {
  const snap = await withTenant(actor, tx => schedulingActionSnapshot(tx, actor, "schedule.block", next.fields)).catch(() => undefined);
  if (!snap || !snap.affected.length) throw Error("SELECTION_INVALID");
  const options = await blockOverlapOptions(actor, snap);
  if (!options.items.some(item => item.id === ref)) throw Error("SELECTION_INVALID");
  if (ref === BLOCK_ALL_REF) { next.block_overlap = { professional_ref: snap.professional_ref!, start: snap.startLocal, end: snap.endLocal }; return; }
  const [start, end] = ref.slice(FREE_REF.length).split("|");
  next.fields.date = start.slice(0, 10); next.fields.time = start.slice(11, 16); next.fields.end_time = end.slice(11, 16);
  if (end.slice(0, 10) === start.slice(0, 10)) delete next.fields.end_date; else next.fields.end_date = end.slice(0, 10);
  delete next.block_overlap;
}
