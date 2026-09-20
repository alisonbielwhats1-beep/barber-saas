// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VisitPlan } from "@/lib/visit-plan";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), confirm: vi.fn(), close: vi.fn(), back: vi.fn() }));
vi.mock("./visit-actions", () => ({ previewStaffVisit: mocks.preview, confirmStaffVisit: mocks.confirm }));
vi.mock("./client-search-actions", () => ({ searchAppointmentClients: vi.fn().mockResolvedValue([]) }));
vi.mock("./actions", () => ({ createAppointmentManually: vi.fn(), createRecurringAppointments: vi.fn(), getLastAppointmentServices: vi.fn() }));
import { StaffVisitDialog, type StaffVisitDraft } from "./visit-form";
import { AppointmentDialog } from "./appointment-form";

const client = { id: "client-a", name: "Cliente A", phone: null };
const draft: StaffVisitDraft = {
  date: "2030-09-11", time: "13:30", clientId: client.id, newClient: false,
  name: "", phone: "", chosen: client,
  rows: [
    { serviceId: "s1", professionalId: "p1", time: "13:30", customTime: true },
    { serviceId: "s2", professionalId: "p2", time: "13:30", customTime: true },
  ],
};
const plan: VisitPlan = {
  startLocal: "2030-09-11T13:30", endLocal: "2030-09-11T14:00", totalCents: 9000,
  items: draft.rows.map((row, i) => ({
    serviceId: row.serviceId, serviceName: `Serviço ${i + 1}`, professionalId: row.professionalId,
    professionalName: `Profissional ${i + 1}`, startLocal: "2030-09-11T13:30",
    endLocal: "2030-09-11T14:00", durationMin: 30, priceCents: 4500, priceType: "FIXED", priceNote: null,
  })),
};
function mount() {
  render(<StaffVisitDialog open onOpenChange={mocks.close} onBack={mocks.back}
    initialDraft={draft} slotStartLocal="2030-09-11T13:30" canOverride
    clients={[client]} professionals={[
      { id: "p1", name: "Profissional 1", serviceIds: ["s1"] },
      { id: "p2", name: "Profissional 2", serviceIds: ["s2"] },
    ]} services={[
      { id: "s1", name: "Corte", durationMin: 30, priceCents: 4000 },
      { id: "s2", name: "Barba", durationMin: 30, priceCents: 4000 },
    ]} />);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.preview.mockResolvedValue({ plan, quote: "server-quote" });
  mocks.confirm.mockResolvedValue({ success: true });
});
afterEach(cleanup);

describe("guided multi-professional booking", () => {
  it.each([false, true])("opens from the service step with an existing selection: %s and supports different specialties", async (selected) => {
    render(<AppointmentDialog open onOpenChange={mocks.close} professionalId="p1"
      canOverbook={false} canOverrideBreak={false} canRepeat={false}
      slotStartLocal="2030-09-11T13:30" timezone="America/Sao_Paulo"
      clients={[client]} professionals={[
        { id: "p1", name: "Profissional 1", serviceIds: ["s1"] },
        { id: "p2", name: "Profissional 2", serviceIds: ["s2"] },
      ]} services={[
        { id: "s1", name: "Corte", durationMin: 30, priceCents: 4000 },
        { id: "s2", name: "Barba", durationMin: 30, priceCents: 4000 },
      ]} />);
    fireEvent.click(screen.getByRole("button", { name: /Cliente A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    if (selected) fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar outro profissional" }));
    if (!selected) {
      fireEvent.click(screen.getByRole("button", { name: "Serviço 1" }));
      fireEvent.click(screen.getByRole("button", { name: /Corte/ }));
    }
    expect(screen.getByRole("button", { name: "Serviço 1" })).toHaveTextContent("Corte");
    expect(screen.getByRole("button", { name: "Profissional do serviço 1" })).toHaveTextContent("Profissional 1");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar outro serviço" }));
    fireEvent.click(screen.getByRole("button", { name: "Serviço 2" }));
    fireEvent.click(screen.getByRole("button", { name: /Barba/ }));
    expect(screen.getByRole("button", { name: "Profissional do serviço 2" })).toHaveTextContent("Profissional 2");
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revisar visita" }));
    await screen.findByRole("button", { name: "Confirmar todos os serviços" });
    expect(mocks.preview.mock.calls[0][0]).toMatchObject({ clientId: client.id, startLocal: "2030-09-11T13:30", choices: [
      { serviceId: "s1", professionalId: "p1", offsetMin: 0 },
      { serviceId: "s2", professionalId: "p2", offsetMin: 30 },
    ] });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("preserves simultaneous times and confirms only the server quote after review", async () => {
    mount();
    expect(screen.getByLabelText(/^Início do serviço 2/)).toHaveValue("13:30");
    expect(mocks.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revisar visita" }));
    await screen.findByRole("button", { name: "Confirmar todos os serviços" });
    const request = mocks.preview.mock.calls[0][0];
    expect(request).toMatchObject({ clientId: client.id, startLocal: "2030-09-11T13:30", choices: [
      { serviceId: "s1", professionalId: "p1", offsetMin: 0 },
      { serviceId: "s2", professionalId: "p2", offsetMin: 0 },
    ] });
    expect(mocks.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar todos os serviços" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith({ ...request, quote: "server-quote" }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
  });

  it("returns the full draft without reserving anything", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Agendamento simples ou recorrente/ }));
    expect(mocks.back).toHaveBeenCalledWith(draft);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("keeps the quote and idempotency key when a confirmation loses its response", async () => {
    mocks.confirm.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ success: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Revisar visita" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar todos os serviços" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar todos os serviços" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.confirm.mock.calls[1][0]).toEqual(mocks.confirm.mock.calls[0][0]);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
  });
});
