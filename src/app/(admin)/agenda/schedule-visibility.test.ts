import { describe, expect, it } from "vitest";
import { unavailableScheduleIntervals } from "./schedule-visibility";

describe("indisponibilidade visual da agenda", () => {
  it("mostra início tardio, pausa e fim da jornada do dia selecionado", () => {
    expect(unavailableScheduleIntervals([
      { weekday: 2, startMinutes: 840, endMinutes: 1260 },
      { weekday: 3, startMinutes: 600, endMinutes: 780 },
      { weekday: 3, startMinutes: 840, endMinutes: 1260 },
    ], "2026-09-09", 480, 1320)).toEqual([
      { startMinutes: 480, endMinutes: 600 },
      { startMinutes: 780, endMinutes: 840 },
      { startMinutes: 1260, endMinutes: 1320 },
    ]);
  });

  it("mostra o período inteiro quando o profissional está de folga", () => {
    expect(unavailableScheduleIntervals([
      { weekday: 2, startMinutes: 840, endMinutes: 1260 },
    ], "2026-09-10", 480, 1260)).toEqual([
      { startMinutes: 480, endMinutes: 1260 },
    ]);
  });

  it("une expediente semanal e abertura adicional da data", () => {
    expect(unavailableScheduleIntervals([
      { weekday: 3, startMinutes: 600, endMinutes: 780 },
      { dateKey: "2026-09-09", startMinutes: 780, endMinutes: 900 },
    ], "2026-09-09", 540, 960)).toEqual([
      { startMinutes: 540, endMinutes: 600 },
      { startMinutes: 900, endMinutes: 960 },
    ]);
  });
});
