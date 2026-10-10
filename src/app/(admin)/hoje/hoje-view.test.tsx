// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { HojeView, type TodayAppointment } from "./hoje-view";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
const statusAction = vi.hoisted(() => ({ update: vi.fn(), reminder: vi.fn() }));
const checkIn = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));
vi.mock("../agenda/actions", () => ({
  updateAppointmentStatus: statusAction.update,
  markReminderSent: statusAction.reminder,
}));
vi.mock("./actions", () => ({ registerArrival: checkIn }));

const appointments: TodayAppointment[] = [
  {
    id: "appt-pending",
    startAt: "2026-08-20T12:00:00.000Z",
    endAt: "2026-08-20T12:30:00.000Z",
    status: "PENDING",
    version: 2,
    priceCents: 5000,
    hasPayment: false,
    clientName: "Cliente Pendente",
    clientPhone: "(11) 99999-1111",
    professionalName: "Ana",
    serviceName: "Corte",
  },
  {
    id: "appt-completed",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T10:30:00.000Z",
    status: "COMPLETED",
    version: 3,
    priceCents: 7000,
    hasPayment: true,
    clientName: "Cliente Concluído",
    clientPhone: null,
    professionalName: "Bruno",
    serviceName: "Barba",
  },
];

beforeEach(() => {
  navigation.refresh.mockReset();
  statusAction.update.mockReset().mockResolvedValue({ success: true });
  statusAction.reminder.mockReset().mockResolvedValue(undefined);
  checkIn.mockReset().mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HojeView", () => {
  it("oferece a próxima ação e atualiza a agenda depois do status", async () => {
    const user = userEvent.setup();
    render(
      <HojeView colorScope="test-salon:test-user"
        date="2026-08-20"
        initialNowMs={Date.parse("2026-08-20T13:00:00.000Z")}
        timezone="America/Sao_Paulo"
        currency="BRL"
        appointments={appointments}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    await waitFor(() => expect(statusAction.update).toHaveBeenCalledWith(
      "appt-pending",
      "CONFIRMED",
      expect.objectContaining({ expectedVersion: 2 }),
    ));
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("abre em Em aberto, sem cancelados misturados, e Todos continua disponível", async () => {
    const user = userEvent.setup();
    render(
      <HojeView colorScope="test-salon:test-user"
        date="2026-08-20"
        initialNowMs={Date.parse("2026-08-20T13:00:00.000Z")}
        timezone="America/Sao_Paulo"
        currency="BRL"
        appointments={[...appointments, { ...appointments[0], id: "appt-cancelled", status: "CANCELLED", clientName: "Cliente Cancelado" }]}
      />,
    );

    expect(screen.getByRole("button", { name: /Em aberto/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Cliente Pendente")).toBeInTheDocument();
    expect(screen.queryByText("Cliente Cancelado")).toBeNull();
    expect(screen.queryByText("Cliente Concluído")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Todos/ }));
    expect(screen.getByText("Cliente Cancelado")).toBeInTheDocument();
    expect(screen.getByText("Cliente Concluído")).toBeInTheDocument();
  });

  it("filtra encerrados sem esconder o total do dia", async () => {
    const user = userEvent.setup();
    render(
      <HojeView colorScope="test-salon:test-user"
        date="2026-08-20"
        initialNowMs={Date.parse("2026-08-20T13:00:00.000Z")}
        timezone="America/Sao_Paulo"
        currency="BRL"
        appointments={appointments}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Encerrados/ }));
    expect(screen.getByText("Cliente Concluído")).toBeInTheDocument();
    expect(screen.queryByText("Cliente Pendente")).toBeNull();
    expect(screen.getByText("Agendamentos")).toBeInTheDocument();
    // the day total stays in the summary card (the filter row also shows counts now)
    expect(within(screen.getByText("Agendamentos").closest("div")!).getByText("2")).toBeInTheDocument();
  });

  it("abre o WhatsApp com mensagem pronta e registra o lembrete manual", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <HojeView colorScope="test-salon:test-user"
        date="2026-08-20"
        initialNowMs={Date.parse("2026-08-20T13:00:00.000Z")}
        salonName="Luna Hair Studio"
        timezone="America/Sao_Paulo"
        currency="BRL"
        appointments={appointments}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Enviar lembrete pelo WhatsApp para Cliente Pendente/i }));

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me/5511999991111"),
      "_blank",
      "noopener,noreferrer",
    );
    expect(statusAction.reminder).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar envio manual" }));
    await waitFor(() => expect(statusAction.reminder).toHaveBeenCalledWith("appt-pending"));
  });
});

