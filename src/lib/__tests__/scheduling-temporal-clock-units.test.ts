import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groundSchedulingTemporal, quoteTemporalFacts, temporalAtomSpans, temporalFacts } from "../scheduling-temporal-source";
import { clockComponents, type ClockReadOptions } from "../scheduling-temporal-components";
import { statedClockComponent, statedDayComponent } from "../secretary-same-as";

/** C5 after the real S1a round, part C (temporal readability; flag SALON_SECRETARY_AGENT): the agent's temporal atoms read an hour written
 * with an abbreviated hour unit ("10hs", "16 hrs", "9hr30", "10h30min", "14:30hs") through ClockReadOptions.clockUnits, which only
 * temporalAtomSpans (the agent validator's reader) turns on. Every C4 caller passes no option and keeps exactly the historical reading.
 * Synthetic temporal fragments only: no sentence of any evaluation set. Today is Tuesday 09/03/2027, 9h in São Paulo. */
const TZ = "America/Sao_Paulo", NOW = new Date("2027-03-09T12:00:00Z"), TODAY = "2027-03-09", ON: ClockReadOptions = { clockUnits: true }, OFF: ClockReadOptions = {};
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** [kind, the owner's written span, attached denial] of the agent's atoms (default options: the agent's). */
const atomsOf = (text: string, options?: ClockReadOptions) => (temporalAtomSpans(text, TZ, NOW, options) ?? []).map(atom => [atom.kind, text.slice(atom.start, atom.end), atom.negated]);
const facts = (text: string, options?: ClockReadOptions) => temporalFacts(fold(text), {}, TZ, NOW, options);
/** The clock atom widened by the closed class of clock leads and an adjacent daypart, as the validator's V9 reads it before the C4's clock grammar. */
function withLead(text: string, atom: { start: number; end: number }) {
  let from = atom.start, to = atom.end;
  const lead = /(?:^|[^\p{L}\p{N}])((?:[àa]s|pelas|das)\s+)$/iu.exec(text.slice(0, from));
  if (lead) from -= lead[1].length;
  const part = /^\s+(?:da|de|[àa])\s+(?:manh[ãa]|tarde|noite)(?![\p{L}\p{N}])/iu.exec(text.slice(to));
  if (part) to += part[0].length;
  return text.slice(from, to);
}

describe("option on (the agent's atoms): an hour with an abbreviated unit is one clock atom", () => {
  it.each([
    ["às 10hs", "10hs", "10:00"], ["10hs", "10hs", "10:00"], ["pelas 16 hrs", "16 hrs", "16:00"], ["às 7 h", "7 h", "07:00"], ["às 8hrs", "8hrs", "08:00"],
    ["às 9hr30", "9hr30", "09:30"], ["às 10h30min", "10h30min", "10:30"], ["às 14:30hs", "14:30hs", "14:30"], ["às 14:30 h", "14:30 h", "14:30"], ["Às 11HS", "11HS", "11:00"],
  ])("reads %s as the clock atom %s", (text, span, clock) => {
    expect(atomsOf(text)).toEqual([["clock", span, false]]);
    expect(facts(text, ON).clocks).toEqual([clock]);
    expect(quoteTemporalFacts(text, TZ, NOW, ON).clocks).toEqual([clock]);
  });
  it("temporalAtomSpans reads the unit forms by default: it is the agent validator's reader only", () => {
    expect(atomsOf("às 10hs")).toEqual(atomsOf("às 10hs", ON));
    expect(atomsOf("às 10hs", OFF)).toEqual([]);
  });
  it.each([
    ["das 12hs às 13hs amanhã", [["date", "amanhã", false], ["clock", "12hs", false], ["clock", "13hs", false]], ["12:00", "13:00"]],
    ["das 9 às 10hs", [["clock", "9", false], ["clock", "10hs", false]], ["09:00", "10:00"]],
    ["entre 9 hs e 11 hs", [["clock", "9 hs", false], ["clock", "11 hs", false]], ["09:00", "11:00"]],
    ["das 8h30 às 9hs, depois de amanhã", [["date", "depois de amanhã", false], ["clock", "8h30", false], ["clock", "9hs", false]], ["08:30", "09:00"]],
  ] as const)("an interval whose ends carry a unit is one interval component: %s", (text, atoms, values) => {
    expect(atomsOf(text)).toEqual(atoms);
    const parts = clockComponents(fold(text), ON);
    expect(parts.map(part => [part.kind, part.value, part.interval?.endpoint])).toEqual([["INTERVAL_CLOCK", values[0], "start"], ["INTERVAL_CLOCK", values[1], "end"]]);
    expect(clockComponents(fold(text), OFF).length + clockComponents(fold(text)).length).toBe(0);
  });
  it("the interval keeps its shared-daypart rule: the start inherits the end's written daypart", () => {
    const parts = clockComponents(fold("de 2hs até 5hs da tarde"), ON);
    expect(parts.map(part => part.value)).toEqual(["14:00", "17:00"]);
    expect(parts[0].interval?.sharedDaypart).toBeDefined();
    expect(atomsOf("de 2hs até 5hs da tarde").map(atom => atom[1])).toEqual(["2hs", "5hs da tarde"]);
  });
});

describe("C2: an interval with its relative day written after it", () => {
  it.each([["das 15 às 16 amanhã", 1], ["das 15hs às 16hs amanhã", 1], ["das 15hs às 16hs depois de amanhã", 2]] as const)("%s: one day atom and both ends, read by the C4's own grammars", (text, offset) => {
    const atoms = temporalAtomSpans(text, TZ, NOW)!;
    const day = atoms.filter(atom => atom.kind === "date"), clocks = atoms.filter(atom => atom.kind === "clock");
    expect(day).toHaveLength(1);
    expect(statedDayComponent(text.slice(day[0].start, day[0].end), TODAY, "schedule.block")).toMatchObject({ kind: "RELATIVE_DAY", offset });
    expect(clocks.map(atom => withLead(text, atom))).toEqual(text.includes("hs") ? ["das 15hs", "às 16hs"] : ["das 15", "às 16"]);
    expect(clocks.map(atom => statedClockComponent(withLead(text, atom), "schedule.block"))).toEqual([{ hour: 15, minute: 0, daypart: "UNSPECIFIED" }, { hour: 16, minute: 0, daypart: "UNSPECIFIED" }]);
  });
  it("the historical form without units reads the same with the option on and off", () => {
    expect(atomsOf("das 15 às 16 amanhã", ON)).toEqual(atomsOf("das 15 às 16 amanhã", OFF));
  });
  it.each([
    ["às 14:30hs", [{ hour: 14, minute: 30, daypart: "UNSPECIFIED" }]],
    ["às 11 hr da manhã", [{ hour: 11, minute: 0, daypart: "MANHA" }]],
    ["pelas 16 hrs", [{ hour: 16, minute: 0, daypart: "UNSPECIFIED" }]],
  ] as const)("the atom of %s, with its lead and daypart, is what the C4's clock grammar reads (never a clipped HH:00)", (text, readings) => {
    expect((temporalAtomSpans(text, TZ, NOW) ?? []).filter(atom => atom.kind === "clock").map(atom => statedClockComponent(withLead(text, atom), "appointment.create"))).toEqual(readings);
  });
});

describe("adversarial: denial, neighbours and what is no unit form", () => {
  it.each([["não às 10hs", "não às 10h"], ["nunca 9hr30", "nunca 9h30"], ["jamais às 14:30hs", "jamais às 14:30"], ["não das 12hs às 13hs", "não das 12 às 13"], ["não, às 10hs", "não, às 10h"]])(
    "a unit form keeps exactly the historical attached denial: %s like %s", (unit, historical) => {
      expect(atomsOf(unit).map(([kind, , negated]) => [kind, negated])).toEqual(atomsOf(historical, OFF).map(([kind, , negated]) => [kind, negated]));
      expect(facts(unit, ON).negated).toBe(facts(historical).negated);
    });
  it("a denied unit form is denied, a correction after it is not", () => {
    expect(atomsOf("amanhã às 10hs, não, às 11hs")).toEqual([["date", "amanhã", false], ["clock", "10hs", false], ["clock", "11hs", false]]);
    expect(atomsOf("amanhã, não às 10hs, às 11hs")).toEqual([["date", "amanhã", false], ["clock", "10hs", true], ["clock", "11hs", false]]);
  });
  it.each([["dia 12 às 10hs", [["date", "dia 12", false], ["clock", "10hs", false]]], ["12/03 às 10hs", [["date", "12/03", false], ["clock", "10hs", false]]],
    ["sexta 16 hrs", [["date", "sexta", false], ["clock", "16 hrs", false]]]] as const)("a unit form never takes a day: %s", (text, atoms) => {
    expect(atomsOf(text)).toEqual(atoms);
  });
  it.each(["às 10 hoje", "às 10 horas", "demora 2 horas", "10horas", "10hsx", "10h3", "10h300", "abc10hs", "14:30horas", "meio-dia e 3hs"])(
    "%s: a unit never runs into a letter or a digit, and \"horas\" still needs its lead (the option changes nothing)", text => {
      expect(atomsOf(text, ON)).toEqual(atomsOf(text, OFF));
      expect(facts(text, ON)).toEqual(facts(text));
    });
  it("a written-out duration without a lead is still no clock with the option on", () => {
    expect(facts("demora 2 horas", ON).clocks).toEqual([]);
  });
});

describe("the minutes written after a unit clock belong to its atom (the validator never reads the hour alone)", () => {
  it.each([
    ["às 10hs e meia", "10hs e meia", "10:30", 10, 30], ["às 10hs 30", "10hs 30", "10:30", 10, 30], ["às 10h e quinze", "10h e quinze", "10:15", 10, 15],
    ["pelas 9 hrs 45 min", "9 hrs 45 min", "09:45", 9, 45], ["às 16hs e 20 minutos", "16hs e 20 minutos", "16:20", 16, 20], ["às 11h 15 min", "11h 15 min", "11:15", 11, 15],
  ] as const)("%s: one atom %s (%s), and its lead reading is never HH:00", (text, span, clock, hour, minute) => {
    expect(atomsOf(text)).toEqual([["clock", span, false]]);
    expect(facts(text, ON).clocks).toEqual([clock]);
    const [atom] = temporalAtomSpans(text, TZ, NOW)!;
    expect(statedClockComponent(withLead(text, atom), "appointment.create")).toEqual({ hour, minute, daypart: "UNSPECIFIED" });
  });
  it("an interval end takes the digits after its unit too", () => {
    expect(atomsOf("das 10hs às 11hs 30")).toEqual([["clock", "10hs", false], ["clock", "11hs 30", false]]);
    expect(clockComponents(fold("das 10hs às 11hs 30"), ON).map(part => part.value)).toEqual(["10:00", "11:30"]);
    expect(clockComponents(fold("das 10hs 30 às 11hs"), ON).map(part => part.value)).toEqual(["10:30", "11:00"]);
  });
  it("minutes written twice make the clock invalid, and the validator reads nothing from it", () => {
    for (const text of ["às 10h30 e meia", "às 14:30 15"]) {
      expect(facts(text, ON).clocks).toEqual(["INVALID"]);
      const [atom] = temporalAtomSpans(text, TZ, NOW)!;
      expect(statedClockComponent(withLead(text, atom), "appointment.create")).toBeUndefined();
    }
  });
  it.each([
    ["às 10h 20/03", [["date", "20/03", false], ["clock", "10h", false]]], ["às 10h 20 de março", [["date", "20 de março", false], ["clock", "10h", false]]],
    ["às 10h e 11h", [["clock", "10h", false], ["clock", "11h", false]]], ["às 14:30 e 15:00", [["clock", "14:30", false], ["clock", "15:00", false]]],
    ["às 10hs e meia hora depois", [["clock", "10hs", false]]], ["às 10h e uma escova", [["clock", "10h", false]]], ["às 9hs e um corte", [["clock", "9hs", false]]],
  ] as const)("%s: a date, a unit, another clock or an article after it is no minutes", (text, atoms) => {
    expect(atomsOf(text)).toEqual(atoms);
  });
  it("the denial attached to the clock covers its minutes", () => {
    expect(atomsOf("não às 10hs e meia")).toEqual([["clock", "10hs e meia", true]]);
    expect(facts("não às 10hs e meia", ON).negated).toBe(true);
  });
  it("flag off: the historical reading of these forms is unchanged", () => {
    for (const text of ["às 10h e meia", "às 10h 30", "das 10h às 11h 30"]) {
      expect(facts(text)).toEqual(facts(text, OFF));
      expect(clockComponents(fold(text))).toEqual(clockComponents(fold(text), OFF));
    }
    expect(facts("às 10h 30").atoms.map(atom => [atom.start, atom.end])).toEqual([[3, 6]]);
  });
});

describe("flag off: every C4 caller keeps exactly the historical reading", () => {
  const unitForms = ["às 10hs", "10hs", "pelas 16 hrs", "às 9hr30", "às 10h30min", "às 14:30hs", "das 12hs às 13hs amanhã", "entre 9 hs e 11 hs", "não às 10hs"];
  it.each(unitForms)("%s: no option, an empty option and clockUnits false are the same historical facts", text => {
    const historical = facts(text);
    expect(facts(text, OFF)).toEqual(historical);
    expect(facts(text, { clockUnits: false })).toEqual(historical);
    expect(quoteTemporalFacts(text, TZ, NOW)).toEqual(quoteTemporalFacts(text, TZ, NOW, OFF));
    expect(clockComponents(fold(text))).toEqual(clockComponents(fold(text), OFF));
  });
  it("the historical grammar still does not read a glued unit (the C4's own token grammar is where it reads it)", () => {
    expect(facts("às 10hs").clocks).toEqual([]);
    expect(quoteTemporalFacts("às 9hr30", TZ, NOW).clocks).toEqual([]);
    expect(clockComponents(fold("das 12hs às 13hs"))).toEqual([]);
    const refused = groundSchedulingTemporal({}, { time: "10:00" }, "às 10hs", TZ, NOW, undefined, "appointment.create", [{ field: "time", text: "às 10hs" }]);
    expect(refused.fields.time).toBeUndefined();
    expect(refused.rejected).toEqual([{ code: "SOURCE_TEMPORAL_CONFLICT", field: "time", value: "10:00" }]);
    expect(groundSchedulingTemporal({}, { time: "10:00" }, "às 10h", TZ, NOW, undefined, "appointment.create", [{ field: "time", text: "às 10h" }]).fields.time).toBe("10:00");
  });
  it.each(["às 10h", "10h30", "às 10:30", "às dez e meia", "das 13h às 18h", "entre uma e seis da tarde", "meio-dia e meia", "amanhã às 9", "sexta dia 12 às 15h",
    "daqui a 3 dias às 11", "14h-16h", "não às 10h", "às 10 horas", "às 10 hoje", "Às 9 e na sexta"])("%s: a form without a unit reads the same with the option on", text => {
    expect(facts(text, ON)).toEqual(facts(text));
    expect(clockComponents(fold(text), ON)).toEqual(clockComponents(fold(text)));
    expect(quoteTemporalFacts(text, TZ, NOW, ON)).toEqual(quoteTemporalFacts(text, TZ, NOW));
  });
  it("only the agent turns the option on: clockUnits true and temporalAtomSpans appear in the temporal readers and the agent modules alone", () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? entry.name === "__tests__" || entry.name === "evaluation" ? [] : files(`${dir}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
    const readers = new Set(["src/lib/scheduling-temporal-source.ts", "src/lib/scheduling-temporal-components.ts"]);
    const agent = (file: string) => /\/secretary-agent-[^/]*\.ts$/.test(file) || /\/agent-[^/]*\.ts$/.test(file);
    for (const file of [...files("src/lib"), ...files("packages/salon-secretary/src")]) {
      const text = readFileSync(file, "utf8");
      if (/\bclockUnits\s*:\s*true\b/.test(text)) expect(readers.has(file) || agent(file), file).toBe(true);
      if (/\btemporalAtomSpans\(/.test(text)) expect(file === "src/lib/scheduling-temporal-source.ts" || agent(file), file).toBe(true);
    }
  });
});
