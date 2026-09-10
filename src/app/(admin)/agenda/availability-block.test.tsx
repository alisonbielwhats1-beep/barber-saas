// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("./availability-actions", () => ({
  removeAvailabilityBlock: mocks.remove,
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
