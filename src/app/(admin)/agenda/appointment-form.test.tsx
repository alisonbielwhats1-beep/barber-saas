// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  createRecurring: vi.fn(),
  onOpenChange: vi.fn(),
  last: vi.fn(),
}));

vi.mock("./actions", () => ({
  createAppointmentManually: mocks.create,
  createRecurringAppointments: mocks.createRecurring,
  getLastAppointmentServices: mocks.last,
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

function mount(canRepeat = false, canOverbook = false) {
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
      clients={[{ id: "client-a", name: "Cliente A", phone: null }, { id: "client-b", name: "Cliente B", phone: null }]}
      canOverbook={canOverbook}
      canOverrideBreak
      canRepeat={canRepeat}
      timezone="America/Sao_Paulo"
    />,
  );
}

describe("formulário de encaixe durante pausa", () => {
  it("confirma término após expediente com motivo e invalida a exceção quando o horário muda", async () => {
    mocks.create.mockReset().mockResolvedValueOnce({ error: "Após expediente", code: "AFTER_WORKING_HOURS" }).mockResolvedValueOnce({ error: "Falha temporária" });
    mount(false, true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    fireEvent.change(document.querySelector('select[name="clientId"]')!, { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByText("Término após o expediente");
    const confirm = screen.getByRole("button", { name: "Agendar com término após o expediente" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo da exceção"), { target: { value: "Cliente combinado" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ afterHoursReason: "Cliente combinado" });
    await screen.findByText("Falha temporária");
    fireEvent.change(document.querySelector('input[name="time"]')!, { target: { value: "16:45" } });
    mocks.create.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(3));
    expect(mocks.create.mock.calls[2][0]).not.toHaveProperty("afterHoursReason");
  });
  it("confirma explicitamente a exceção sem obrigar um motivo", async () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    const clientSelect = document.querySelector<HTMLSelectElement>('select[name="clientId"]');
    expect(clientSelect).not.toBeNull();
    fireEvent.change(clientSelect!, { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Pausa do profissional")).toBeInTheDocument();
    expect(screen.queryByText("Repetir agendamento")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Motivo da exceção (opcional)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Agendar durante a pausa" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![0]).toEqual(expect.objectContaining({
      professionalId: "professional-a",
      clientId: "client-a",
      startLocal: "2030-09-11T13:30",
      overrideConfirmed: true,
    }));
    expect(mocks.create.mock.calls[1]![0]).not.toHaveProperty("overbookReason");
    await waitFor(() => expect(mocks.onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("horário livre no formulário manual", () => {
  it("pede confirmação independente para bloqueio e sobreposição", async () => {
    mocks.create.mockReset().mockResolvedValueOnce({ error: "Bloqueado", code: "PROFESSIONAL_UNAVAILABLE" })
      .mockResolvedValueOnce({ error: "Ocupado", code: "SLOT_TAKEN" }).mockResolvedValueOnce({ success: true });
    mount(false, true);
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByText("Horário bloqueado");
    fireEvent.change(screen.getByLabelText("Motivo da exceção"), { target: { value: "Encaixe solicitado" } });
    fireEvent.click(screen.getByRole("button", { name: "Agendar mantendo o bloqueio" }));
    await screen.findByText("Horário já ocupado");
    expect(mocks.create.mock.calls[1]![0]).toMatchObject({ timeOffOverrideReason: "Encaixe solicitado" });
    expect(mocks.create.mock.calls[1]![0]).not.toHaveProperty("overbookReason");
    fireEvent.change(screen.getByLabelText("Motivo da exceção"), { target: { value: "Atender em paralelo" } });
    fireEvent.click(screen.getByRole("button", { name: "Encaixar mesmo assim" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(3));
    expect(mocks.create.mock.calls[2]![0]).toMatchObject({ timeOffOverrideReason: "Encaixe solicitado", overbookReason: "Atender em paralelo" });
  });
  it("mantém as escolhas e a chave idempotente após falha de conexão", async () => {
    mocks.create.mockReset().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ success: true });
    mount();
    fireEvent.change(screen.getByLabelText("Hora de início"), { target: { value: "11:50" } });
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByText(/Confira sua conexão/);
    expect(screen.getByLabelText("Hora de início")).toHaveValue("11:50");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![0]).toEqual(mocks.create.mock.calls[0]![0]);
  });

  it.each(["09:15", "10:45", "11:50"])("envia %s e a data escolhida, sem arredondar", async time => {
    mocks.create.mockReset().mockResolvedValue({ success: true });
    mount();
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2030-09-12" } });
    fireEvent.change(screen.getByLabelText("Hora de início"), { target: { value: time } });
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      startLocal: `2030-09-12T${time}`,
    })));
  });

  it("usa a hora editada também para uma série", async () => {
    mocks.createRecurring.mockResolvedValue({ created: 4, skipped: [] });
    mount(true);
    fireEvent.change(screen.getByLabelText("Hora de início"), { target: { value: "11:50" } });
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Repetir agendamento/ }));
    fireEvent.click(screen.getByRole("button", { name: "Criar série" }));
    await waitFor(() => expect(mocks.createRecurring).toHaveBeenCalledWith(expect.objectContaining({ startLocal: "2030-09-11T11:50" })));
  });

  it("trocar o horário invalida uma confirmação de pausa anterior", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByText("Pausa do profissional");
    fireEvent.change(screen.getByLabelText("Hora de início"), { target: { value: "15:15" } });
    expect(screen.queryByRole("button", { name: "Agendar durante a pausa" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![0]).toMatchObject({ startLocal: "2030-09-11T15:15" });
    expect(mocks.create.mock.calls[1]![0].idempotencyKey).not.toBe(mocks.create.mock.calls[0]![0].idempotencyKey);
    expect(mocks.create.mock.calls[1]![0]).not.toHaveProperty("overrideConfirmed");
  });
});

describe("serviços da última reserva", () => {
  it("seleciona os serviços compatíveis e preserva data/hora", async () => {
    mocks.last.mockResolvedValue({ serviceIds: ["service-a"] });
    mount();
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar serviços da última reserva" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Corte/ })).toBeChecked());
    expect(screen.getByLabelText("Hora de início")).toHaveValue("13:30");
  });

  it("não reaproveita parcialmente uma reserva com serviço indisponível", async () => {
    mocks.last.mockResolvedValue({ serviceIds: ["service-a", "removed"] });
    mount();
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar serviços da última reserva" }));
    await screen.findByText(/contém serviços indisponíveis/);
    expect(screen.getByRole("checkbox", { name: /Corte/ })).not.toBeChecked();
  });

  it("descarta a resposta antiga quando o cliente muda", async () => {
    let resolve!: (value: { serviceIds: string[] }) => void;
    mocks.last.mockReturnValue(new Promise(r => { resolve = r; }));
    mount();
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "client-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar serviços da última reserva" }));
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "client-b" } });
    resolve({ serviceIds: ["service-a"] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Usar serviços da última reserva" })).toBeEnabled());
    expect(screen.getByRole("checkbox", { name: /Corte/ })).not.toBeChecked();
  });
});
