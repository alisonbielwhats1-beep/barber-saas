// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("./weekly-pause-actions", () => ({ previewWeeklyPause: mocks.preview, saveWeeklyPause: mocks.save }));
import { WeeklyPausePanel } from "./weekly-pause-panel";
beforeEach(() => { vi.clearAllMocks(); mocks.preview.mockResolvedValue({ version: "a".repeat(64), professionals: [] }); mocks.save.mockResolvedValue(undefined); });
afterEach(cleanup);
function mount() { render(<WeeklyPausePanel professionals={[{ id: "alex", name: "Alex Teste" }]} />); fireEvent.click(screen.getByRole("button", { name: "Pausa recorrente" })); }
describe("weekly pause form", () => {
  it("offers weekdays/weekends and requires a fresh review after changing days", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Sábado e domingo" }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar pausa" }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith({ professionalIds: ["alex"], weekdays: [0, 6], startMinutes: 750, endMinutes: 870 }));
    await screen.findByRole("button", { name: "Confirmar pausa semanal" });
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Segunda a sexta" }));
    expect(screen.queryByRole("button", { name: "Confirmar pausa semanal" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revisar pausa" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar pausa semanal" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ professionalIds: ["alex"], weekdays: [1, 2, 3, 4, 5], startMinutes: 750, endMinutes: 870 }, "a".repeat(64)));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Pausa semanal salva"));
  });
  it("retains choices and asks for review again after a server failure", async () => {
    mocks.save.mockRejectedValueOnce(new Error("A jornada mudou. Revise novamente.")); mount();
    fireEvent.change(screen.getByLabelText("Fim da pausa"), { target: { value: "15:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar pausa" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar pausa semanal" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Revise novamente"));
    expect(screen.getByLabelText("Fim da pausa")).toHaveValue("15:00");
    expect(screen.getByRole("button", { name: "Revisar pausa" })).toBeInTheDocument();
  });
});
