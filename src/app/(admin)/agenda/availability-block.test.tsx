// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  remove: vi.fn(), update: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("./availability-actions", () => ({
  removeAvailabilityBlock: mocks.remove, updateAvailabilityBlock: mocks.update,
}));

import { AvailabilityBlockDialog, AvailabilityBlockTrigger } from "./availability-block";

const block = {
  id: "block-a",
  professionalId: "professional-a",
  startAt: "2030-09-11T16:30:00.000Z",
  endAt: "2030-09-11T17:30:00.000Z",
  reason: "Almoço",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.remove.mockResolvedValue(undefined);
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

describe("gestão do bloqueio pela grade", () => {
  it("transforma o bloqueio em uma ação identificável sem atravessar para o horário", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <AvailabilityBlockTrigger
        block={block}
        professionalName="Alex Profissional"
        timezone="America/Sao_Paulo"
        onOpen={onOpen}
      />,
    );

    await user.click(screen.getByRole("button", {
      name: "Abrir bloqueio de Alex Profissional, 13:30–14:30, Almoço",
    }));
    expect(onOpen).toHaveBeenCalledWith(block);
  });

  it("mostra os detalhes, confirma a reabertura e oferece agendar em seguida", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSchedule = vi.fn();
    render(
      <AvailabilityBlockDialog
        open
        onOpenChange={onOpenChange}
        block={block}
        professionalName="Alex Profissional"
        timezone="America/Sao_Paulo"
        onSchedule={onSchedule}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Bloqueio de horário" })).toBeInTheDocument();
    expect(screen.getByText("Alex Profissional")).toBeInTheDocument();
    expect(screen.getByText("Almoço")).toBeInTheDocument();
    expect(screen.getByText("11/09/2030 · 13:30–14:30")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reabrir horário" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.getByText(/voltará a ficar disponível/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirmar reabertura" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("block-a"));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("Horário reaberto");

    await user.click(screen.getByRole("button", { name: "Agendar neste horário" }));
    expect(onSchedule).toHaveBeenCalledWith({
      professionalId: "professional-a",
      startLocal: "2030-09-11T13:30",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

it("edita o período com precisão, mantém envio pendente e não reabre", async () => {
  const user = userEvent.setup();
  let resolve!: (result: { success: true }) => void;
  mocks.update.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<AvailabilityBlockDialog open onOpenChange={vi.fn()} block={block} professionalName="Alex" timezone="America/Sao_Paulo" />);
  await user.click(screen.getByRole("button", { name: "Editar bloqueio" }));
  expect(screen.getByLabelText("Hora de início")).toHaveValue("13:30");
  await user.clear(screen.getByLabelText("Motivo (opcional)"));
  await user.click(screen.getByRole("button", { name: "Salvar bloqueio" }));
  expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ id: "block-a", expectedStartAt: block.startAt, expectedReason: "Almoço", startLocal: "2030-09-11T13:30", reason: "" }));
  resolve({ success: true });
  await screen.findByText(/Bloqueio atualizado/);
  expect(mocks.remove).not.toHaveBeenCalled();
});
