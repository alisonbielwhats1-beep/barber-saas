// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Appointment } from "./agenda-board";

const mocks = vi.hoisted(() => ({ edit: vi.fn(), close: vi.fn(), cancel: vi.fn(), cancelAndPromote: vi.fn(), schedule: vi.fn() }));
vi.mock("./actions", () => ({ editAppointment: mocks.edit, cancelAppointment: mocks.cancel, cancelAndPromoteWaitlist: mocks.cancelAndPromote }));
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
function save() {
  const review = screen.queryByRole("button", { name: "Revisar alterações" });
  if (review) fireEvent.click(review);
  fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
}
function mount() {
  render(<AppointmentDetail appt={appt} salonName="Salão fictício" timezone="America/Sao_Paulo" canCreate canCancel onClose={mocks.close} services={[
    { id: "cut", name: "Corte", durationMin: 30, priceCents: 5000 },
    { id: "beard", name: "Barba", durationMin: 15, priceCents: 2000 },
  ]} />);
  fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
  expect(screen.getByRole("button", { name: "Voltar aos detalhes do agendamento" })).toBeInTheDocument();
}
beforeEach(() => { vi.clearAllMocks(); mocks.edit.mockReset(); });
afterEach(cleanup);

describe("edição dos serviços e resposta da agenda", () => {
  it("mantém a versão do início da edição quando chega uma atualização concorrente", async () => {
    mocks.edit.mockResolvedValue({ error: "O agendamento mudou", code: "VERSION_CONFLICT" });
    const props = { salonName: "Salão fictício", timezone: "America/Sao_Paulo", canCreate: true, canCancel: true, onClose: mocks.close };
    const { rerender } = render(<AppointmentDetail {...props} appt={appt} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
    rerender(<AppointmentDetail {...props} appt={{ ...appt, version: 2, professionalId: "outro" }} />);
    save();
    await screen.findByText("O agendamento mudou");
    expect(mocks.edit.mock.calls[0][0]).toMatchObject({ expectedVersion: 1, professionalId: "pro" });
  });

  it("adiciona serviços, recalcula duração e mantém bloqueio de envio até a resposta", async () => {
    let resolve!: (value: { success: true; requiresAcceptance: true }) => void;
    mocks.edit.mockReturnValue(new Promise(r => { resolve = r; }));
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Barba/ }));
    expect(screen.getByText(/45min/)).toBeInTheDocument();
    expect(screen.getByText(/18:15 de 05\/08/)).toBeInTheDocument();
    save();
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledOnce());
    expect(mocks.edit.mock.calls[0][0]).toMatchObject({ serviceIds: ["cut", "beard"], expectedVersion: 1 });
    expect(screen.getByLabelText("Horário do agendamento")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    save();
    expect(mocks.edit).toHaveBeenCalledOnce();
    resolve({ success: true, requiresAcceptance: true });
    await screen.findByText(/O novo horário já está reservado/);
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("substitui serviço e preserva seleção/chave no retry; novo conteúdo recebe nova chave", async () => {
    mocks.edit.mockRejectedValue(new Error("network"));
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    expect(screen.getByRole("button", { name: "Revisar alterações" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Barba/ }));
    save();
    await screen.findByRole("alert");
    const first = mocks.edit.mock.calls[0][0];
    expect(first.serviceIds).toEqual(["beard"]);
    save();
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2));
    expect(mocks.edit.mock.calls[1][0].idempotencyKey).toBe(first.idempotencyKey);
    await waitFor(() => expect(screen.getByLabelText("Horário do agendamento")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Horário do agendamento"), { target: { value: "17:15" } });
    save();
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(3));
    expect(mocks.edit.mock.calls[2][0].idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("oferece exceção após recusa de término e pede motivo", async () => {
    mocks.edit.mockResolvedValueOnce({ error: "Após expediente", code: "AFTER_WORKING_HOURS" }).mockResolvedValueOnce({ success: true });
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Barba/ }));
    save();
    const confirm = await screen.findByRole("button", { name: "Confirmar exceção de jornada" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo da exceção"), { target: { value: "Autorizado no balcão" } });
    fireEvent.click(confirm);
    await screen.findByText("Agendamento atualizado.");
    expect(mocks.edit.mock.calls[1][0]).toMatchObject({ scheduleOverrideReason: "Autorizado no balcão", serviceIds: ["cut", "beard"] });
  });
});

it("mantém confirmações independentes de término e encaixe e invalida após editar horário", async () => {
  mocks.edit.mockResolvedValueOnce({ error: "Após expediente", code: "AFTER_WORKING_HOURS" })
    .mockResolvedValueOnce({ error: "Ocupado", code: "SLOT_TAKEN" }).mockResolvedValueOnce({ error: "Falha temporária" });
  mount();
  save();
  await screen.findByLabelText("Motivo da exceção");
  fireEvent.change(screen.getByLabelText("Motivo da exceção"), { target: { value: "Terminar depois" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar exceção de jornada" }));
  const confirm = await screen.findByRole("button", { name: "Confirmar encaixe" });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Motivo do encaixe"), { target: { value: "Intervalo da coloração" } });
  fireEvent.click(confirm);
  await screen.findByText("Falha temporária");
  expect(mocks.edit.mock.calls[2][0]).toMatchObject({ scheduleOverrideReason: "Terminar depois", overbookReason: "Intervalo da coloração" });
  fireEvent.change(screen.getByLabelText("Horário do agendamento"), { target: { value: "15:00" } });
  save();
  await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(4));
  expect(mocks.edit.mock.calls[3][0]).not.toHaveProperty("overbookReason");
  expect(mocks.edit.mock.calls[3][0]).not.toHaveProperty("scheduleOverrideReason");
});

describe("fila de espera no detalhe do agendamento", () => {
  const entry = {
    id: "entry-a", name: "Aline Prata", phone: "11957908895", serviceName: "Corte de cabelo masculino", position: 1,
    clientId: "client-aline", professionalId: "pro", startAt: "2032-08-05T20:30:00Z", serviceIds: ["cut"],
  };
  const withQueue: Appointment = { ...appt, waitlistCount: 1, waitlistNext: "Aline Prata", waitlist: [entry] };
  function mountQueue(onScheduleWaitlist?: typeof mocks.schedule) {
    render(<AppointmentDetail appt={withQueue} salonName="Salão fictício" timezone="America/Sao_Paulo" canCreate canCancel onClose={mocks.close} onScheduleWaitlist={onScheduleWaitlist} />);
  }

  it("agenda a pessoa da fila em outro horário e oferece WhatsApp e ligação", () => {
    mountQueue(mocks.schedule);
    fireEvent.click(screen.getByRole("button", { name: /Agendar em outro horário/ }));
    expect(mocks.schedule).toHaveBeenCalledWith(entry);
    expect(screen.getByRole("link", { name: "11957908895" })).toHaveAttribute("href", "tel:+5511957908895");
    const whatsapp = screen.getAllByRole("link", { name: /WhatsApp/ }).find(link => link.getAttribute("href")?.includes("fila%20de%20espera"));
    expect(whatsapp?.getAttribute("href")).toContain("wa.me/5511957908895");
    expect(screen.getByRole("button", { name: "Remover Aline Prata da fila" })).toBeInTheDocument();
  });

  it("sem permissão de criar, não mostra o atalho de agendamento", () => {
    mountQueue();
    expect(screen.queryByRole("button", { name: /Agendar em outro horário/ })).toBeNull();
  });

  it("cancelar comum mantém a fila; marcar a opção passa o horário à primeira pessoa", async () => {
    mocks.cancelAndPromote.mockResolvedValue({ success: true });
    mountQueue(mocks.schedule);
    fireEvent.click(screen.getByRole("button", { name: /Cancelar agendamento/ }));
    expect(screen.getByText(/ninguém entra no horário sozinho/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "Cliente desmarcou" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Passar este horário para Aline Prata/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar e passar o horário" }));
    await waitFor(() => expect(mocks.cancelAndPromote).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: "a", entryId: "entry-a", reason: "Cliente desmarcou", expectedVersion: 1,
    })));
    expect(mocks.cancel).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
  });

  it("erro ao passar o horário mantém o modal aberto com a explicação", async () => {
    mocks.cancelAndPromote.mockResolvedValue({ error: "O horário não serve para a primeira pessoa da fila. Nada foi cancelado." });
    mountQueue(mocks.schedule);
    fireEvent.click(screen.getByRole("button", { name: /Cancelar agendamento/ }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "Cliente desmarcou" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Passar este horário/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar e passar o horário" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nada foi cancelado");
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
