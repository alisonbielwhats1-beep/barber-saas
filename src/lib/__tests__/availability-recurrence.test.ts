import { describe, expect, it } from "vitest";
import { availabilityOccurrences } from "../availability-recurrence";

describe("availability recurrence", () => {
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
