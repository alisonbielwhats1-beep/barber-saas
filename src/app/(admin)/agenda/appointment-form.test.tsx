// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  createRecurring: vi.fn(),
  onOpenChange: vi.fn(),
}));

vi.mock("./actions", () => ({
  createAppointmentManually: mocks.create,
  createRecurringAppointments: mocks.createRecurring,
}));

import { AppointmentDialog } from "./appointment-form";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create
    .mockResolvedValueOnce({
      error: "Este horário fica dentro de uma pausa do profissional",
      code: "WORKING_HOURS_BREAK",
    })
    .mockResolvedValueOnce({ success: true });
});
afterEach(cleanup);

function mount() {
  render(
    <AppointmentDialog
      open
      onOpenChange={mocks.onOpenChange}
      slotStartLocal="2030-09-11T13:30"
      professionalId="professional-a"
      professionals={[{
        id: "professional-a",
        name: "Alex Profissional",
        serviceIds: ["service-a"],
      }]}
      services={[{
        id: "service-a",
        name: "Corte",
        durationMin: 30,
        priceCents: 5_000,
      }]}
      clients={[{ id: "client-a", name: "Cliente A", phone: null }]}
      canOverbook={false}
      canOverrideBreak
      canRepeat={false}
      timezone="America/Sao_Paulo"
    />,
  );
}

describe("formulário de encaixe durante pausa", () => {
  it("pede motivo e confirma explicitamente a exceção", async () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    const clientSelect = document.querySelector<HTMLSelectElement>('select[name="clientId"]');
    expect(clientSelect).not.toBeNull();
    fireEvent.change(clientSelect!, { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Pausa do profissional")).toBeInTheDocument();
    expect(screen.queryByText("Repetir agendamento")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Motivo da exceção (obrigatório)"), {
      target: { value: "Cliente só pode vir no almoço" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agendar durante a pausa" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![0]).toEqual(expect.objectContaining({
      professionalId: "professional-a",
      clientId: "client-a",
      startLocal: "2030-09-11T13:30",
      overbookReason: "Cliente só pode vir no almoço",
    }));
    await waitFor(() => expect(mocks.onOpenChange).toHaveBeenCalledWith(false));
  });
});
