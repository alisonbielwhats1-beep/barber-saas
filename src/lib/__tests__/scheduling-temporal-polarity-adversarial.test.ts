import { afterEach, describe, expect, it, vi } from "vitest";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import { groundSchedulingTemporalTurn } from "../scheduling-temporal-mode";

/** Adversarial review cases (kept as regression) for the repairCue / adjacentMarker change in scheduling-temporal-polarity.ts.
 * `safe` = the outcome the safety principle requires (asked / the negated or unproven value not accepted). */
const now = new Date("2026-09-28T12:00:00Z"), tz = "America/Sao_Paulo"; // Monday 09:00 in the salon
type E = { field: string; text: string; excluded?: unknown; component?: unknown };
type R = ReturnType<typeof groundSchedulingTemporal>;
const q = (field: string, text: string): E => ({ field, text });
const x = (field: string, value: unknown, text: string): E => ({ field, text, excluded: value });
const qc = (field: string, text: string, component: unknown): E => ({ field, text, component });
const clock = (hour: number) => ({ hour, minute: 0, daypart: "UNSPECIFIED" });
const tomorrow = { kind: "RELATIVE_DAY", offset: 1, weekday: null, week: null, day: null, month: null, year: null, days: null };
const legacy = (op: string, src: string, raw: Record<string, unknown>, ev: E[], flag = true): R => {
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_POLARITY", flag ? "true" : "false"); vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "false");
  return groundSchedulingTemporal({}, raw as never, src, tz, now, undefined, op, ev as never);
};
const comp = (op: string, src: string, ev: E[], flag = true, previous: Record<string, unknown> = {}): R => {
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_POLARITY", flag ? "true" : "false"); vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true");
  return groundSchedulingTemporalTurn(previous as never, {}, src, tz, now, undefined, op, ev as never);
};
const noTime = (r: R) => r.fields.time === undefined;
const not = (value: string) => (r: R) => r.fields.time !== value;
const moved = { date: "2026-09-30", time: "15:00" };
const nemSrc = "Remarca a Amanda, amanhã não dá, às dez nem na verdade às onze";