describe("HojeView no celular (abaixo de 768 px)", () => {
  // O Tailwind não é compilado no jsdom: o que dá para garantir é que nenhum ancestral esconde o elemento no celular.
  const HIDDEN_ON_PHONE = new Set(["hidden", "max-md:hidden", "max-sm:hidden", "max-lg:hidden", "sr-only", "max-md:sr-only"]);
  function hiddenOnPhone(element: HTMLElement) {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      if (node.className.toString().split(/\s+/).some((token) => HIDDEN_ON_PHONE.has(token))) return true;
    }
    return false;
  }
  const withProgress: TodayAppointment[] = [
    ...appointments,
    { ...appointments[0], id: "appt-progress", status: "IN_PROGRESS", clientName: "Cliente em Atendimento", startAt: "2026-08-20T11:00:00.000Z", endAt: "2026-08-20T11:45:00.000Z" },
    { ...appointments[1], id: "appt-completed-2", clientName: "Outro Concluído" },
  ];
  function renderView() {
    return render(
      <HojeView colorScope="test-salon:test-user"
        date="2026-08-20"
        initialNowMs={Date.parse("2026-08-20T13:00:00.000Z")}
        timezone="America/Sao_Paulo"
        currency="BRL"
        appointments={withProgress}
      />,
    );
  }

  it("mostra os quatro números do resumo, inclusive Em atendimento, numa faixa compacta", () => {
    renderView();
    const strip = screen.getByRole("region", { name: "Resumo do dia" });
    const expected: Array<[label: string, value: string]> = [["Agendamentos", "4"], ["A confirmar", "1"], ["Em atendimento", "1"], ["Concluídos", "2"]];
    // "Em atendimento" também é o rótulo do status na lista: a busca fica dentro da faixa.
    for (const [label, value] of expected) {
      const caption = within(strip).getByText(label);
      expect(hiddenOnPhone(caption)).toBe(false);
      const card = caption.closest("div")!;
      expect(within(card).getByText(value)).toBeInTheDocument();
      expect(hiddenOnPhone(within(card).getByText(value))).toBe(false);
      // Compacto no celular: sem a pastilha de ícone e sem o cartão; no computador o cartão do protótipo.
      expect(card.className).toContain("max-md:border-0");
      expect(card.className).toContain("p-4");
      expect(card.className).toContain("rounded-[14px]");
    }
    // Quatro números numa linha; 2 × 2 abaixo de 400 px, como no protótipo.
    expect(strip.className).toContain("grid-cols-4");
    expect(strip.className).toContain("max-[399px]:grid-cols-2");
    expect(strip.className.split(/\s+/)).not.toContain("max-md:hidden");
  });

  it("mantém o seletor de cor da agenda no celular, como botão compacto, e grava a escolha", async () => {
    const user = userEvent.setup();
    renderView();
    const select = screen.getByRole("combobox", { name: "Colorir agenda por" });
    expect(hiddenOnPhone(select)).toBe(false);
    expect(select).toBeEnabled();
    const label = select.closest("label")!;
    expect(label.className).toContain("max-md:w-11");
    expect(label.className).toContain("max-md:relative");
    expect(select.className).toContain("max-md:absolute");
    expect(hiddenOnPhone(label)).toBe(false);

    await user.selectOptions(select, "status");
    expect(select).toHaveValue("status");
    expect(window.localStorage.getItem("agenda-colors:v1:test-salon:test-user")).toBe("status");
  });

  it("no celular o seletor de cor fica na linha do título e os quatro filtros ganham a linha de baixo", () => {
    renderView();
    const filters = screen.getByRole("group", { name: "Filtrar atendimentos" });
    const colorSlot = screen.getByRole("combobox", { name: "Colorir agenda por" }).closest("label")!.parentElement!;
    const title = screen.getByRole("heading", { name: "Atendimentos do dia" }).parentElement!;
    expect(title.className).toContain("max-md:order-1");
    expect(title.className).not.toContain("sr-only");
    expect(colorSlot.className).toContain("max-md:order-2");
    expect(filters.className).toContain("max-md:order-3");
    expect(filters.className).toContain("max-md:basis-full");
    expect(filters.parentElement).toBe(colorSlot.parentElement);
    // name and count stay one accessible label ("Em aberto 2"), with the count above the name on the phone
    expect(screen.getByRole("button", { name: /^Em aberto \d+$/ })).toBeInTheDocument();
    expect(within(filters).getAllByRole("button").map((button) => button.textContent?.replace(/[\s·\d]+/g, " ").trim())).toEqual(["Todos", "A confirmar", "Em aberto", "Encerrados"]);
  });

  it("mantém uma ação principal e os ícones no cartão; as demais ações ficam no ⋯", async () => {
    const user = userEvent.setup();
    renderView();
    const card = screen.getByText("Cliente Pendente").closest("article")!;
    const main = within(card).getByRole("button", { name: "Confirmar reserva" });
    expect(hiddenOnPhone(main)).toBe(false);
    expect(within(card).getByRole("link", { name: /Ligar para Cliente Pendente/ })).toHaveAttribute("href", "tel:+5511999991111");
    expect(hiddenOnPhone(within(card).getByRole("button", { name: /Enviar lembrete pelo WhatsApp/ }))).toBe(false);
    expect(within(card).queryByRole("button", { name: "Marcar falta" })).toBeNull();

    await user.click(within(card).getByRole("button", { name: "Mais ações para Cliente Pendente" }));
    const sheet = await screen.findByRole("dialog", { name: "Cliente Pendente" });
    expect(within(sheet).getByRole("link", { name: /Ver detalhes/ })).toHaveAttribute("href", "/agenda?date=2026-08-20&appointment=appt-pending&from=hoje");
    await user.click(within(sheet).getByRole("button", { name: "Marcar falta" }));
    await waitFor(() => expect(statusAction.update).toHaveBeenCalledWith("appt-pending", "NO_SHOW", expect.objectContaining({ expectedVersion: 2 })));
  });
});

