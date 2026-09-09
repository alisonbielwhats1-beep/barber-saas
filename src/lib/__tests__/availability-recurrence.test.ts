import { describe, expect, it } from "vitest";
import { availabilityOccurrences } from "../availability-recurrence";

describe("availability recurrence", () => {
  it("expands selected weekdays inclusively and preserves weekends", () => {
    const dates = availabilityOccurrences("2026-09-07T12:30", "2026-09-07T14:30", "America/Sao_Paulo", 0, 1, { weekdays: [1, 2, 3, 4, 5], untilDate: "2026-09-13" });
    expect(dates).toHaveLength(5);
    expect(dates[0].startAt.toISOString()).toBe("2026-09-07T15:30:00.000Z");
    expect(dates[4].endAt.toISOString()).toBe("2026-09-11T17:30:00.000Z");
    const weekend = availabilityOccurrences("2026-09-07T12:30", "2026-09-07T14:30", "UTC", 0, 1, { weekdays: [0, 6], untilDate: "2026-09-13" });
    expect(weekend.map(i => i.startAt.toISOString().slice(0, 10))).toEqual(["2026-09-12", "2026-09-13"]);
  });
  it("rejects invalid, empty and multi-day weekday repetitions", () => {
    for (const days of [{ weekdays: [], untilDate: "2026-09-13" }, { weekdays: [7], untilDate: "2026-09-13" }, { weekdays: [0], untilDate: "2026-09-08" }, { weekdays: [1], untilDate: "2026-09-06" }, { weekdays: [1], untilDate: "2028-09-13" }]) expect(() => availabilityOccurrences("2026-09-07T12:30", "2026-09-07T14:30", "UTC", 0, 1, days)).toThrow();
    expect(() => availabilityOccurrences("2026-09-07T12:30", "2026-09-08T14:30", "UTC", 0, 1, { weekdays: [1], untilDate: "2026-09-13" })).toThrow();
  });
  it("keeps weekday repetitions at the same local time across DST", () => {
    const dates = availabilityOccurrences("2026-03-01T12:00", "2026-03-01T13:00", "America/New_York", 0, 1, { weekdays: [0], untilDate: "2026-03-08" });
    expect(dates.map(d => d.startAt.toISOString())).toEqual(["2026-03-01T17:00:00.000Z", "2026-03-08T16:00:00.000Z"]);
  });
  it("keeps civil time across daylight-saving changes", () => {
    const dates = availabilityOccurrences("2026-03-01T12:00", "2026-03-01T13:00", "America/New_York", 1, 2);
    expect(dates.map(d => d.startAt.toISOString())).toEqual(["2026-03-01T17:00:00.000Z", "2026-03-08T16:00:00.000Z"]);
  });
  it("rejects overlapping occurrences, invalid dates and excessive horizons", () => {
    expect(() => availabilityOccurrences("2026-03-01T12:00", "2026-03-10T13:00", "UTC", 1, 2)).toThrow();
    expect(() => availabilityOccurrences("2026-02-30T12:00", "2026-03-01T13:00", "UTC")).toThrow();
    expect(() => availabilityOccurrences("2026-03-01T12:00", "2026-03-01T13:00", "UTC", 4, 52)).toThrow();
  });
});
