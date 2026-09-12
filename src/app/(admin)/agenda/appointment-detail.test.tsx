// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Appointment } from "./agenda-board";

const mocks = vi.hoisted(() => ({ edit: vi.fn(), close: vi.fn() }));
vi.mock("./actions", () => ({ editAppointment: mocks.edit }));
vi.mock("./comanda-panel", () => ({ ComandaPanel: () => null }));
vi.mock("./care-panel", () => ({ CarePanel: () => null }));
vi.mock("./series-editor", () => ({ SeriesEditor: () => null }));
import { AppointmentDetail } from "./appointment-detail";

const appt: Appointment = {
  id: "a", professionalId: "pro", startAt: "2032-08-05T20:30:00Z", endAt: "2032-08-05T21:00:00Z",
  priceCents: 5000, status: "CONFIRMED", notes: null, clientName: "Cliente fictício", clientPhone: null,
  serviceName: "Corte", serviceColor: null, waitlistCount: 0, waitlistNext: null, waitlist: [], isOverbooked: false,
  version: 1, serviceIds: ["cut"], hasPayment: false, pendingReschedule: null, events: [],
};
function mount() {
  render(<AppointmentDetail appt={appt} salonName="Salão fictício" timezone="America/Sao_Paulo" canCreate canCancel onClose={mocks.close} services={[
    { id: "cut", name: "Corte", durationMin: 30, priceCents: 5000 },
    { id: "beard", name: "Barba", durationMin: 15, priceCents: 2000 },
  ]} />);
  fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
}
beforeEach(() => { vi.clearAllMocks(); mocks.edit.mockReset(); });
afterEach(cleanup);

describe("edição dos serviços e resposta da agenda", () => {
  it("adiciona serviços, recalcula duração e mantém bloqueio de envio até a resposta", async () => {
    let resolve!: (value: { success: true; requiresAcceptance: true }) => void;
    mocks.edit.mockReturnValue(new Promise(r => { resolve = r; }));
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Barba/ }));
    expect(screen.getByText(/45min/)).toBeInTheDocument();
    expect(screen.getByText(/18:15 de 05\/08/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledOnce());
    expect(mocks.edit.mock.calls[0][0]).toMatchObject({ serviceIds: ["cut", "beard"], expectedVersion: 1 });
    expect(screen.getByLabelText("Horário do agendamento")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(mocks.edit).toHaveBeenCalledOnce();
    resolve({ success: true, requiresAcceptance: true });
    await screen.findByText(/A reserva original permanece/);
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("substitui serviço e preserva seleção/chave no retry; novo conteúdo recebe nova chave", async () => {
    mocks.edit.mockRejectedValue(new Error("network"));
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Barba/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await screen.findByRole("alert");
    const first = mocks.edit.mock.calls[0][0];
    expect(first.serviceIds).toEqual(["beard"]);
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2));
    expect(mocks.edit.mock.calls[1][0].idempotencyKey).toBe(first.idempotencyKey);
    await waitFor(() => expect(screen.getByLabelText("Horário do agendamento")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Horário do agendamento"), { target: { value: "17:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(3));
    expect(mocks.edit.mock.calls[2][0].idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("oferece exceção após recusa de término e pede motivo", async () => {
    mocks.edit.mockResolvedValueOnce({ error: "Após expediente", code: "AFTER_WORKING_HOURS" }).mockResolvedValueOnce({ success: true });
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Barba/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    const confirm = await screen.findByRole("button", { name: "Confirmar término após o expediente" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo da exceção"), { target: { value: "Autorizado no balcão" } });
    fireEvent.click(confirm);
    await screen.findByText("Agendamento atualizado.");
    expect(mocks.edit.mock.calls[1][0]).toMatchObject({ afterHoursReason: "Autorizado no balcão", serviceIds: ["cut", "beard"] });
  });
});