describe("HojeView: Próximo, Pendências e chegada", () => {
  const nowMs = Date.parse("2026-08-20T13:00:00.000Z"); // 10:00 em São Paulo
  const day: TodayAppointment[] = [
    { ...appointments[0], id: "appt-started", status: "CONFIRMED", clientName: "Cliente Atrasada", startAt: "2026-08-20T12:30:00.000Z", endAt: "2026-08-20T13:30:00.000Z", version: 4 },
    { ...appointments[0], id: "appt-next", status: "CONFIRMED", clientName: "Cliente Próxima", professionalName: "Marina Alves", serviceName: "Manicure", startAt: "2026-08-20T13:25:00.000Z", endAt: "2026-08-20T14:10:00.000Z", version: 7 },
    { ...appointments[1], id: "appt-unpaid", hasPayment: false, clientName: "Cliente sem pagamento" },
    appointments[0],
  ];
  function renderDay(extra: { receipts?: ReactNode } = {}) {
    return render(
      <HojeView colorScope="test-salon:test-user" date="2026-08-20" initialNowMs={nowMs}
        timezone="America/Sao_Paulo" currency="BRL" appointments={day} {...extra} />,
    );
  }

  it("mostra o próximo atendimento com o tempo até ele e a ação principal", async () => {
    const user = userEvent.setup();
    renderDay();
    const next = screen.getByRole("region", { name: "Próximo atendimento" });
    expect(within(next).getByText("Próximo · em 25 min")).toBeInTheDocument();
    expect(within(next).getByText("Cliente Próxima")).toBeInTheDocument();
    expect(within(next).getByRole("link", { name: "Ver na agenda" })).toHaveAttribute("href", "/agenda?date=2026-08-20");
    await user.click(within(next).getByRole("button", { name: "Registrar chegada" }));
    await waitFor(() => expect(checkIn).toHaveBeenCalledWith({ appointmentId: "appt-next", expectedVersion: 7 }));
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("depois do início, Iniciar é a ação principal e a chegada continua no cartão (computador) e no ⋯", async () => {
    const user = userEvent.setup();
    renderDay();
    const card = screen.getByText("Cliente Atrasada").closest("article")!;
    expect(within(card).getByRole("button", { name: "Iniciar atendimento" })).toBeInTheDocument();
    const arrival = within(card).getByRole("button", { name: "Registrar chegada" });
    expect(arrival.className).toContain("max-md:hidden");
    await user.click(arrival);
    await waitFor(() => expect(checkIn).toHaveBeenCalledWith({ appointmentId: "appt-started", expectedVersion: 4 }));

    await user.click(within(card).getByRole("button", { name: "Mais ações para Cliente Atrasada" }));
    const sheet = await screen.findByRole("dialog", { name: "Cliente Atrasada" });
    expect(within(sheet).getByRole("button", { name: "Registrar chegada" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Marcar falta" })).toBeInTheDocument();
  });

  it("lista as pendências do dia e leva à lista filtrada", async () => {
    const user = userEvent.setup();
    renderDay();
    const pendencias = screen.getByRole("region", { name: "Pendências do dia" });
    await user.click(within(pendencias).getByRole("button", { name: /1 reserva a confirmar/ }));
    expect(screen.getByRole("button", { name: /^A confirmar \d+$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Cliente Atrasada")).toBeNull();

    // Sem a baixa em lote (recepção), a linha de recebimentos mostra a lista de encerrados.
    await user.click(within(pendencias).getByRole("button", { name: /1 atendimento finalizado sem pagamento/ }));
    expect(screen.getByRole("button", { name: /^Encerrados \d+$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Cliente sem pagamento")).toBeInTheDocument();
  });

  it("põe a baixa em lote do dono na linha de recebimentos das Pendências", () => {
    renderDay({ receipts: <button type="button">Registrar recebimentos</button> });
    const pendencias = screen.getByRole("region", { name: "Pendências do dia" });
    expect(within(pendencias).getByRole("button", { name: "Registrar recebimentos" })).toBeInTheDocument();
    expect(within(pendencias).getByText(/atendimento finalizado sem pagamento/)).toBeInTheDocument();
    expect(within(pendencias).queryByRole("button", { name: /finalizado sem pagamento/ })).toBeNull();
  });
});

