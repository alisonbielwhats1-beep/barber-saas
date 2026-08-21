// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HojeView, type TodayAppointment } from "./hoje-view";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
const statusAction = vi.hoisted(() => ({ update: vi.fn(), reminder: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));
vi.mock("../agenda/actions", () => ({
  updateAppointmentStatus: statusAction.update,
  markReminderSent: statusAction.reminder,
}));

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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HojeView", () => {
  it("oferece a próxima ação e atualiza a agenda depois do status", async () => {
    const user = userEvent.setup();
    render(
      <HojeView
        date="2026-08-20"
        timezone="America/Sao_Paulo"
        currency="BRL"
        appointments={appointments}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Confirmar presença" }));

    await waitFor(() => expect(statusAction.update).toHaveBeenCalledWith(
      "appt-pending",
      "CONFIRMED",
      expect.objectContaining({ expectedVersion: 2 }),
    ));
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("filtra encerrados sem esconder o total do dia", async () => {
    const user = userEvent.setup();
    render(
      <HojeView
        date="2026-08-20"
        timezone="America/Sao_Paulo"
        currency="BRL"
        appointments={appointments}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Encerrados/ }));
    expect(screen.getByText("Cliente Concluído")).toBeInTheDocument();
    expect(screen.queryByText("Cliente Pendente")).toBeNull();
    expect(screen.getByText("Agendamentos")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("abre o WhatsApp com mensagem pronta e registra o lembrete manual", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <HojeView
        date="2026-08-20"
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
    await waitFor(() => expect(statusAction.reminder).toHaveBeenCalledWith("appt-pending"));
  });
});
