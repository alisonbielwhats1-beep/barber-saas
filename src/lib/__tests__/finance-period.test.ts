import { describe, expect, it } from "vitest";
import { resolveFinanceCalendar } from "../finance-period";

describe("finance calendar boundaries", () => {
  it("resolves a chosen day in the salon timezone, not UTC", () => {
    const period = resolveFinanceCalendar({mode:"day",date:"2026-09-20"}, "America/Sao_Paulo");
    expect(period.from.toISOString()).toBe("2026-09-20T03:00:00.000Z");
    expect(period.to.toISOString()).toBe("2026-09-21T03:00:00.000Z");
  });
  it("uses calendar week Sunday to Saturday across a year boundary", () => {
    const period = resolveFinanceCalendar({mode:"week",date:"2027-01-01"}, "America/Sao_Paulo");
    expect(period.fromDate).toBe("2026-12-27");
    expect(period.toDate).toBe("2027-01-03");
  });
  it("includes leap day and excludes the following month", () => {
    const period = resolveFinanceCalendar({mode:"month",date:"2028-02-15"}, "America/Sao_Paulo");
    expect(period.fromDate).toBe("2028-02-01");
    expect(period.toDate).toBe("2028-03-01");
  });
  it("follows daylight saving boundaries without adding a fixed 24 hours", () => {
    const period = resolveFinanceCalendar({mode:"day",date:"2026-03-08"}, "America/New_York");
    expect(period.to.getTime()-period.from.getTime()).toBe(23*60*60*1000);
  });
  it("rejects invalid calendar dates", () => {
    expect(() => resolveFinanceCalendar({mode:"day",date:"2026-02-30"}, "America/Sao_Paulo")).toThrow();
  });
});
