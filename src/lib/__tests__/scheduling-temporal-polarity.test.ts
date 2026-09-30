import { afterEach, describe, expect, it, vi } from "vitest";
import { applyScopeCoverage, groundSchedulingTemporal, temporalLiteralNegated } from "../scheduling-temporal-source";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";
import { EXCLUDED_VALUE, excludedClocks, exclusionSpans, polarityCodes } from "../scheduling-temporal-polarity";
import { siblingScopedMessage } from "../secretary-sibling-scope";
import { decodeTemporalEvidencePayload, type SchedulingTemporalEvidence, type SelectedOperation } from "@everflair/salon-secretary";
import type { SchedulingFields } from "../scheduling-contract";

/** C4 polarity (flag SALON_SECRETARY_TEMPORAL_POLARITY): a proven exclusion owns exactly its own negator;
 * every other negator still denies; an affirmed value equal to an excluded one is asked; flag off = historical. */
const now = new Date("2026-09-28T12:00:00Z"), tz = "America/Sao_Paulo"; // Monday 09:00 in the salon
afterEach(() => { vi.unstubAllEnvs(); });
const polarity = (on = true) => vi.stubEnv("SALON_SECRETARY_TEMPORAL_POLARITY", on ? "true" : "false");
const components = (on = true) => vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", on ? "true" : "false");
type Evidence = SchedulingTemporalEvidence[number];
const quote = (field: Evidence["field"], text: string): Evidence => ({ field, text });
const excluded = (field: Evidence["field"], value: NonNullable<Evidence["excluded"]>, text: string): Evidence => ({ field, text, excluded: value });
const ground = (operation: string, source: string, raw: SchedulingFields, evidence: Evidence[], previous: SchedulingFields = {}) =>
  groundSchedulingTemporal(previous, raw, source, tz, now, undefined, operation, evidence);

describe("decoding: exclusions are transport, never an affirmed selector", () => {
  const empty = { date: null, source_date: null, end_date: null, time: null, source_time: null, end_time: null };
  it("follow the positive entries in their published order and never conflict with the role's own selector", () => {
    const decoded = decodeTemporalEvidencePayload({ operation: "appointment.change", time: { value: "11:00", literal: "para 11h" },
      excluded: [{ field: "time", value: "10:00", literal: "não 10h" }, { field: "date", value: "2026-09-29", literal: "não amanhã" }] }, true) as Record<string, unknown>;
    expect(decoded).not.toHaveProperty("excluded"); expect(decoded.time).toBe("11:00");
    expect(decoded.temporal_evidence).toEqual([{ field: "time", text: "para 11h" }, { field: "time", text: "não 10h", excluded: "10:00" }, { field: "date", text: "não amanhã", excluded: "2026-09-29" }]);
  });
  it("carry a component value in components mode; null publishes nothing; a malformed exclusion is refused", () => {
    const clock = { hour: 10, minute: 0, daypart: "UNSPECIFIED" };
    const decoded = decodeTemporalEvidencePayload({ components: { ...empty, time: { value: { hour: 11, minute: 0, daypart: "UNSPECIFIED" }, literal: "às onze" } },
      excluded: [{ field: "time", value: clock, literal: "às dez não" }] }, true) as { temporal_evidence: Evidence[] };
    expect(decoded.temporal_evidence.at(-1)).toEqual({ field: "time", text: "às dez não", excluded: clock });
    expect(decodeTemporalEvidencePayload({ operation: "appointment.create", excluded: null }, true)).toEqual({ operation: "appointment.create" });
    for (const bad of [[{ field: "end_date", value: "2026-09-29", literal: "x" }], [{ field: "time", value: "10:00" }], [{ field: "time", value: "10:00", literal: "não", extra: 1 }]])
      expect(() => decodeTemporalEvidencePayload({ excluded: bad }, true)).toThrow();
  });
  it("the turn decoder carries them through a NEW operation", () => {
    const op = { operation: "appointment.change", item_key: "a", depends_on: null, released_slot_of: null, source_scope: null, time: { value: "11:00", literal: "para 11h" },
      excluded: [{ field: "time", value: "10:00", literal: "não 10h" }] };
    const decoded = decodeTemporalEvidencePayload({ turn: { mode: "NEW", operations: [op] } }, true, "Passa a Amanda para 11h, não 10h") as { turn: { operations: { temporal_evidence: Evidence[] }[] } };
    expect(decoded.turn.operations[0].temporal_evidence).toEqual([{ field: "time", text: "para 11h" }, { field: "time", text: "não 10h", excluded: "10:00" }]);
  });
});

