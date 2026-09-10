// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

const professionals = [
  { id: "professional-a", name: "Alex Profissional" },
  { id: "professional-b", name: "Bia Profissional" },
];

describe("atalhos de disponibilidade", () => {
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
    expect(screen.getByLabelText("Início")).toHaveValue("2030-09-12T12:00");
    expect(screen.getByLabelText("Fim")).toHaveValue("2030-09-12T13:00");
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
    expect(screen.getByLabelText("Início")).toHaveValue("2030-09-12T00:00");
    expect(screen.getByLabelText("Fim")).toHaveValue("2030-09-13T00:00");
    expect(screen.getByLabelText("Motivo")).toHaveValue("Folga");
    expect(screen.getByRole("button", { name: "Revisar bloqueio" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  });
});
