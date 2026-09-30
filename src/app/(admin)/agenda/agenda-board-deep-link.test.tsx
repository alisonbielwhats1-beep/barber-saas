// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("./actions", () => ({ moveAppointment: vi.fn() }));
vi.mock("./appointment-form", () => ({ AppointmentDialog: (props: { slotStartLocal: string; professionalId: string; initialClient?: { id: string }; initialServiceIds?: string[] }) =>
  <div role="dialog" aria-label="Novo agendamento" data-start={props.slotStartLocal} data-professional={props.professionalId} data-client={props.initialClient?.id ?? ""} data-services={(props.initialServiceIds ?? []).join(",")} /> }));
vi.mock("./appointment-detail", () => ({ AppointmentDetail: ({ appt }: { appt: { id: string } | null }) => appt ? <div role="dialog" aria-label="Agendamento" data-id={appt.id} /> : null }));
vi.mock("./availability-panel", () => ({ AvailabilityPanel: ({ selection, dialogOnly }: { selection?: { professionalId: string; startLocal: string; endLocal: string }; dialogOnly?: boolean }) =>
  dialogOnly ? <div role="dialog" aria-label="Bloquear horário" data-selection={selection ? `${selection.professionalId}|${selection.startLocal}|${selection.endLocal}` : ""} /> : null }));
vi.mock("./availability-block", () => ({ AvailabilityBlockDialog: () => null, AvailabilityBlockTrigger: () => null }));
vi.mock("./weekly-pause-panel", () => ({ WeeklyPausePanel: () => null }));
import { AgendaBoard } from "./agenda-board";
import type { AgendaPrefill } from "./agenda-deep-link";

/** B6 agenda fallback: the board opens what the page's re-validated prefill says, also when a new link arrives while
 * the agenda is already open (a soft navigation from the Secretária dock). It only opens forms; nothing is booked. */
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const appointment = { id: "appt-1", professionalId: "p-tatiana", startAt: "2026-10-02T13:00:00.000Z", endAt: "2026-10-02T14:00:00.000Z", priceCents: 5000, status: "CONFIRMED",
  notes: null, clientName: "Cliente", clientPhone: null, serviceIds: ["s-corte"], serviceName: "Corte", serviceColor: null, serviceCategory: null, waitlistCount: 0, waitlistNext: null,
  waitlist: [], isOverbooked: false, seriesId: null, stages: [], version: 1, hasPayment: false, pendingReschedule: null, events: [] };
function board(prefill?: AgendaPrefill, canManageAvailability = true) {
  return <AgendaBoard colorScope="salon:user" prefill={prefill} date="2026-10-02" salonName="Salão" timezone="America/Sao_Paulo"
    professionals={[{ id: "p-tatiana", name: "Tatiana", colorHex: null, avatarUrl: null, serviceIds: ["s-corte"], workingHours: [] }, { id: "p-rodrigo", name: "Rodrigo", colorHex: null, avatarUrl: null, serviceIds: ["s-corte"], workingHours: [] }]}
    appointments={[appointment] as never} services={[{ id: "s-corte", name: "Corte", durationMin: 30, priceCents: 5000 }]} clients={[{ id: "c-carla", name: "Carla", phone: null }]}
    canOverbook={false} canOverrideBreak={false} canRepeat canCreate canCancel={false} canManageAvailability={canManageAvailability} />;
}

describe("agenda board deep links", () => {
  it("opens the prefilled new-appointment form on load", () => {
    render(board({ linked: true, create: { startLocal: "2026-10-02T15:00", proId: "p-rodrigo", clientId: "c-carla", serviceIds: ["s-corte"] } }));
    const form = screen.getByRole("dialog", { name: "Novo agendamento" });
    expect([form.dataset.start, form.dataset.professional, form.dataset.client, form.dataset.services]).toEqual(["2026-10-02T15:00", "p-rodrigo", "c-carla", "s-corte"]);
  });
  it("a later link while the agenda is open applies too (appointment detail, then the block form)", () => {
    const view = render(board());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(board({ linked: true, detailId: "appt-1" }));
    expect(screen.getByRole("dialog", { name: "Agendamento" }).dataset.id).toBe("appt-1");
    view.rerender(board({ linked: true, block: { professionalId: "p-rodrigo", startLocal: "2026-10-02T10:00", endLocal: "2026-10-02T11:00" } }));
    expect(screen.getByRole("dialog", { name: "Bloquear horário" }).dataset.selection).toBe("p-rodrigo|2026-10-02T10:00|2026-10-02T11:00");
  });
  it("the block form needs the right to manage availability", () => {
    render(board({ linked: true, block: { professionalId: "p-rodrigo", startLocal: "2026-10-02T10:00", endLocal: "2026-10-02T11:00" } }, false));
    expect(screen.queryByRole("dialog", { name: "Bloquear horário" })).not.toBeInTheDocument();
  });
});
