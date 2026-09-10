// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgendaQuickActions } from "./agenda-quick-actions";

beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

describe("ações rápidas da agenda", () => {
  it("abre as três ações e encaminha cada escolha", async () => {
    const user = userEvent.setup();
    const onNewAppointment = vi.fn();
    const onNewBlock = vi.fn();
    const onNewDayOff = vi.fn();
    render(
      <AgendaQuickActions
        canCreateAppointment
        canManageAvailability
        onNewAppointment={onNewAppointment}
        onNewBlock={onNewBlock}
        onNewDayOff={onNewDayOff}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Abrir ações rápidas da agenda" });
    expect(trigger).toHaveClass("fixed", "lg:static", "h-14", "w-14");
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /Novo agendamento/ }));
    expect(onNewAppointment).toHaveBeenCalledOnce();

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /Novo bloqueio de horário/ }));
    expect(onNewBlock).toHaveBeenCalledOnce();

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /Adicionar folga/ }));
    expect(onNewDayOff).toHaveBeenCalledOnce();
  });

  it("mantém bloqueio e folga fora dos papéis sem essa permissão", async () => {
    const user = userEvent.setup();
    render(
      <AgendaQuickActions
        canCreateAppointment
        canManageAvailability={false}
        onNewAppointment={vi.fn()}
        onNewBlock={vi.fn()}
        onNewDayOff={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Abrir ações rápidas da agenda" }));
    expect(screen.getByRole("menuitem", { name: /Novo agendamento/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Novo bloqueio/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Adicionar folga/ })).toBeNull();
  });
});
