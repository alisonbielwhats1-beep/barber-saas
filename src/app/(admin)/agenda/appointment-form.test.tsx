// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  createRecurring: vi.fn(),
  onOpenChange: vi.fn(),
  last: vi.fn(), search: vi.fn(),
}));

vi.mock("./actions", () => ({
  createAppointmentManually: mocks.create,
  createRecurringAppointments: mocks.createRecurring,
  getLastAppointmentServices: mocks.last,
}));

vi.mock("./client-search-actions", () => ({ searchAppointmentClients: mocks.search }));

import { AppointmentDialog } from "./appointment-form";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockReset()
    .mockResolvedValueOnce({
      error: "Este horário fica dentro de uma pausa do profissional",
      code: "WORKING_HOURS_BREAK",
    })
    .mockResolvedValueOnce({ success: true });
});
afterEach(cleanup);

function chooseClient(name = "Cliente A") {
  const edit = screen.queryByRole("button", { name: "Alterar cliente" });
  if (edit) fireEvent.click(edit);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}
function changeContext(time: string, date?: string) {
  fireEvent.click(screen.getByRole("button", { name: /Alterar data/ }));
  if (date) fireEvent.change(screen.getByLabelText("Data", {exact:true}), {target:{value:date}});
  fireEvent.change(screen.getByLabelText("Hora de início"), {target:{value:time}});
  fireEvent.click(screen.getByRole("button", {name:"Aplicar"}));
}
function confirmBooking() {
  const review=screen.queryByRole("button", {name:"Revisar"});
  if(review) fireEvent.click(review);
  fireEvent.click(screen.getByRole("button", {name:"Confirmar agendamento"}));
}
function mount(canRepeat = false, canOverbook = false, extraProfessionals = 0) {
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
      }, ...Array.from({length:extraProfessionals}, (_, i) => ({id:`pro-${i}`,name:`Profissional ${i}`,serviceIds:["service-a"]}))]}
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
    chooseClient();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    confirmBooking();
    await screen.findByText("Fora do expediente / folga");
    const confirm = screen.getByRole("button", { name: "Agendar fora do expediente" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo da exceção"), { target: { value: "Cliente combinado" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ scheduleOverrideReason: "Cliente combinado" });
    await screen.findByText("Falha temporária");
    changeContext("16:45");
    mocks.create.mockResolvedValueOnce({ success: true });
    confirmBooking();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(3));
    expect(mocks.create.mock.calls[2][0]).not.toHaveProperty("scheduleOverrideReason");
  });
  it("confirma explicitamente a exceção sem obrigar um motivo", async () => {
    mount();
    chooseClient();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    confirmBooking();

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
    chooseClient();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    confirmBooking();
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
    changeContext("11:50");
    chooseClient();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    confirmBooking();
    await screen.findByText(/Confira sua conexão/);
    expect(screen.getByText(/11:50/)).toBeInTheDocument();
    confirmBooking();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![0]).toEqual(mocks.create.mock.calls[0]![0]);
  });

  it.each(["09:15", "10:45", "11:50"])("envia %s e a data escolhida, sem arredondar", async time => {
    mocks.create.mockReset().mockResolvedValue({ success: true });
    mount();
    changeContext(time,"2030-09-12");
    chooseClient();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    confirmBooking();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      startLocal: `2030-09-12T${time}`,
    })));
  });

  it("usa a hora editada também para uma série", async () => {
    mocks.createRecurring.mockResolvedValue({ created: 4, skipped: [] });
    mount(true);
    changeContext("11:50");
    chooseClient();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    fireEvent.click(screen.getByText("Recorrência", {exact:true}));
    fireEvent.click(screen.getByRole("checkbox", { name: /Repetir agendamento/ }));
    fireEvent.click(screen.getByRole("button", {name:"Revisar"}));
    fireEvent.click(screen.getByRole("button", { name: "Criar série" }));
    await waitFor(() => expect(mocks.createRecurring).toHaveBeenCalledWith(expect.objectContaining({ startLocal: "2030-09-11T11:50" })));
  });

  it("trocar o horário invalida uma confirmação de pausa anterior", async () => {
    mount();
    chooseClient();
    fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
    confirmBooking();
    await screen.findByText("Pausa do profissional");
    changeContext("15:15");
    expect(screen.queryByRole("button", { name: "Agendar durante a pausa" })).not.toBeInTheDocument();
    confirmBooking();
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
    chooseClient();
    fireEvent.click(screen.getByRole("button", { name: "Usar serviços da última reserva" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Corte/ })).toBeChecked());
    expect(screen.getByText(/13:30/)).toBeInTheDocument();
  });

  it("não reaproveita parcialmente uma reserva com serviço indisponível", async () => {
    mocks.last.mockResolvedValue({ serviceIds: ["service-a", "removed"] });
    mount();
    chooseClient();
    fireEvent.click(screen.getByRole("button", { name: "Usar serviços da última reserva" }));
    await screen.findByText(/contém serviços indisponíveis/);
    expect(screen.getByRole("checkbox", { name: /Corte/ })).not.toBeChecked();
  });

  it("descarta a resposta antiga quando o cliente muda", async () => {
    let resolve!: (value: { serviceIds: string[] }) => void;
    mocks.last.mockReturnValue(new Promise(r => { resolve = r; }));
    mount();
    chooseClient();
    fireEvent.click(screen.getByRole("button", { name: "Usar serviços da última reserva" }));
    chooseClient("Cliente B");
    resolve({ serviceIds: ["service-a"] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Usar serviços da última reserva" })).toBeEnabled());
    expect(screen.getByRole("checkbox", { name: /Corte/ })).not.toBeChecked();
  });
});

