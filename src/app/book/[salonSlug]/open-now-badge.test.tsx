// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenNowBadge, isOpenAt } from "./open-now-badge";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const salon = { openMinutes: 540, closeMinutes: 1140, timeZone: "America/Sao_Paulo" };
// 08/10/2026 é quinta-feira (weekday 4); 13:30 em UTC são 10:30 em São Paulo.
const thursdayMorning = new Date("2026-10-08T13:30:00Z");

describe("aberto agora", () => {
  it("usa o fuso do estabelecimento e o horário dele quando não há expediente da equipe", () => {
    expect(isOpenAt(thursdayMorning, { ...salon, weeklyHours: [] })).toBe(true);
    expect(isOpenAt(new Date("2026-10-08T23:30:00Z"), { ...salon, weeklyHours: [] })).toBe(false);
    expect(isOpenAt(thursdayMorning, { ...salon, timeZone: "Fuso/Inexistente", weeklyHours: [] })).toBeNull();
  });

  it("fica fechado na folga e na pausa de toda a equipe", () => {
    const weeklyHours = [
      { weekday: 4, startMinutes: 540, endMinutes: 600 },
      { weekday: 4, startMinutes: 660, endMinutes: 1140 },
      { weekday: 5, startMinutes: 540, endMinutes: 1140 },
    ];
    // 10:30 de quinta cai na pausa (10:00–11:00).
    expect(isOpenAt(thursdayMorning, { ...salon, weeklyHours })).toBe(false);
    // 11:30 de quinta: em expediente.
    expect(isOpenAt(new Date("2026-10-08T14:30:00Z"), { ...salon, weeklyHours })).toBe(true);
    // Domingo: ninguém trabalha.
    expect(isOpenAt(new Date("2026-10-11T14:30:00Z"), { ...salon, weeklyHours })).toBe(false);
  });

  it("atualiza o selo com o passar do tempo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(thursdayMorning);
    const view = render(<OpenNowBadge {...salon} weeklyHours={[]} />);
    expect(screen.getByText("Aberto agora")).toHaveAttribute("data-open", "true");

    act(() => { vi.setSystemTime(new Date("2026-10-08T23:30:00Z")); vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Fechado agora")).toHaveAttribute("data-open", "false");
    view.unmount();
  });
});
