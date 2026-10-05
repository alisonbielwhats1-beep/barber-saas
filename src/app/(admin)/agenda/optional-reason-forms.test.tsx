// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addOpening: vi.fn(),
  removeOpening: vi.fn(),
  previewSeriesEdit: vi.fn(),
  applySeriesEdit: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("./opening-actions", () => ({ addOpening: mocks.addOpening, removeOpening: mocks.removeOpening }));
vi.mock("./series-actions", () => ({ previewSeriesEdit: mocks.previewSeriesEdit, applySeriesEdit: mocks.applySeriesEdit }));
import { OpeningPanel } from "./opening-panel";
import { SeriesEditor } from "./series-editor";

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

describe("expediente extra: motivo opcional na tela", () => {
  const props = {
    date: "2032-08-05",
    timezone: "America/Sao_Paulo",
    professionals: [{ id: "pro-a", name: "Ana" }],
    openings: [
      { id: "o1", professionalId: "pro-a", dateKey: "2032-08-05", startMinutes: 1080, endMinutes: 1200, reason: "Sábado especial" },
      { id: "o2", professionalId: "pro-a", dateKey: "2032-08-06", startMinutes: 600, endMinutes: 720, reason: "Sem motivo informado" },
    ],
  };

  it("lista só o motivo que foi informado, sem exibir o marcador interno", () => {
    render(<OpeningPanel {...props} />);
    expect(screen.getByText(/Sábado especial/)).toBeInTheDocument();
    expect(screen.queryByText(/Sem motivo informado/)).toBeNull();
  });

  it("o campo é rotulado como opcional, sem required nem minLength, e envia vazio", async () => {
    mocks.addOpening.mockResolvedValue({ success: true });
    render(<OpeningPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Liberar expediente extra/ }));

    const reason = await screen.findByLabelText("Motivo (opcional)");
    expect(reason).not.toBeRequired();
    expect(reason).not.toHaveAttribute("minlength");

    fireEvent.click(screen.getByRole("button", { name: "Salvar expediente extra" }));
    await waitFor(() => expect(mocks.addOpening).toHaveBeenCalledOnce());
    expect(mocks.addOpening).toHaveBeenCalledWith(expect.objectContaining({ professionalId: "pro-a", reason: "" }));
  });
});

describe("edição de série: motivo opcional na tela", () => {
  it("o campo é opcional e a revisão e a aplicação seguem sem motivo", async () => {
    mocks.previewSeriesEdit.mockResolvedValue([
      { id: "a1", version: 2, name: "Cliente", before: "2032-08-05T09:00", startLocal: "2032-08-05T10:00", conflict: null },
    ]);
    mocks.applySeriesEdit.mockResolvedValue([{ id: "a1", success: true, message: "Reagendado" }]);
    render(<SeriesEditor appointmentId="appointment-1" />);

    const reason = screen.getByLabelText("Motivo (opcional)");
    expect(reason).not.toBeRequired();
    expect(reason).not.toHaveAttribute("minlength");

    fireEvent.change(screen.getByLabelText(/Novo horário/), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar ocorrências" }));
    await waitFor(() => expect(mocks.previewSeriesEdit).toHaveBeenCalledOnce());
    expect(mocks.previewSeriesEdit).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: "appointment-1", reason: "" }));

    const apply = await screen.findByRole("button", { name: /Aplicar em 1 selecionada/ });
    fireEvent.click(apply);
    await waitFor(() => expect(mocks.applySeriesEdit).toHaveBeenCalledOnce());
    expect(mocks.applySeriesEdit).toHaveBeenCalledWith(expect.objectContaining({ reason: "" }));
    expect(within(document.body).getByText(/Reagendado/)).toBeInTheDocument();
  });
});