describe("ownership: a proven exclusion neutralizes only its own negator", () => {
  const voice = "passa a amanda pra amanhã às dez não às onze";
  const voiceRaw = { day_offset: 1, time: "10:00" }, voiceQuotes = [quote("date", "amanhã"), quote("time", "às dez")];
  it("pinned direction kept with the flag on: 'Passa a Amanda para 11h, não 10h' with time 10h quoted 'não 10h' is still refused", () => {
    polarity();
    const result = ground("appointment.change", "Passa a Amanda para 11h, não 10h", { time: "10:00" }, [quote("time", "não 10h")]);
    expect(result.rejected.map(item => item.field)).toEqual(["time"]); expect(result.fields.time).toBeUndefined();
  });
  it("'para 11h, não 10h': the affirmed 11h is kept and 10h is a proven exclusion (both halves of the bare clock)", () => {
    polarity();
    const result = ground("appointment.change", "Passa a Amanda para 11h, não 10h", { time: "11:00" }, [quote("time", "para 11h"), excluded("time", "10:00", "não 10h")]);
    expect(result.rejected).toEqual([]); expect(result.fields.time).toBe("11:00");
    expect(result.exclusions?.verified.map(({ field, values, literal }) => ({ field, values, literal }))).toEqual([{ field: "time", values: ["10:00"], literal: "não 10h" }]);
    expect(polarityCodes(result)).toEqual(["TEMPORAL_EXCLUSION_VERIFIED"]);
    expect([...excludedClocks(result.exclusions)!]).toEqual(["10:00"]);
  });
  // Review contract migration (backup: .demo/agenda-core/contract-migration/scheduling-temporal-polarity.test.before-ownership-review.ts):
  // the same unpunctuated 'às dez não às onze' was accepted as 10h with one exclusion and as 11h with the other. An
  // attachment that can be read both ways is not owned: the historical clause denial asks, whichever side Luna chose.
  it("voice without punctuation: 'às dez não às onze' is read both ways, so neither exclusion owns the 'não' (asked, as with the flag off)", () => {
    polarity();
    const plain = ground("appointment.change", voice, voiceRaw, voiceQuotes);
    expect(plain.rejected.map(item => item.field).sort()).toEqual(["date", "time"]);
    const as10 = ground("appointment.change", voice, voiceRaw, [...voiceQuotes, excluded("time", "11:00", "não às onze")]);
    expect(as10.rejected.map(item => item.field).sort()).toEqual(["date", "time"]); expect(as10.fields.time).toBeUndefined();
    expect(as10.exclusions?.verified.map(item => item.owned)).toEqual([false]);
    expect(polarityCodes(as10)).toEqual(["TEMPORAL_EXCLUSION_VERIFIED", "TEMPORAL_EXCLUSION_UNOWNED"]);
    const as11 = ground("appointment.create", "marca a Amanda amanhã às dez não às onze", { day_offset: 1, time: "11:00" },
      [quote("date", "amanhã"), quote("time", "às onze"), excluded("time", "10:00", "às dez não")]);
    expect(as11.rejected.map(item => item.field).sort()).toEqual(["date", "time"]); expect(as11.fields.time).toBeUndefined();
  });
  it("one punctuation mark settles the attachment: 'às dez, não às onze' is 10h and 'às dez não, às onze' is 11h (the 'não' owned)", () => {
    polarity();
    const ten = ground("appointment.change", "passa a amanda pra amanhã às dez, não às onze", voiceRaw, [...voiceQuotes, excluded("time", "11:00", "não às onze")]);
    expect(ten.rejected).toEqual([]); expect(ten.fields).toMatchObject({ date: "2026-09-29", time: "10:00" });
    const eleven = ground("appointment.create", "marca a Amanda amanhã às dez não, às onze", { day_offset: 1, time: "11:00" },
      [quote("date", "amanhã"), quote("time", "às onze"), excluded("time", "10:00", "às dez não")]);
    expect(eleven.rejected).toEqual([]); expect(eleven.fields).toMatchObject({ date: "2026-09-29", time: "11:00" });
    expect(eleven.exclusions?.verified.map(item => item.owned)).toEqual([true]);
    // The reverse readings are refused: their marker is separated from its own atom by the punctuation.
    const reverseTen = ground("appointment.create", "marca a Amanda amanhã às dez não, às onze", { day_offset: 1, time: "10:00" },
      [quote("date", "amanhã"), quote("time", "às dez"), excluded("time", "11:00", "não, às onze")]);
    expect(reverseTen.fields.time).toBeUndefined(); expect(reverseTen.fields.date).toBeUndefined();
  });
  it("a self-repair cue after the negator settles the attachment: 'às dez não pera às onze' is 11h (the 'não' owned)", () => {
    polarity();
    const tomorrow = quote("date", "amanhã"), eleven = { day_offset: 1, time: "11:00" };
    for (const [source, literal] of [["marca a Amanda amanhã às dez não pera às onze", "às dez não"], ["marca a Amanda amanhã às dez não pera às onze", "às dez"],
      ["marca a Amanda amanhã às dez, não, pera, às onze", "às dez"], ["marca a Amanda amanhã às dez não quer dizer às onze", "às dez"],
      ["marca a Amanda amanhã às dez não ou melhor às onze", "às dez não"]]) {
      const result = ground("appointment.create", source, eleven, [tomorrow, quote("time", "às onze"), excluded("time", "10:00", literal)]);
      expect(result.rejected, source + " | " + literal).toEqual([]); expect(result.fields, source).toMatchObject({ date: "2026-09-29", time: "11:00" });
      expect(result.exclusions?.verified.map(item => item.owned), source).toEqual([true]);
    }
    // The atom-only literal adopts its neighbouring marker but no cue follows: read both ways, so asked (as before).
    const plain = ground("appointment.create", "marca a Amanda amanhã às dez não às onze", eleven, [tomorrow, quote("time", "às onze"), excluded("time", "10:00", "às dez")]);
    expect(plain.exclusions?.verified.map(item => item.owned)).toEqual([false]); expect(plain.fields.time).toBeUndefined(); expect(plain.fields.date).toBeUndefined();
    // The reverse reading proves nothing (the cue is not a marker), so the 'não' keeps denying the affirmed 10h.
    const reverse = ground("appointment.create", "marca a Amanda amanhã às dez não pera às onze", { day_offset: 1, time: "10:00" },
      [tomorrow, quote("time", "às dez"), excluded("time", "11:00", "às onze")]);
    expect(reverse.exclusions?.verified).toEqual([]); expect(reverse.fields.time).toBeUndefined();
    // A refusal of the operation stays refused: its own 'Não' is owned by nothing.
    const refusal = ground("appointment.create", "Não marca a Amanda amanhã às dez não pera às onze", eleven, [tomorrow, quote("time", "às onze"), excluded("time", "10:00", "às dez")]);
    expect(refusal.fields.time).toBeUndefined();
    // Markers on both sides of the atom: the literal adopts neither.
    const both = ground("appointment.create", "marca a Amanda às 15h nem às 10 nem às 11", { time: "15:00" }, [quote("time", "às 15h"), excluded("time", "10:00", "às 10")]);
    expect(polarityCodes(both)).toContain("TEMPORAL_EXCLUSION_MARKER");
  });
  it("'terça não, quarta às 10h' read backwards (terça affirmed, 'não, quarta' excluded) is asked; read forwards it is quarta", () => {
    polarity();
    const backwards = ground("appointment.create", "Marca a Amanda terça não, quarta às 10h", { weekday: 2, time: "10:00" },
      [quote("date", "terça"), quote("time", "às 10h"), excluded("date", "2026-09-30", "não, quarta")]);
    expect(backwards.fields.date).toBeUndefined(); expect(backwards.rejected.map(item => item.field)).toContain("date");
    expect(backwards.exclusions?.verified.map(item => item.owned)).toEqual([false]);
    const forwards = ground("appointment.create", "Marca a Amanda terça não, quarta às 10h", { weekday: 3, time: "10:00" },
      [quote("date", "quarta"), quote("time", "às 10h"), excluded("date", "2026-09-29", "terça não")]);
    expect(forwards.rejected).toEqual([]); expect(forwards.fields).toMatchObject({ date: "2026-09-30", time: "10:00" });
  });
  it("'às dez, não, às onze' (a 'não' between two commas): never owned in either reading, so it grounds exactly as with the flag off", () => {
    const source = "Marca a Amanda amanhã às dez, não, às onze";
    const readings: [SchedulingFields, Evidence[], Evidence][] = [
      [{ day_offset: 1, time: "10:00" }, [quote("date", "amanhã"), quote("time", "às dez")], excluded("time", "11:00", "não, às onze")],
      [{ day_offset: 1, time: "11:00" }, [quote("date", "amanhã"), quote("time", "às onze")], excluded("time", "10:00", "às dez, não")]];
    for (const [raw, quotes, exclusion] of readings) {
      polarity(false); const off = ground("appointment.create", source, raw, quotes);
      polarity(); const on = ground("appointment.create", source, raw, [...quotes, exclusion]);
      expect(on.exclusions?.verified.map(item => item.owned)).toEqual([false]);
      expect({ fields: on.fields, rejected: on.rejected }).toEqual({ fields: off.fields, rejected: off.rejected });
    }
  });
  it("a leading marker's own scope: a positive right after its atom ('não amanhã às 10h') stays denied; a positive before the exclusion across a comma is kept", () => {
    polarity();
    const inside = ground("appointment.create", "Marca a Carla, não amanhã às 10h", { time: "10:00" }, [quote("time", "às 10h"), excluded("date", "2026-09-29", "não amanhã")]);
    expect(inside.fields.time).toBeUndefined(); expect(inside.rejected.map(item => item.field)).toEqual(["time"]);
    const change = ground("appointment.change", "Remarca a Amanda não pra sexta às 15h", { time: "15:00" }, [quote("time", "às 15h"), excluded("date", "2026-10-02", "não pra sexta")]);
    expect(change.fields.time).toBeUndefined();
    const before = ground("appointment.create", "Marca a Carla às 10h, não amanhã", { time: "10:00" }, [quote("time", "às 10h"), excluded("date", "2026-09-29", "não amanhã")]);
    expect(before.rejected).toEqual([]); expect(before.fields.time).toBe("10:00");
  });
  it("any negator no exclusion owns still denies: a refusal stays refused", () => {
    polarity();
    const refusal = ground("appointment.create", "Não marca a Amanda amanhã às 10h, não às 11h", { day_offset: 1, time: "10:00" },
      [quote("date", "amanhã"), quote("time", "às 10h"), excluded("time", "11:00", "não às 11h")]);
    expect(refusal.exclusions?.verified).toHaveLength(1);
    expect(refusal.rejected.map(item => item.field).sort()).toEqual(["date", "time"]);
  });
  it("an operation's refusal cannot be declared an exclusion: content words, a sentence boundary or two markers prove nothing", () => {
    polarity();
    const cases: [string, SchedulingFields, Evidence[], string][] = [
      ["Não marca a Amanda amanhã às 10h", { time: "10:00" }, [quote("time", "às 10h"), excluded("date", "2026-09-29", "Não marca a Amanda amanhã")], "TEMPORAL_EXCLUSION_SHAPE"],
      ["Nunca marque a Amanda às 10h", { time: "10:00" }, [quote("time", "às 10h"), excluded("time", "10:00", "Nunca marque a Amanda às 10h")], "TEMPORAL_EXCLUSION_OVERLAP"],
      ["Amanhã às 9h. Não marca a Amanda às 10h", { time: "10:00" }, [quote("time", "às 10h"), excluded("time", "09:00", "às 9h. Não")], "TEMPORAL_EXCLUSION_SHAPE"],
      ["marca a Amanda às 15h nem às 10 nem às 11", { time: "15:00" }, [quote("time", "às 15h"), excluded("time", "10:00", "nem às 10 nem às 11")], "TEMPORAL_EXCLUSION_MARKER"],
      ["marca a Amanda às 15h não às 10", { time: "15:00" }, [quote("time", "às 15h"), excluded("time", "10:00", "não às 11")], "TEMPORAL_EXCLUSION_LITERAL"],
      ["marca a Amanda às 15h não às 10", { time: "15:00" }, [quote("time", "às 15h"), excluded("time", "09:00", "não às 10")], "TEMPORAL_EXCLUSION_VALUE"],
      ["marca a Amanda às 15h não amanhã", { time: "15:00" }, [quote("time", "às 15h"), excluded("time", "15:00", "não amanhã")], "TEMPORAL_EXCLUSION_SHAPE"],
    ];
    for (const [source, raw, evidence, code] of cases) {
      const result = ground("appointment.create", source, raw, evidence);
      expect(result.exclusions?.verified, source).toEqual([]); expect(polarityCodes(result), source).toContain(code);
      // Regex negation remains: nothing is owned, so the clause's negator denies the affirmed clock.
      expect(result.fields.time, source).toBeUndefined();
    }
  });
  // Review migration: the unpunctuated 'às 22h não às dez' has the same two readings as 'às dez não às onze' (asked); the
  // half-day readings are pinned on the punctuated sentence.
  it("half-days: 'às dez' keeps its historical reading (22h stays affirmable); 'às duas' excludes both halves", () => {
    polarity();
    const evening = ground("appointment.create", "marca a Amanda amanhã às 22h, não às dez", { day_offset: 1, time: "22:00" },
      [quote("date", "amanhã"), quote("time", "às 22h"), excluded("time", "10:00", "não às dez")]);
    expect(evening.rejected).toEqual([]); expect(evening.fields.time).toBe("22:00"); expect(evening.exclusions?.verified[0].values).toEqual(["10:00"]);
    const two = ground("appointment.create", "marca a Amanda amanhã às 15h, não às duas", { day_offset: 1, time: "15:00" },
      [quote("date", "amanhã"), quote("time", "às 15h"), excluded("time", "14:00", "não às duas")]);
    expect(two.rejected).toEqual([]); expect(two.exclusions?.verified[0].values).toEqual(["02:00", "14:00"]);
    const unpunctuated = ground("appointment.create", "marca a Amanda amanhã às 22h não às dez", { day_offset: 1, time: "22:00" },
      [quote("date", "amanhã"), quote("time", "às 22h"), excluded("time", "10:00", "não às dez")]);
    expect(unpunctuated.fields.time).toBeUndefined();
  });
  it("two exclusions each owning its own 'nem' are both proven", () => {
    polarity();
    const result = ground("appointment.create", "marca a Amanda amanhã às 15h nem às 10 nem às 11", { day_offset: 1, time: "15:00" },
      [quote("date", "amanhã"), quote("time", "às 15h"), excluded("time", "10:00", "nem às 10"), excluded("time", "11:00", "nem às 11")]);
    expect(result.rejected).toEqual([]); expect(result.fields.time).toBe("15:00"); expect(result.exclusions?.verified).toHaveLength(2);
  });
  it("owned negators are threaded into the negation helper by offset only", () => {
    expect(temporalLiteralNegated("marca as 10h nao as 11h", 6, 12)).toBe(true);
    expect(temporalLiteralNegated("marca as 10h nao as 11h", 6, 12, [[13, 23]])).toBe(false);
    expect(temporalLiteralNegated("nao marca as 10h nao as 11h", 10, 16, [[17, 27]])).toBe(true);
  });
});

