// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ saveSalon: vi.fn(), saveTeam: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("./team-hours-actions", () => ({ saveSalonHours: mocks.saveSalon, saveTeamHours: mocks.saveTeam }));
vi.mock("../profissionais/working-hours-form", () => ({ WorkingHoursForm: () => <button type="button">Horários</button> }));

import { TeamHoursManager } from "./team-hours-manager";

const professionals = [{
  id: "pro-a",
  name: "Alex Silva",
  workingHours: [
    { weekday: 2, startMinutes: 360, endMinutes: 750 },
    { weekday: 2, startMinutes: 900, endMinutes: 1260 },
  ],
}];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveSalon.mockResolvedValue(undefined);
  mocks.saveTeam.mockResolvedValue(undefined);
});
afterEach(cleanup);

const mount = () => render(
  <TeamHoursManager professionals={professionals} openMinutes={360} closeMinutes={1260} />,
);

describe("configuração clara de salão e jornadas", () => {
  it("salva somente o horário geral por padrão e preserva jornadas individuais", async () => {
    mount();
    expect(screen.getByLabelText("Também substituir os horários dos profissionais")).not.toBeChecked();
    expect(screen.queryByLabelText("Substituir horário de Alex Silva")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revisar horário do salão" }));
    expect(screen.getByText("Os profissionais manterão os horários individuais atuais.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar somente horário do salão" }));
    await waitFor(() => expect(mocks.saveSalon).toHaveBeenCalledWith({
      openMinutes: 360,
      closeMinutes: 1260,
      confirmed: true,
    }));
    expect(mocks.saveTeam).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("jornadas individuais não foram alteradas");
  });

  it("só substitui uma jornada após ativar a cópia, selecionar e revisar antes/depois", async () => {
    mount();
    fireEvent.click(screen.getByLabelText("Também substituir os horários dos profissionais"));
    expect(screen.getByRole("button", { name: "Revisar horário e equipe" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Substituir horário de Alex Silva"));
    expect(screen.getByLabelText("Incluir a mesma pausa em todos os dias de trabalho selecionados")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Revisar horário e equipe" }));
    expect(screen.getByText(/Terça: 06:00–12:30 · 15:00–21:00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e substituir horários" }));
    await waitFor(() => expect(mocks.saveTeam).toHaveBeenCalledWith({
      professionalIds: ["pro-a"],
      openMinutes: 360,
      closeMinutes: 1260,
      pause: { startMinutes: 750, endMinutes: 900 },
      confirmed: true,
    }));
    expect(mocks.saveSalon).not.toHaveBeenCalled();
  });

  it("exige nova revisão quando o horário muda", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Revisar horário do salão" }));
    fireEvent.change(screen.getByLabelText(/Fechamento do salão/), { target: { value: "20:00" } });
    expect(screen.queryByRole("button", { name: "Salvar somente horário do salão" })).not.toBeInTheDocument();
  });

  it("mantém a escolha e permite repetir quando o servidor falha", async () => {
    mocks.saveSalon.mockRejectedValueOnce(new Error("Falha temporária"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Revisar horário do salão" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar somente horário do salão" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Falha temporária"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar somente horário do salão" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("jornadas individuais não foram alteradas"));
  });
});