const cases: { id: string; run: () => R; safe: (r: R) => boolean }[] = [
  // A: adjacentMarker's extended span is not re-checked against positive quotes (a positive quote beginning/ending at the adopted negator).
  { id: "A1 comp 'Passa a Amanda para 11h não 10h' pos 'não 10h'=10 excl '11h'", safe: noTime,
    run: () => comp("appointment.change", "Passa a Amanda para 11h não 10h", [qc("time", "não 10h", clock(10)), x("time", clock(11), "11h")]) },
  { id: "A1c control: same, Luna quotes excl '11h não' (OVERLAP)", safe: noTime,
    run: () => comp("appointment.change", "Passa a Amanda para 11h não 10h", [qc("time", "não 10h", clock(10)), x("time", clock(11), "11h não")]) },
  { id: "A2 comp 'amanhã às dez não às onze' pos 'não às onze'=11 excl 'às dez'", safe: r => noTime(r) && r.fields.date === undefined,
    run: () => comp("appointment.create", "marca a Amanda amanhã às dez não às onze", [qc("date", "amanhã", tomorrow), qc("time", "não às onze", clock(11)), x("time", clock(10), "às dez")]) },
  { id: "A3 legacy 'às onze não ao meio-dia' pos 'não ao meio-dia'=12 excl 'às onze'", safe: r => noTime(r) && r.fields.date === undefined,
    run: () => legacy("appointment.create", "marca a Amanda amanhã às onze não ao meio-dia", { day_offset: 1, time: "12:00" }, [q("date", "amanhã"), q("time", "não ao meio-dia"), x("time", "11:00", "às onze")]) },
  { id: "A4 legacy 'ao meio-dia não às onze' pos 'ao meio-dia não'=12 excl 'às onze' (leading adoption)", safe: noTime,
    run: () => legacy("appointment.create", "marca a Amanda ao meio-dia não às onze", { time: "12:00" }, [q("time", "ao meio-dia não"), x("time", "11:00", "às onze")]) },
  { id: "A5 comp 'às dez nem às onze' pos 'nem às onze'=11 excl 'às dez' (lead-only nem adopted as trailing)", safe: noTime,
    run: () => comp("appointment.create", "marca a Amanda amanhã às dez nem às onze", [qc("date", "amanhã", tomorrow), qc("time", "nem às onze", clock(11)), x("time", clock(10), "às dez")]) },
  // B: the cue branch owns a lead-only 'nem', which reaches forward across the cue ('nem, na verdade, às onze').
  { id: "B0 control flag off", safe: noTime, run: () => legacy("appointment.change", nemSrc, { time: "11:00" }, [q("time", "às onze")], false) },
  { id: "B1 legacy excl Luna-quoted 'às dez nem'", safe: noTime, run: () => legacy("appointment.change", nemSrc, { time: "11:00" }, [q("time", "às onze"), x("time", "10:00", "às dez nem")]) },
  { id: "B2 legacy excl atom-only 'às dez'", safe: noTime, run: () => legacy("appointment.change", nemSrc, { time: "11:00" }, [q("time", "às onze"), x("time", "10:00", "às dez")]) },
  { id: "B3 comp excl atom-only 'às dez' (change keeps original day)", safe: not("11:00"), run: () => comp("appointment.change", nemSrc, [qc("time", "às onze", clock(11)), x("time", clock(10), "às dez")], true, moved) },
  { id: "B4 legacy 'às dez nem digo às onze'", safe: noTime,
    run: () => legacy("appointment.create", "Marca a Amanda amanhã, às dez nem digo às onze", { day_offset: 1, time: "11:00" }, [q("date", "amanhã"), q("time", "às onze"), x("time", "10:00", "às dez")]) },
  // C: the cue opens a repair, but of what? (another field, or a non-temporal slot)
  { id: "C0 control 'pra amanhã não às onze' (no cue)", safe: noTime,
    run: () => legacy("appointment.change", "remarca a Amanda pra amanhã não às onze", { time: "11:00" }, [q("time", "às onze"), x("date", "2026-09-29", "amanhã")]) },
  { id: "C1 comp cross-field 'pra amanhã não pera às onze' excl date, pos clock", safe: not("11:00"),
    run: () => comp("appointment.change", "remarca a Amanda pra amanhã não pera às onze", [qc("time", "às onze", clock(11)), x("date", tomorrow, "amanhã")], true, moved) },
  { id: "C2 comp customer repair 'às dez não espera a Carla às onze'", safe: noTime,
    run: () => comp("appointment.create", "marca a Amanda amanhã às dez não espera a Carla às onze", [qc("date", "amanhã", tomorrow), qc("time", "às onze", clock(11)), x("time", clock(10), "às dez")]) },
  // Controls expected to hold with and without the change.
  ...["marca a Amanda amanhã às dez não pera não às onze", "marca a Amanda amanhã às dez não ela pera às onze", "marca a Amanda amanhã às dez não melhor horário às onze",
    "marca a Amanda amanhã às dez não pera não marca às onze", "Não, pera, marca a Amanda amanhã às dez não às onze", "Não marca a Amanda amanhã às dez não pera às onze"]
    .map(src => ({ id: `K ${src}`, safe: noTime, run: () => legacy("appointment.create", src, { day_offset: 1, time: "11:00" }, [q("date", "amanhã"), q("time", "às onze"), x("time", "10:00", "às dez")]) })),
  { id: "K reverse reading 'às dez não pera às onze' pos 10 excl 'às onze'", safe: noTime,
    run: () => legacy("appointment.create", "marca a Amanda amanhã às dez não pera às onze", { day_offset: 1, time: "10:00" }, [q("date", "amanhã"), q("time", "às dez"), x("time", "11:00", "às onze")]) },
  { id: "K comma pinned 'para 11h, não 10h' pos 'não 10h' excl '11h'", safe: noTime,
    run: () => comp("appointment.change", "Passa a Amanda para 11h, não 10h", [qc("time", "não 10h", clock(10)), x("time", clock(11), "11h")]) },
  { id: "K 'não remarca amanhã às 10h' excl 'amanhã'", safe: noTime,
    run: () => legacy("appointment.change", "não remarca amanhã às 10h", { time: "10:00" }, [q("time", "às 10h"), x("date", "2026-09-29", "amanhã")]) },
  // Motivating case (should be accepted after the change: 11h + amanhã).
  { id: "M motivating 'remarca a rosa pra amanhã às dez não pera às onze'", safe: r => r.fields.time === "11:00" && r.fields.date === "2026-09-29",
    run: () => legacy("appointment.change", "remarca a rosa pra amanhã às dez não pera às onze", { day_offset: 1, time: "11:00" }, [q("date", "amanhã"), q("time", "às onze"), x("time", "10:00", "às dez")]) },
  { id: "M comp motivating (components)", safe: r => r.fields.time === "11:00" && r.fields.date === "2026-09-29",
    run: () => comp("appointment.change", "remarca a rosa pra amanhã às dez não pera às onze", [qc("date", "amanhã", tomorrow), qc("time", "às onze", clock(11)), x("time", clock(10), "às dez")]) },
  { id: "M comma+cue 'às dez, não, pera, às onze'", safe: r => r.fields.time === "11:00",
    run: () => comp("appointment.create", "marca a Amanda amanhã às dez, não, pera, às onze", [qc("date", "amanhã", tomorrow), qc("time", "às onze", clock(11)), x("time", clock(10), "às dez")]) },
];
const outcome = (r: R) => JSON.stringify({ date: r.fields.date, time: r.fields.time, rejected: r.rejected.map(i => i.field), owned: r.exclusions?.verified.map(v => v.owned), codes: r.exclusions?.codes });

afterEach(() => { vi.unstubAllEnvs(); });
describe("polarity review (28/09): repair cue and adopted markers never accept a negated or two-way value", () => {
  for (const c of cases) it(c.id, () => { const r = c.run(); expect(c.safe(r), outcome(r)).toBe(true); });
});