describe("an affirmed value equal to an excluded one is refused and asked", () => {
  it("proven or not (Luna contradicts herself), and a positive quote inside the exclusion is still denied", () => {
    polarity();
    const proven = ground("appointment.change", "Passa a Amanda para 11h, não 11h", { time: "11:00" }, [quote("time", "para 11h"), excluded("time", "11:00", "não 11h")]);
    expect(proven.fields.time).toBeUndefined(); expect(proven.rejected).toEqual([{ code: "SOURCE_TEMPORAL_CONFLICT", field: "time", value: EXCLUDED_VALUE }]);
    expect(polarityCodes(proven)).toEqual(["TEMPORAL_EXCLUSION_VERIFIED", "TEMPORAL_EXCLUDED_AFFIRMED"]);
    const unproven = ground("appointment.change", "Passa a Amanda para 11h", { time: "11:00" }, [quote("time", "para 11h"), excluded("time", "11:00", "não às onze")]);
    expect(unproven.fields.time).toBeUndefined(); expect(unproven.rejected).toEqual([{ code: "SOURCE_TEMPORAL_CONFLICT", field: "time", value: EXCLUDED_VALUE }]);
    expect(polarityCodes(unproven)).toEqual(["TEMPORAL_EXCLUSION_LITERAL", "TEMPORAL_EXCLUDED_AFFIRMED"]);
    const inside = ground("appointment.change", "Passa a Amanda para 11h, não 10h", { time: "10:00" }, [quote("time", "10h"), excluded("time", "10:00", "não 10h")]);
    expect(inside.fields.time).toBeUndefined(); expect(polarityCodes(inside)).toContain("TEMPORAL_EXCLUSION_OVERLAP");
  });
  it("an exclusion-only reply refuses the accepted value it names and keeps a different one", () => {
    polarity();
    const previous = { date: "2026-09-29", time: "10:00", appointment_ref: "ref" };
    const named = ground("appointment.change", "Não 10h", {}, [excluded("time", "10:00", "Não 10h")], previous);
    expect(named.fields.time).toBeUndefined(); expect(named.fields.date).toBe("2026-09-29"); expect(named.fields.appointment_ref).toBeUndefined();
    expect(named.rejected).toEqual([{ code: "SOURCE_TEMPORAL_CONFLICT", field: "time", value: EXCLUDED_VALUE }]);
    const other = ground("appointment.change", "Não 10h", {}, [excluded("time", "10:00", "Não 10h")], { ...previous, time: "11:00" });
    expect(other.rejected).toEqual([]); expect(other.fields.time).toBe("11:00");
  });
  it("without positive evidence the historical global negation still refuses an unproven value (no weaker acceptance)", () => {
    polarity();
    const result = ground("appointment.change", "Passa a Amanda para 11h, não 10h", { time: "11:00" }, [excluded("time", "10:00", "não 10h")]);
    expect(result.exclusions?.verified).toHaveLength(1); expect(result.fields.time).toBeUndefined();
  });
});

