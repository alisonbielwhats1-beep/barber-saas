import { describe, expect, it } from "vitest";
import { agendaDeepLink, agendaPrefill } from "./agenda-deep-link";

/** B6 fallback target: /agenda deep links (ids, a day and clocks only), re-validated against what the page loaded
 * for this user. A prefill only opens a form; the form keeps its own validation and confirmation. */
const scope = { date: "2026-10-02", canCreate: true, canManageAvailability: true, professionals: [{ id: "p-tatiana" }, { id: "p-rodrigo" }],
  clients: [{ id: "c-carla" }], services: [{ id: "s-corte" }], appointments: [{ id: "appt-1" }] };
const params = (query: string) => Object.fromEntries(new URLSearchParams(query));

describe("agenda deep link", () => {
  it("parses only well-formed ids and clocks", () => {
    expect(agendaDeepLink(params("date=2026-10-02&client=c-carla&professional=p-tatiana&time=15:00&service=s-corte&from=secretaria")))
      .toEqual({ client: "c-carla", professional: "p-tatiana", time: "15:00", service: "s-corte", create: true });
    expect(agendaDeepLink(params("client=Amanda%20Souza&time=15h&end=25:00&service=s%3Bdrop&block=yes&from=hoje"))).toEqual({});
  });
  it("Secretária create link: the new-appointment form with client, professional, time and service", () => {
    expect(agendaPrefill(agendaDeepLink(params("client=c-carla&professional=p-rodrigo&time=15:00&service=s-corte&from=secretaria")), scope))
      .toEqual({ linked: true, create: { startLocal: "2026-10-02T15:00", proId: "p-rodrigo", clientId: "c-carla", serviceIds: ["s-corte"] } });
    // Nothing resolved yet: the empty form still opens on that day (first visible professional, 08:00).
    expect(agendaPrefill(agendaDeepLink(params("from=secretaria")), scope)).toEqual({ linked: true, create: { startLocal: "2026-10-02T08:00", proId: "p-tatiana" } });
  });
  it("unknown professional or service is just not prefilled; a client this user cannot see opens nothing (as before)", () => {
    expect(agendaPrefill(agendaDeepLink(params("professional=p-other&service=s-other&time=09:30&from=secretaria")), scope))
      .toEqual({ linked: true, create: { startLocal: "2026-10-02T09:30", proId: "p-tatiana" } });
    expect(agendaPrefill(agendaDeepLink(params("client=c-hidden&time=09:30&from=secretaria")), scope)).toEqual({ linked: true });
    expect(agendaPrefill(agendaDeepLink(params("client=c-carla")), { ...scope, canCreate: false })).toEqual({ linked: true });
    // The historical client-only link keeps opening the form at 08:00.
    expect(agendaPrefill(agendaDeepLink(params("client=c-carla")), scope)).toEqual({ linked: true, create: { startLocal: "2026-10-02T08:00", proId: "p-tatiana", clientId: "c-carla" } });
  });
  it("change/cancel link opens the appointment only when it is visible", () => {
    expect(agendaPrefill(agendaDeepLink(params("appointment=appt-1")), scope)).toEqual({ linked: true, detailId: "appt-1" });
    expect(agendaPrefill(agendaDeepLink(params("appointment=appt-2")), scope)).toEqual({ linked: true });
  });
  it("block link: the block form for a visible professional, only for who may manage availability", () => {
    expect(agendaPrefill(agendaDeepLink(params("professional=p-rodrigo&block=1&time=10:00&end=11:00")), scope))
      .toEqual({ linked: true, block: { professionalId: "p-rodrigo", startLocal: "2026-10-02T10:00", endLocal: "2026-10-02T11:00" } });
    expect(agendaPrefill(agendaDeepLink(params("professional=p-rodrigo&block=1&time=10:00")), scope).block).toEqual({ professionalId: "p-rodrigo", startLocal: "2026-10-02T10:00", endLocal: "2026-10-02T11:00" });
    expect(agendaPrefill(agendaDeepLink(params("professional=p-rodrigo&block=1&time=10:00&end=09:00")), scope).block!.endLocal).toBe("2026-10-02T11:00");
    expect(agendaPrefill(agendaDeepLink(params("professional=p-rodrigo&block=1")), { ...scope, canManageAvailability: false })).toEqual({ linked: true });
    expect(agendaPrefill(agendaDeepLink(params("professional=p-other&block=1&time=10:00&end=11:00")), scope)).toEqual({ linked: true });
  });
  it("a plain agenda link (date or professional filter) is no deep link", () => {
    expect(agendaPrefill(agendaDeepLink(params("date=2026-10-02&professional=p-rodrigo")), scope)).toEqual({});
  });
});
