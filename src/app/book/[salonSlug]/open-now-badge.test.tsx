// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenNowBadge, minutesInTimeZone } from "./open-now-badge";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("aberto agora", () => {
  it("usa o fuso do estabelecimento, não o do aparelho", () => {
    // 13:30 em UTC são 10:30 em São Paulo.
    expect(minutesInTimeZone(new Date("2026-10-08T13:30:00Z"), "America/Sao_Paulo")).toBe(10 * 60 + 30);
    expect(minutesInTimeZone(new Date("2026-10-08T13:30:00Z"), "Fuso/Inexistente")).toBeNull();
  });

  it("mostra aberto dentro do horário e fechado fora dele", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T13:30:00Z"));
    const view = render(<OpenNowBadge openMinutes={540} closeMinutes={1140} timeZone="America/Sao_Paulo" />);
    expect(screen.getByText("Aberto agora")).toHaveAttribute("data-open", "true");

    act(() => { vi.setSystemTime(new Date("2026-10-08T23:30:00Z")); vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Fechado agora")).toHaveAttribute("data-open", "false");
    view.unmount();
  });
});