describe("'qualquer horário menos 14h' and reads", () => {
  it("'menos' marks an exclusion: the day is kept and 14h is never offered", () => {
    polarity();
    const result = ground("availability.get", "Quais horários a Tati tem amanhã, qualquer horário menos 14h", { day_offset: 1 }, [quote("date", "amanhã"), excluded("time", "14:00", "menos 14h")]);
    expect(result.rejected).toEqual([]); expect(result.fields.date).toBe("2026-09-29");
    expect([...excludedClocks(result.exclusions)!]).toEqual(["14:00"]);
  });
  it("'digo' proves a spoken correction's exclusion but owns no negation", () => {
    polarity();
    const result = ground("appointment.change", "remarca o diego pra terça, digo, quarta às 10", { weekday: 3, time: "10:00" },
      [quote("date", "quarta"), quote("time", "às 10"), excluded("date", "2026-09-29", "terça, digo")]);
    expect(result.rejected).toEqual([]); expect(result.fields).toMatchObject({ date: "2026-09-30", time: "10:00" });
    expect(result.exclusions?.verified.map(item => item.values)).toEqual([["2026-09-29"]]);
    expect(temporalLiteralNegated("marca as 10h digo as 11h", 6, 12)).toBe(false);
  });
  // Review migration: 'amanhã não quinta' without the comma reads both ways; only the self-correction with the comma owns it.
  it("a read keeps a filter an owned negator sits right before (self-correction 'amanhã não, quinta')", () => {
    polarity();
    const source = "Qual horário a Tatiana tem amanhã não quinta";
    const kept = ground("availability.get", source, { day_offset: 1 }, [quote("date", "amanhã"), excluded("date", "2026-10-01", "não quinta")]);
    expect(kept.rejected).toEqual([]); expect(kept.fields.date).toBe("2026-09-29");
    const attached = ground("availability.get", source, { weekday: 4 }, [quote("date", "quinta")]);
    expect(attached.rejected.map(item => item.field)).toEqual(["date"]);
    const ambiguous = ground("availability.get", source, { weekday: 4 }, [quote("date", "quinta"), excluded("date", "2026-09-29", "amanhã não")]);
    expect(ambiguous.rejected.map(item => item.field)).toEqual(["date"]); expect(ambiguous.fields.date).toBeUndefined();
    const corrected = ground("availability.get", "Qual horário a Tatiana tem amanhã não, quinta", { weekday: 4 }, [quote("date", "quinta"), excluded("date", "2026-09-29", "amanhã não")]);
    expect(corrected.rejected).toEqual([]); expect(corrected.fields.date).toBe("2026-10-01");
  });
});

