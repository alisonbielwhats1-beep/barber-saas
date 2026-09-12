import { describe, expect, it } from "vitest";
import { layoutOverlappingIntervals, layoutAppointmentsAndBlocks } from "./agenda-layout";

describe("layoutOverlappingIntervals", () => {
  it("mantém atendimentos adjacentes ocupando a coluna inteira", () => {
    const placements = layoutOverlappingIntervals([
      { id: "first", start: 9 * 60, end: 10 * 60 },
      { id: "second", start: 10 * 60, end: 11 * 60 },
    ]);

    expect(placements.get("first")).toMatchObject({ columns: 1, leftPct: 0, widthPct: 100, conflict: false });
    expect(placements.get("second")).toMatchObject({ columns: 1, leftPct: 0, widthPct: 100, conflict: false });
  });

  it("divide conflitos simultâneos em colunas sem esconder texto", () => {
    const placements = layoutOverlappingIntervals([
      { id: "one", start: 9 * 60, end: 10 * 60 },
      { id: "two", start: 9 * 60 + 30, end: 10 * 60 + 30 },
    ]);

    expect(placements.get("one")).toMatchObject({ columns: 2, column: 0, leftPct: 0, widthPct: 50, conflict: true });
    expect(placements.get("two")).toMatchObject({ columns: 2, column: 1, leftPct: 50, widthPct: 50, conflict: true });
  });

  it("mantém o conflito transitivo em uma mesma faixa visual", () => {
    const placements = layoutOverlappingIntervals([
      { id: "long", start: 9 * 60, end: 11 * 60 },
      { id: "middle", start: 9 * 60 + 30, end: 10 * 60 },
      { id: "last", start: 10 * 60 + 30, end: 12 * 60 },
    ]);

    expect(placements.get("long")?.conflict).toBe(true);
    expect(placements.get("middle")?.conflict).toBe(true);
    expect(placements.get("last")?.conflict).toBe(true);
  });
});

it("separa bloqueio de reservas sem inventar conflito entre clientes", () => {
  const placements = layoutAppointmentsAndBlocks([{ id: "a", start: 600, end: 630 }, { id: "b", start: 700, end: 730 }], [{ id: "off", start: 500, end: 1000 }]);
  expect(placements.get("block:off")?.widthPct).toBe(50);
  expect(placements.get("a")).toMatchObject({ widthPct: 50, conflict: false });
  expect(placements.get("a")?.leftPct).not.toBe(placements.get("block:off")?.leftPct);
  expect(placements.get("b")?.leftPct).toBe(placements.get("a")?.leftPct);
});
