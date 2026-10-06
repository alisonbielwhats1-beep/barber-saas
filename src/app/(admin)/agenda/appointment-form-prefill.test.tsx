// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ create: vi.fn(), createRecurring: vi.fn(), onOpenChange: vi.fn(), last: vi.fn(), search: vi.fn() }));
vi.mock("./actions", () => ({ createAppointmentManually: mocks.create, createRecurringAppointments: mocks.createRecurring, getLastAppointmentServices: mocks.last }));
vi.mock("./client-search-actions", () => ({ searchAppointmentClients: mocks.search }));
import { AppointmentDialog } from "./appointment-form";

/** B6 agenda fallback: the new-appointment form opened from a Secretária deep link comes prefilled (client, professional,
 * time and service) and is still the normal draft: nothing is created until the owner goes through its own confirmation. */
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({ success: true }); });
afterEach(cleanup);
function mount(initialServiceIds?: string[]) {
  render(<AppointmentDialog open onOpenChange={mocks.onOpenChange} slotStartLocal="2030-10-02T15:00" professionalId="professional-b"
    initialClient={{ id: "client-a", name: "Cliente A", phone: null }} initialServiceIds={initialServiceIds}
    professionals={[{ id: "professional-a", name: "Alex", serviceIds: ["service-a"] }, { id: "professional-b", name: "Bia", serviceIds: ["service-a", "service-b"] }]}
    services={[{ id: "service-a", name: "Corte", durationMin: 30, priceCents: 5_000 }, { id: "service-b", name: "Coloração", durationMin: 60, priceCents: 12_000 }]}
    clients={[{ id: "client-a", name: "Cliente A", phone: null }]} canOverbook={false} canOverrideBreak={false} canRepeat={false} timezone="America/Sao_Paulo" />);
}

describe("prefilled new-appointment form", () => {
  it("opens with the service already selected and books only after its own review and confirmation", async () => {
    mount(["service-b"]);
    expect(screen.getByRole("dialog", { name: "Novo agendamento" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("checkbox", { name: /Coloração/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Corte/ })).not.toBeChecked();
    expect(mocks.create).not.toHaveBeenCalled();
    const review = screen.queryByRole("button", { name: "Revisar" });
    if (review) fireEvent.click(review);
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar agendamento" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ professionalId: "professional-b", clientId: "client-a", serviceIds: ["service-b"], startLocal: "2030-10-02T15:00" });
  });
  it("without a prefill nothing is preselected", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("checkbox", { name: /Coloração/ })).not.toBeChecked();
  });
});
