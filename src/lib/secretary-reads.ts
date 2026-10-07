import { readsV2Enabled } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { getSchedulingAvailability, listSchedulingAppointmentsRange, listSchedulingProfessionals, listUpcomingCustomerAppointments, summarizeSchedulingAppointments } from "./scheduling-catalog";
import { addCalendarDays, weekdayOfDateKey } from "./time";
import { formatClock, formatDay, formatLocal } from "./secretary-datetime-format";

/** P3b (flag SALON_SECRETARY_READS_V2, default off): the frequent read-only answers (packages/salon-secretary/src/reads-v2.ts).
 * Everything here reads through the tenant-scoped catalog (the same access check as every read); nothing is written, reserved
 * or picked. A read never shows a bounded result as if it were complete: what is left out is said ("há mais"), or the read is
 * summarized and a narrower one asked. */
export { readsV2Enabled };
/** A customer's next appointments shown at once (one more is read to know that more exist). */
export const UPCOMING_LIMIT = 3;
/** Free times shown per professional (one more is looked for). */
export const SLOT_LIMIT = 5;
/** The most eligible professionals an availability read lists at once; above it, the question of today (which one) stays. */
export const ACROSS_MAX = 10;
/** Rows a day read lists (the historical bound). */
export const DAY_LIST_LIMIT = 50;
export const periodLabel = (period?: string) => period === "morning" ? " de manhã" : period === "afternoon" ? " à tarde" : period === "evening" ? " à noite" : "";
const join = (items: readonly string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

type UpcomingRow = Awaited<ReturnType<typeof listUpcomingCustomerAppointments>>[number];
/** C32: the customer's next PENDING/CONFIRMED appointments (in the tenant, from now), with the filters the owner said. */
export async function upcomingAppointments(actor: ServiceActor, customer: string, filters: { professional_ref?: string; service_ref?: string }) {
  const rows = await withTenant(actor, tx => listUpcomingCustomerAppointments(tx, actor, customer, { take: UPCOMING_LIMIT + 1,
    ...(filters.professional_ref ? { professional_ref: filters.professional_ref } : {}), ...(filters.service_ref ? { service_ref: filters.service_ref } : {}) }));
  return { rows: rows.slice(0, UPCOMING_LIMIT), more: rows.length > UPCOMING_LIMIT };
}
const upcomingLine = (row: UpcomingRow) => `${formatLocal(row.start_local)} — ${row.services.map(s => s.serviceName).join(", ")} com ${row.professional_name}${row.status === "PENDING" ? " · pendente" : ""}`;
/** `who`: the customer as registered; `filter`: what else the owner said (" para Corte com Yasmin"). */
export function upcomingMessage(who: string, rows: readonly UpcomingRow[], more: boolean, filter = "") {
  if (!rows.length) return `Não encontrei agendamento futuro pendente ou confirmado de ${who}${filter}.`;
  if (rows.length === 1 && !more) return `Próximo agendamento de ${who}${filter}: ${upcomingLine(rows[0])}.`;
  return `Próximos agendamentos de ${who}${filter}:\n${rows.map(upcomingLine).join("\n")}` +
    (more ? `\nHá mais agendamentos futuros de ${who}; mostrei os ${rows.length} primeiros. Diga a data para ver outros.` : "");
}

export type DaySummary = Awaited<ReturnType<typeof summarizeSchedulingAppointments>>;
/** C29: a day read with more rows than it lists. Without a professional: each professional's count and first/last start, and the
 * question "which professional or period" (with the professionals as options); with one: the counts per period and "which
 * period"; with a period or clock too: a clock. `ask`: the field the question is about. Never "restrinja por cliente". */
export function daySummaryMessage(day: string, filter: { professional?: string; period?: string; time?: string }, summary: DaySummary): { message: string; ask: "professional_ref" | "period" | "time" } {
  const scope = `${filter.professional ? ` de ${filter.professional}` : ""} em ${formatDay(day)}${periodLabel(filter.period)}${filter.time ? ` às ${formatClock(filter.time)}` : ""}`;
  const head = `Agenda${scope}: ${plural(summary.total, "agendamento", "agendamentos")}${summary.more ? " ou mais" : ""}${summary.cancelled ? ` e ${plural(summary.cancelled, "cancelado", "cancelados")}` : ""}, mais do que listo de uma vez.`;
  if (!filter.professional) return { ask: "professional_ref", message: [head, ...summary.professionals.map(row => `${row.professional_name}: ${plural(row.count, "agendamento", "agendamentos")}, ${row.count === 1 ?
    `às ${formatClock(row.first_local.slice(11))}` : `das ${formatClock(row.first_local.slice(11))} às ${formatClock(row.last_local.slice(11))}`}`), "De qual profissional ou período você quer a lista?"].join("\n") };
  if (!filter.period && !filter.time) {
    const periods = ([["manhã", summary.periods.morning], ["tarde", summary.periods.afternoon], ["noite", summary.periods.evening]] as const).filter(([, count]) => count > 0);
    const counts = periods.map(([name, count]) => `${name}: ${count}`).join("; ");
    return { ask: "period", message: `${head}\n${counts ? `${counts[0].toLocaleUpperCase("pt-BR")}${counts.slice(1)}.\n` : ""}Qual período você quer ver?` };
  }
  return { ask: "time", message: `${head}\nInforme um horário para ver a lista.` };
}
/** The summary's professionals as options: only those still active in the tenant (a click is rechecked by the same search). */
export async function summaryOptions(actor: ServiceActor, summary: DaySummary, service_ref?: string) {
  const active = await withTenant(actor, tx => listSchedulingProfessionals(tx, actor, service_ref ? { service_ref } : {}));
  const items = summary.professionals.flatMap(row => active.some(pro => pro.id === row.professional_ref) ? [{ id: row.professional_ref, name: `${row.professional_name} · ${row.count}` }] : []);
  return items.length && items.length <= 20 ? items : undefined;
}

type Slot = { startLocal: string; endLocal: string };
export type AcrossRow = { professional: { id: string; name: string }; free: boolean; slots: (Slot & { professional_ref: string })[]; more: boolean };
/** C30/C31 b: the free times of EACH eligible professional for the service(s), day and clock or period (the same availability
 * engine, one tenant read per professional, in order). `free`: the requested clock itself is free. */
export async function availabilityAcross(actor: ServiceActor, team: readonly { id: string; name: string }[],
  input: { service_ref: string; service_refs?: string[]; date: string; time?: string; period?: string }, excluded?: ReadonlySet<string>): Promise<AcrossRow[]> {
  const rows: AcrossRow[] = [];
  for (const professional of team) {
    const found = await withTenant(actor, tx => getSchedulingAvailability(tx, actor, { ...input, professional_ref: professional.id }, undefined, undefined, excluded, SLOT_LIMIT + 1));
    const slots = [...(found.plan ? [{ startLocal: found.plan.startLocal, endLocal: found.plan.endLocal }] : []), ...found.alternatives.slice(0, SLOT_LIMIT)];
    rows.push({ professional, free: !!found.plan, slots: slots.map(slot => ({ startLocal: slot.startLocal, endLocal: slot.endLocal, professional_ref: professional.id })), more: found.alternatives.length > SLOT_LIMIT });
  }
  return rows;
}
/** "Às 15h: livre com …", then each professional's free times (earliest first; "e há mais" when more exist than shown), those
 * with none, and that the read reserves nothing. */
export function availabilityAcrossMessage(rows: readonly AcrossRow[], filter: { service: string; date: string; time?: string; period?: string }) {
  const scope = `${formatDay(filter.date)}${filter.time ? ` a partir das ${formatClock(filter.time)}` : periodLabel(filter.period)}`;
  const listed = rows.filter(row => row.slots.length).sort((a, b) => a.slots[0].startLocal.localeCompare(b.slots[0].startLocal) || a.professional.name.localeCompare(b.professional.name, "pt-BR"));
  if (!listed.length) return `Não encontrei horário livre para ${filter.service} em ${scope} com nenhum profissional.`;
  const free = rows.filter(row => row.free).map(row => row.professional.name), none = rows.filter(row => !row.slots.length).map(row => row.professional.name);
  const at = filter.time ? free.length ? `Às ${formatClock(filter.time)}: livre com ${join(free)}.` : `Às ${formatClock(filter.time)}, ninguém está livre para ${filter.service}.` : undefined;
  return [...(at ? [at] : []), `Horários livres para ${filter.service} em ${scope}:`,
    ...listed.map(row => `${row.professional.name}: ${row.slots.map(slot => formatClock(slot.startLocal.slice(11, 16))).join(", ")}${row.more ? " e há mais" : ""}`),
    ...(none.length ? [`Sem horário livre ${filter.time ? `a partir das ${formatClock(filter.time)}` : filter.period ? "nesse período" : "nesse dia"}: ${join(none)}.`] : []), "A consulta não reserva o horário."].join("\n");
}

/** Owner 07/10 ("verifica a agenda da Beatriz Costa para essa semana" was refused: a read held one day only): a week the owner's words
 * name for a read. "essa/esta/nesta/desta semana" or "da semana" is from today to Sunday; "semana que vem", "próxima semana" or "semana
 * seguinte" is next Monday to Sunday. Never with a weekday or a day written ("sexta dessa semana" is that Friday), nor "fim de semana". */
export type WeekRead = { from: string; to: string; label: string };
export function weekRead(text: string | undefined, today: string): WeekRead | undefined {
  if (!text) return undefined;
  const folded = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
  if (/\b(?:fim|final|fins|finais) de semana\b/.test(folded) || /\b(?:domingo|segunda|terca|quarta|quinta|sexta|sabado|hoje|amanha)\b|\bdia \d|\d{1,2}\/\d{1,2}/.test(folded)) return undefined;
  const weekday = weekdayOfDateKey(today), sunday = addCalendarDays(today, (7 - weekday) % 7);
  if (/\bsemana que vem\b|\b(?:a |na |da |para a |pra )?proxima semana\b|\bsemana seguinte\b/.test(folded))
    return { from: addCalendarDays(sunday, 1), to: addCalendarDays(sunday, 7), label: "na semana que vem" };
  if (/\b(?:essa|esta|nessa|nesta|dessa|desta) semana\b|\b(?:agenda|horarios|agendamentos|atendimentos) da semana\b/.test(folded))
    return { from: today, to: sunday, label: "nesta semana" };
  return undefined;
}
type RangeRow = Awaited<ReturnType<typeof listSchedulingAppointmentsRange>>[number];
/** The week read said by day: "Agenda de Beatriz Costa nesta semana (qua, 07/10 a dom, 11/10):", then each day with its rows
 * ("10h — Amanda Souza (Escova) com Tatiana Rocha · pendente"); a bounded read says that more exist. */
export function weekReadMessage(week: WeekRead, who: string | undefined, rows: readonly RangeRow[], more: boolean) {
  const span = `${week.label} (${formatDay(week.from)} a ${formatDay(week.to)})`;
  if (!rows.length) return `${who ? `${who} não tem agendamentos` : "Nenhum agendamento"} ${span}.`;
  const days = [...new Set(rows.map(row => row.start_local.slice(0, 10)))];
  const line = (row: RangeRow) => `${formatClock(row.start_local.slice(11, 16))} — ${row.customer_name} (${row.services.map(s => s.serviceName).join(", ")}) com ${row.professional_name}${row.status === "PENDING" ? " · pendente" : ""}`;
  return [`${who ? `Agenda de ${who}` : "Agenda"} ${span}:`, ...days.flatMap(day => [formatDay(day), ...rows.filter(row => row.start_local.startsWith(day)).map(line)]),
    ...(more ? [`Há mais agendamentos ${week.label}; mostrei os ${rows.length} primeiros. Diga o dia ou o profissional para ver o resto.`] : [])].join("\n");
}
