import { describe, expect, it } from "vitest";
import { durationLiteral, durationLiterals, durationMinutes, durationText } from "../scheduling-duration-literal";

/** C5 WP4 (flag SALON_SECRETARY_AGENT; docs/c5-spike/11-especificacao-agente.md §5.1 V12): the closed duration reader an anchor's offset
 * uses. Amounts of time only: a clock (led by às/até/das, or followed by a daypart) is never a duration; zero, 60+ minutes after an hour,
 * more than a day and two durations in one text are refused. */
describe("scheduling duration literal", () => {
  it("reads the closed forms: half hour, minutes, hours, compact 1h30, hours and minutes, spoken counts", () => {
    const read = (text: string) => durationMinutes(text);
    expect(read("meia hora depois")).toBe(30);
    expect(read("40 minutos depois")).toBe(40);
    expect(read("30min")).toBe(30);
    expect(read("quinze min")).toBe(15);
    expect(read("90 min")).toBe(90);
    expect(read("1h30 depois")).toBe(90);
    expect(read("1h30min")).toBe(90);
    expect(read("uma hora e meia antes")).toBe(90);
    expect(read("hora e meia")).toBe(90);
    expect(read("duas horas e meia")).toBe(150);
    expect(read("2 horas")).toBe(120);
    expect(read("2h depois")).toBe(120);
    expect(read("1 hora e 15 minutos")).toBe(75);
    expect(read("uma hora e vinte e cinco minutos")).toBe(85);
  });
  it("keeps the original offsets and text (accents and case aside)", () => {
    const text = "Encaixa MEIA HORA depois", found = durationLiteral(text)!;
    expect(found).toMatchObject({ minutes: 30, text: "MEIA HORA" });
    expect(text.slice(found.start, found.end)).toBe("MEIA HORA");
  });
  it("refuses clocks, invalid amounts and two durations", () => {
    for (const text of ["às 10h", "até 2h", "das 14h às 16h", "10h da manhã", "duas horas da tarde", "1h75", "0 min", "30 horas", "logo depois"])
      expect(durationLiterals(text), text).toEqual([]);
    expect(durationLiterals("meia hora ou uma hora").map(item => item.minutes)).toEqual([30, 60]);
    expect(durationLiteral("meia hora ou uma hora")).toBeUndefined();
    expect(durationMinutes("sem nada")).toBeUndefined();
  });
  it("says an amount back in the owner's short form", () => {
    expect([durationText(30), durationText(60), durationText(90), durationText(125)]).toEqual(["30 min", "1h", "1h30", "2h05"]);
  });
});
