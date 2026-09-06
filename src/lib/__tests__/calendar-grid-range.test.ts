import { describe, expect, it } from "vitest";
import { calendarGridRangeInTimeZone, dateKeyInTimeZone } from "../time";
describe("calendar grid bounds", () => {
  it.each([["2026-09-06", "2026-08-31", "2026-10-05"], ["2026-12-20", "2026-11-30", "2027-01-04"]])("covers every rendered day for %s", (date, first, end) => {
    const range = calendarGridRangeInTimeZone(date, "America/Sao_Paulo");
    expect(dateKeyInTimeZone(range.from, "America/Sao_Paulo")).toBe(first);
    expect(dateKeyInTimeZone(range.to, "America/Sao_Paulo")).toBe(end);
  });
});