describe("flag off: exclusions change nothing", () => {
  it("the same inputs ground exactly as without the exclusion entries, with no exclusions carrier", () => {
    polarity(false);
    const source = "passa a amanda pra amanhã às dez não às onze", raw = { day_offset: 1, time: "10:00" }, quotes = [quote("date", "amanhã"), quote("time", "às dez")];
    const withEntry = ground("appointment.change", source, raw, [...quotes, excluded("time", "11:00", "não às onze")]);
    expect(withEntry).toEqual(ground("appointment.change", source, raw, quotes));
    expect(withEntry).not.toHaveProperty("exclusions");
    expect(exclusionSpans(source, [...quotes, excluded("time", "11:00", "não às onze")])).toEqual([]);
  });
});

describe("components mode", () => {
  const clock = (hour: number) => ({ hour, minute: 0, daypart: "UNSPECIFIED" as const });
  const day = (weekday: number) => ({ kind: "WEEKDAY" as const, offset: null, weekday, week: "NEAREST" as const, day: null, month: null, year: null, days: null });
  const turn = (operation: string, source: string, evidence: Evidence[], previous: SchedulingFields = {}) =>
    groundSchedulingTemporalTurn(previous, {}, source, tz, now, undefined, operation, evidence);
  // Review migration: the unpunctuated self-correction reads both ways (asked); the comma settles it.
  it("voice self-correction with components: 11h affirmed, 10h excluded, the day kept", () => {
    polarity(); components();
    const tomorrow = { field: "date" as const, text: "amanhã", component: { kind: "RELATIVE_DAY" as const, offset: 1, weekday: null, week: null, day: null, month: null, year: null, days: null } };
    const result = turn("appointment.create", "marca a Amanda amanhã às dez não, às onze", [tomorrow, { field: "time", text: "às onze", component: clock(11) }, excluded("time", clock(10), "às dez não")]);
    expect(result.rejected).toEqual([]); expect(result.fields).toMatchObject({ date: "2026-09-29", time: "11:00" });
    expect(result.exclusions?.verified.map(item => item.values)).toEqual([["10:00"]]);
    const spoken = turn("appointment.create", "marca a Amanda amanhã às dez não às onze", [tomorrow, { field: "time", text: "às onze", component: clock(11) }, excluded("time", clock(10), "às dez não")]);
    expect(spoken.fields.time).toBeUndefined(); expect(spoken.fields.date).toBeUndefined();
    const inside = turn("appointment.create", "Marca a Carla, não amanhã às 10h", [{ field: "time", text: "às 10h", component: clock(10) }, excluded("date", tomorrow.component, "não amanhã")]);
    expect(inside.fields.time).toBeUndefined();
    const refused = turn("appointment.create", "marca a Amanda amanhã às dez não às onze", [{ field: "date", text: "amanhã", component: { kind: "RELATIVE_DAY", offset: 1, weekday: null, week: null, day: null, month: null, year: null, days: null } },
      { field: "time", text: "às onze", component: clock(11) }]);
    expect(refused.fields.time).toBeUndefined(); expect(refused.fields.date).toBeUndefined();
  });
  it("a weekday exclusion is proven by its own component; a component value equal to an excluded one is asked", () => {
    polarity(); components();
    const kept = turn("appointment.create", "Marca a Amanda na sexta, não na quinta, às 10h", [{ field: "date", text: "na sexta", component: day(5) },
      { field: "time", text: "às 10h", component: clock(10) }, excluded("date", day(4), "não na quinta")]);
    expect(kept.rejected).toEqual([]); expect(kept.fields).toMatchObject({ date: "2026-10-02", time: "10:00" });
    const contradicted = turn("appointment.create", "Marca a Amanda na sexta às 10h, não sexta", [{ field: "date", text: "na sexta", component: day(5) },
      { field: "time", text: "às 10h", component: clock(10) }, excluded("date", day(5), "não sexta")]);
    expect(contradicted.fields.date).toBeUndefined(); expect(contradicted.rejected).toContainEqual({ code: "SOURCE_TEMPORAL_CONFLICT", field: "date", value: EXCLUDED_VALUE });
  });
  it("a bare 1-7 clock exclusion excludes both halves", () => {
    polarity(); components();
    const result = turn("availability.get", "horários de amanhã menos às duas", [{ field: "date", text: "amanhã", component: { kind: "RELATIVE_DAY", offset: 1, weekday: null, week: null, day: null, month: null, year: null, days: null } },
      excluded("time", clock(2), "menos às duas")]);
    expect(result.fields.date).toBe("2026-09-29"); expect([...excludedClocks(result.exclusions)!]).toEqual(["02:00", "14:00"]);
  });
});

