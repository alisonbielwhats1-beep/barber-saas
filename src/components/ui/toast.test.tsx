// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, Toaster, TOAST_DURATION_MS } from "./toast";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("Toaster", () => {
  it("anuncia cada mensagem uma vez na região correspondente e limpa a fila", () => {
    const view = render(<Toaster />);

    act(() => {
      toast("Salvo", "success");
      toast("Falhou", "error");
    });

    expect(screen.getByTestId("toast-live-polite")).toHaveTextContent("Salvo");
    expect(screen.getByTestId("toast-live-polite")).not.toHaveTextContent("Falhou");
    expect(screen.getByTestId("toast-live-assertive")).toHaveTextContent("Falhou");
    expect(screen.getAllByText("Salvo")).toHaveLength(2);
    expect(screen.getAllByText("Falhou")).toHaveLength(2);

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(screen.queryByText("Salvo")).toBeNull();
    expect(screen.queryByText("Falhou")).toBeNull();

    view.unmount();
    act(() => toast("Sem listener", "info"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pausa o timeout em hover e retoma apenas pelo tempo restante", () => {
    render(<Toaster />);
    act(() => toast("Passe o mouse", "info"));
    const message = screen.getAllByText("Passe o mouse").find((node) => node.closest("li"));
    const item = message?.closest("li");
    expect(item).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.mouseEnter(item!);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(screen.getAllByText("Passe o mouse")).toHaveLength(2);

    fireEvent.mouseLeave(item!);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1_001));
    expect(screen.getAllByText("Passe o mouse")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Passe o mouse")).toBeNull();
  });

  it("pausa em focus-within e transfere foco ao fechar uma fila", () => {
    render(
      <>
        <button type="button">Origem</button>
        <Toaster />
      </>,
    );
    const origin = screen.getByRole("button", { name: "Origem" });
    origin.focus();
    act(() => {
      toast("Primeiro", "success");
      toast("Segundo", "info");
    });

    const firstClose = screen.getByRole("button", { name: "Fechar notificação: Primeiro" });
    firstClose.focus();
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 2));
    expect(screen.getAllByText("Primeiro")).toHaveLength(2);

    act(() => toast("Segundo", "info"));
    const secondClose = screen.getByRole("button", { name: "Fechar notificação: Segundo" });

    fireEvent.click(firstClose);
    expect(secondClose).toHaveFocus();
    fireEvent.click(secondClose);
    expect(origin).toHaveFocus();
  });
});
