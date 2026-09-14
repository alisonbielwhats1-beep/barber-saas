import { expect, it } from "vitest";
import { agendaRange } from "./agenda-range";
it("mostra bloqueio das 21h às 23h e a opção de dia inteiro", () => {
  const blocks = [
    { startAt: "2026-09-18T00:00:00Z", endAt: "2026-09-18T02:00:00Z" },
  ];
  expect(agendaRange([], blocks, [], "America/Sao_Paulo")).toEqual({
    start: 480,
    end: 1380,
  });
  expect(agendaRange([], blocks, [], "America/Sao_Paulo", true)).toEqual({
    start: 0,
    end: 1440,
  });
});
it("mostra meia-noite e abertura antecipada sem ampliar por uma folga integral", () => {
  expect(
    agendaRange(
      [],
      [{ startAt: "2026-09-17T09:00:00Z", endAt: "2026-09-18T03:00:00Z" }],
      [],
      "America/Sao_Paulo",
    ),
  ).toEqual({ start: 360, end: 1440 });
  expect(
    agendaRange(
      [],
      [{ startAt: "2026-09-17T03:00:00Z", endAt: "2026-09-18T03:00:00Z" }],
      [],
      "America/Sao_Paulo",
    ),
  ).toEqual({ start: 480, end: 1260 });
});
