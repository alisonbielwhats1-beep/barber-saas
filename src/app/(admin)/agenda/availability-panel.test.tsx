// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./availability-actions", () => ({
  blockAvailability: vi.fn(),
  removeAvailabilityBlock: vi.fn(),
  cancelSelectedAppointments: vi.fn(),
  previewAvailabilityBlock: vi.fn(),
}));

vi.mock("./weekly-pause-panel", () => ({
  WeeklyPausePanel: () => <button type="button">Pausa recorrente</button>,
}));

import { AvailabilityPanel } from "./availability-panel";
import { blockAvailability, previewAvailabilityBlock } from "./availability-actions";

afterEach(cleanup);

const professionals = [
  { id: "professional-a", name: "Alex Profissional" },
  { id: "professional-b", name: "Bia Profissional" },
];

describe("atalhos de disponibilidade", () => {
  it("envia 18:45–19:30 pelo atalho + sem arredondar os minutos", async () => {
    vi.mocked(previewAvailabilityBlock).mockResolvedValue({ affected: [], occurrences: 1, first: "2030-09-12T21:45:00Z", last: "2030-09-12T22:30:00Z" });
    vi.mocked(blockAvailability).mockResolvedValue({ success: true, affected: [] });
    render(<AvailabilityPanel date="2030-09-12" timezone="America/Sao_Paulo" professionals={professionals} blocks={[]} initialPreset="interval" />);
    expect(screen.getByLabelText("Hora de início")).toHaveAttribute("type", "time");
    fireEvent.click(screen.getByRole("button", { name: "Digitar hora de início" }));
    fireEvent.change(screen.getByLabelText("Hora de início"), { target: { value: "1845" } });
    fireEvent.change(screen.getByLabelText("Hora de fim"), { target: { value: "19:30" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Pausa após atendimento" } });
    expect(screen.getByLabelText("Hora de início")).toHaveValue("18:45");
    fireEvent.click(screen.getByRole("button", { name: "Revisar bloqueio" }));
    await screen.findByRole("button", { name: "Confirmar bloqueio" });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar bloqueio" }));
    await waitFor(() => expect(blockAvailability).toHaveBeenCalledWith(expect.objectContaining({ startLocal: "2030-09-12T18:45", endLocal: "2030-09-12T19:30" })));
  });
  it("abre um novo bloqueio na data selecionada", () => {
    render(
      <AvailabilityPanel
        date="2030-09-12"
        timezone="America/Sao_Paulo"
        professionals={professionals}
        blocks={[]}
        initialPreset="interval"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Bloquear disponibilidade" })).toBeInTheDocument();
    expect(screen.getByLabelText("Hora de início")).toHaveValue("12:00");
    expect(screen.getByLabelText("Hora de fim")).toHaveValue("13:00");
  });

  it("prepara a folga para o dia inteiro e mantém a revisão obrigatória", () => {
    render(
      <AvailabilityPanel
        date="2030-09-12"
        timezone="America/Sao_Paulo"
        professionals={professionals}
        blocks={[]}
        initialPreset="day"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Adicionar folga" })).toBeInTheDocument();
    expect(screen.getByLabelText("Hora de início")).toHaveValue("00:00");
    expect(screen.getByLabelText("Hora de fim")).toHaveValue("00:00");
    expect(screen.getByLabelText("Motivo")).toHaveValue("Folga");
    expect(screen.getByRole("button", { name: "Revisar bloqueio" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  });
});