it("pesquisa além da lista inicial, descarta resposta antiga e preserva cliente selecionado", async () => {
  let old!: (value: { id: string; name: string; phone: null }[]) => void;
  mocks.search.mockReturnValueOnce(new Promise(r => { old = r; })).mockResolvedValueOnce([{ id: "remote", name: "Gilberto", phone: null }]);
  mount();
  fireEvent.change(screen.getByLabelText("Pesquisar cliente"), { target: { value: "Ana" } });
  await waitFor(() => expect(mocks.search).toHaveBeenCalledWith("Ana"));
  fireEvent.change(screen.getByLabelText("Pesquisar cliente"), { target: { value: "Gil" } });
  await screen.findByRole("button", { name: /Gilberto/ });
  old([{ id: "stale", name: "Ana antiga", phone: null }]);
  await waitFor(() => expect(screen.queryByRole("button", { name: /Ana antiga/ })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", {name:/Gilberto/}));
  fireEvent.change(screen.getByLabelText("Pesquisar cliente"), { target: { value: "" } });
  expect(screen.getByRole("button", {name:/Gilberto/})).toHaveAttribute("aria-pressed","true");
  fireEvent.click(screen.getByRole("button", {name:"Continuar"}));
  fireEvent.click(screen.getByRole("checkbox", { name: /Corte/ }));
  confirmBooking();
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ clientId: "remote" });
});


it("preserva escolhas entre etapas e não grava antes da confirmação", () => {
  mount(); chooseClient();
  fireEvent.click(screen.getByRole("checkbox", {name:/Corte/}));
  fireEvent.click(screen.getByRole("button", {name:"Revisar"}));
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Alterar cliente"}));
  expect(screen.getByRole("button",{name:/Cliente A/})).toHaveAttribute("aria-pressed","true");
  fireEvent.click(screen.getByRole("button",{name:"Continuar"}));
  expect(screen.getByRole("checkbox",{name:/Corte/})).toBeChecked();
  fireEvent.click(screen.getByRole("button",{name:"Fechar janela"}));
  expect(screen.getByRole("heading",{name:"Descartar agendamento?"})).toBeInTheDocument();
  expect(screen.queryByRole("checkbox",{name:/Corte/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Continuar editando"}));
  expect(screen.getByRole("checkbox",{name:/Corte/})).toBeChecked();
  expect(mocks.onOpenChange).not.toHaveBeenCalled();
});

it("pesquisa e seleciona um profissional além dos dois primeiros", async () => {
  mocks.create.mockReset().mockResolvedValue({success:true});
  mount(false,false,12); chooseClient();
  fireEvent.click(screen.getByRole("checkbox",{name:/Corte/}));
  fireEvent.click(screen.getByRole("button",{name:"Alterar data, horário e profissional"}));
  fireEvent.change(screen.getByLabelText("Buscar profissional"),{target:{value:"Profissional 11"}});
  fireEvent.click(screen.getByRole("button",{name:"Profissional 11"}));
  fireEvent.click(screen.getByRole("button",{name:"Aplicar"}));
  expect(screen.getByRole("checkbox",{name:/Corte/})).toBeChecked();
  confirmBooking();
  await waitFor(()=>expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({professionalId:"pro-11",serviceIds:["service-a"]})));
});
