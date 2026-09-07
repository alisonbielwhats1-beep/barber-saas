// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NowStrip, type NowStripAppointment } from "./now-strip";

vi.mock("./whatsapp-reminder-button", () => ({ WhatsAppReminderButton: () => null }));
afterEach(cleanup);

const now = new Date("2026-09-07T15:00:00Z");
function appointment(id: string, time: string, status = "CONFIRMED"): NowStripAppointment {
  return { id, startAt: new Date(`2026-09-07T${time}:00Z`), status,
    client: { name: id, phone: null }, service: { name: "Corte", colorHex: null },
    professional: { user: { name: "Profissional" } } };
}
function show(appointments: NowStripAppointment[]) {
  render(<NowStrip appointments={appointments} salonName="Exemplo" timezone="America/Sao_Paulo"
    todayDate="2026-09-07" now={now} revenueToday={0} apptsToday={4} apptsTomorrow={0} outOfStock={0} />);
}

describe("prioridade dos próximos atendimentos", () => {
  it("distingue início ultrapassado, execução e o próximo horário sem declarar falta", () => {
    show([appointment("Revisar", "14:30"), appointment("Em execução", "14:45", "IN_PROGRESS"),
      appointment("Próximo", "15:30"), appointment("Pendente", "16:00", "PENDING")]);
    expect(within(screen.getByRole("link", { name: /Revisar, Corte/ })).getByText("Horário ultrapassado · revisar início")).toBeTruthy();
    expect(within(screen.getByRole("link", { name: /Próximo, Corte/ })).getByText("Próximo atendimento")).toBeTruthy();
    expect(within(screen.getByRole("link", { name: /Pendente, Corte/ })).getByText("Aguardando confirmação")).toBeTruthy();
    expect(screen.getAllByText("Próximo atendimento")).toHaveLength(1);
    expect(screen.queryByText(/Não compareceu|Faltou/)).toBeNull();
  });
  it("seleciona o horário mais próximo, inclusive pendente e no instante atual", () => {
    show([appointment("Mais tarde", "16:00"), appointment("Agora", "15:00", "PENDING")]);
    const current = within(screen.getByRole("link", { name: /Agora, Corte/ }));
    expect(current.getByText("Próximo atendimento")).toBeTruthy();
    expect(current.getByText("A confirmar")).toBeTruthy();
    expect(screen.queryByText(/Horário ultrapassado/)).toBeNull();
  });
  it("não inventa um próximo horário quando só há atendimentos iniciados ou passados", () => {
    show([appointment("Em execução", "14:45", "IN_PROGRESS"), appointment("Revisar", "14:30")]);
    expect(screen.queryByText("Próximo atendimento")).toBeNull();
  });
});
