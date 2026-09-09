// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("./team-hours-actions", () => ({ saveTeamHours: mocks.save }));
vi.mock("../profissionais/working-hours-form", () => ({ WorkingHoursForm: () => <button type="button">Horários</button> }));
import { TeamHoursManager } from "./team-hours-manager";
const professionals = [{ id: "pro-a", name: "Alex Silva", workingHours: [{ weekday: 2, startMinutes: 360, endMinutes: 750 }, { weekday: 2, startMinutes: 900, endMinutes: 1260 }] }];
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue(undefined); });
afterEach(cleanup);
const mount = () => render(<TeamHoursManager professionals={professionals} openMinutes={360} closeMinutes={1260} />);
describe("configuração de jornada em um só lugar", () => {
  it("restaura pausa real e só grava após revisão explícita", async () => {
    mount();
    expect(screen.getByLabelText("Incluir pausa diária nos dias de trabalho")).toBeChecked();
    expect(screen.getByLabelText("Início da pausa")).toHaveValue("12:30");
    fireEvent.click(screen.getByRole("button", { name: "Revisar expediente" }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByText("Terça: 06:00–12:30 · 15:00–21:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e aplicar expediente" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ professionalIds: ["pro-a"], openMinutes: 360, closeMinutes: 1260, pause: { startMinutes: 750, endMinutes: 900 }, confirmed: true }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Expediente salvo"));
  });
  it("exige nova revisão se o horário mudar depois de revisar", () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Revisar expediente" }));
    fireEvent.change(screen.getByLabelText(/Fechamento do salão/), { target: { value: "20:00" } });
    expect(screen.queryByRole("button", { name: "Confirmar e aplicar expediente" })).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("mantém escolhas e permite repetir quando o servidor falha", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Falha temporária")); mount();
    fireEvent.click(screen.getByRole("button", { name: "Revisar expediente" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e aplicar expediente" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Falha temporária"));
    expect(screen.getByLabelText("Fim da pausa")).toHaveValue("15:00");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e aplicar expediente" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Expediente salvo"));
  });
  it("não oferece gravação com ninguém selecionado", () => {
    mount(); fireEvent.click(screen.getByLabelText("Alex Silva"));
    expect(screen.getByRole("button", { name: "Revisar expediente" })).toBeDisabled();
  });
});
