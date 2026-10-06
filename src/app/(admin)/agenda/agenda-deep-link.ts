import type { BlockSelection } from "./availability-panel";

/** Deep-link intent of /agenda (e.g. the Secretária's "Abrir no formulário da agenda"): opaque ids, a day and clocks
 * only, never names, phones or text. Malformed values are dropped here. */
export type AgendaDeepLink = { appointment?: string; client?: string; professional?: string; service?: string; time?: string; end?: string; block?: boolean; create?: boolean };
/** What the agenda opens for a link: an appointment's detail, the new-appointment form or the block form, prefilled.
 * A prefill is never a booking: each form keeps its own validation and explicit confirmation. */
export type AgendaPrefill = { detailId?: string; create?: { startLocal: string; proId: string; clientId?: string; serviceIds?: string[] }; block?: BlockSelection;
  /** A record or form was asked for (even if refused): the first-visit guide does not start over it. */
  linked?: boolean };

const ref = /^[A-Za-z0-9_-]{1,64}$/, clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const id = (value?: string) => value && ref.test(value) ? value : undefined;
const time = (value?: string) => value && clock.test(value) ? value : undefined;
export function agendaDeepLink(params: { appointment?: string; client?: string; professional?: string; service?: string; time?: string; end?: string; block?: string; from?: string }): AgendaDeepLink {
  const link: AgendaDeepLink = { appointment: id(params.appointment), client: id(params.client), professional: id(params.professional), service: id(params.service),
    time: time(params.time), end: time(params.end), ...(params.block === "1" ? { block: true } : {}), ...(params.from === "secretaria" ? { create: true } : {}) };
  return Object.fromEntries(Object.entries(link).filter(([, value]) => value !== undefined)) as AgendaDeepLink;
}
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const hhmm = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

/** Server-side, against what this user can see (the page's tenant- and role-scoped lists): an appointment outside
 * them opens nothing, a client outside them opens no form (as before), an unknown professional or service is just
 * not prefilled. The block form needs a visible professional and the right to manage availability. */
export function agendaPrefill(link: AgendaDeepLink, scope: { date: string; canCreate: boolean; canManageAvailability: boolean;
  professionals: readonly { id: string }[]; clients: readonly { id: string }[]; services: readonly { id: string }[]; appointments: readonly { id: string }[] }): AgendaPrefill {
  const prefill: AgendaPrefill = link.appointment || link.client || link.service || link.time || link.block || link.create ? { linked: true } : {};
  if (link.appointment && scope.appointments.some(item => item.id === link.appointment)) prefill.detailId = link.appointment;
  const professional = scope.professionals.some(item => item.id === link.professional) ? link.professional : undefined;
  if (link.block) {
    if (!scope.canManageAvailability || !professional) return prefill;
    const start = link.time ?? "12:00", end = link.end && minutes(link.end) > minutes(start) ? link.end : hhmm(Math.min(minutes(start) + 60, 23 * 60 + 59));
    prefill.block = { professionalId: professional, startLocal: `${scope.date}T${start}`, endLocal: `${scope.date}T${end}` };
    return prefill;
  }
  const wanted = Boolean(link.client || link.time || link.service || link.create);
  if (!wanted || !scope.canCreate || !scope.professionals.length || link.client && !scope.clients.some(item => item.id === link.client)) return prefill;
  const service = scope.services.some(item => item.id === link.service) ? link.service : undefined;
  prefill.create = { startLocal: `${scope.date}T${link.time ?? "08:00"}`, proId: professional ?? scope.professionals[0].id,
    ...(link.client ? { clientId: link.client } : {}), ...(service ? { serviceIds: [service] } : {}) };
  return prefill;
}