describe("multi-action: scope and sibling masking", () => {
  const op = (item_key: string, operation: string, temporal_evidence: Evidence[], extra: Record<string, unknown> = {}) => ({ item_key, operation, depends_on: [], released_slot_of: null,
    source_scope: null, target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [], temporal_evidence, ...extra }) as unknown as SelectedOperation;
  const message = "Marca a Amanda amanhã qualquer horário menos 14h e cancela o Fábio";
  const amanda = op("a", "appointment.create", [quote("date", "amanhã"), excluded("time", "14:00", "menos 14h")], { customer_name: "Amanda" });
  const fabio = op("b", "appointment.cancel", [], { customer_name: "Fábio" });
  it("a sibling's proven exclusion is masked like its quotes; its own action keeps it", () => {
    polarity();
    const forFabio = siblingScopedMessage(message, fabio, [amanda, fabio]);
    expect(forFabio).not.toContain("14h"); expect(forFabio).not.toContain("amanhã"); expect(forFabio).toHaveLength(message.length);
    expect(siblingScopedMessage(message, amanda, [amanda, fabio])).toBe(message);
    // The evidence-less cancel no longer finds an unclaimed clock in the other action's exclusion.
    expect(ground("appointment.cancel", forFabio, { customer_name: "Fábio" }, []).rejected).toEqual([]);
  });
  it("a sibling's exclusion is blanked without its marker: its negator never disappears from the other action's view", () => {
    polarity();
    const text = "Marca a Amanda amanhã não às 14h e cancela o Fábio";
    const withNegator = op("a", "appointment.create", [quote("date", "amanhã"), excluded("time", "14:00", "não às 14h")], { customer_name: "Amanda" });
    const forFabio = siblingScopedMessage(text, fabio, [withNegator, fabio]);
    expect(forFabio).not.toContain("14h"); expect(forFabio).toContain(" não "); expect(forFabio).toHaveLength(text.length);
  });
  it("an unproven sibling exclusion is not masked; with the flag off nothing changes", () => {
    polarity();
    const bogus = op("a", "appointment.create", [quote("date", "amanhã"), excluded("time", "14:00", "qualquer horário menos 14h")]);
    expect(siblingScopedMessage(message, fabio, [bogus, fabio])).toContain("menos 14h");
    polarity(false);
    expect(siblingScopedMessage(message, fabio, [amanda, fabio])).toContain("menos 14h");
  });
  it("scope coverage counts an exclusion's atom as claimed only once it is proven", () => {
    polarity();
    const source = "Marca a Amanda amanhã qualquer horário menos 14h", raw = { day_offset: 1 };
    const proven = ground("appointment.create", source, raw, [quote("date", "amanhã"), excluded("time", "14:00", "menos 14h")]);
    expect(applyScopeCoverage(proven, source, tz, now, "appointment.create", raw, [quote("date", "amanhã"), excluded("time", "14:00", "menos 14h")])).toEqual([]);
    const unproven = ground("appointment.create", source, raw, [quote("date", "amanhã"), excluded("time", "15:00", "menos 14h")]);
    expect(applyScopeCoverage(unproven, source, tz, now, "appointment.create", raw, [quote("date", "amanhã"), excluded("time", "15:00", "menos 14h")])).toEqual(["TEMPORAL_SCOPE_UNCLAIMED_CLOCK"]);
  });
});
