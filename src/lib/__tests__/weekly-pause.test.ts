import { describe, expect, it } from "vitest";
import { subtractWeeklyPause, weeklyPauseInput } from "../weekly-pause";

describe("weekly pause", () => {
  const hours = [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startMinutes: 540, endMinutes: 1260 }));
  const pause = { weekdays: [1, 2, 3, 4, 5], startMinutes: 750, endMinutes: 870 };
  it("cuts lunch Monday to Friday, preserving Saturday and Sunday off", () => {
    const result = subtractWeeklyPause(hours, pause);
    expect(result).toHaveLength(11);
    expect(result.filter(r => r.weekday === 1)).toEqual([{ weekday: 1, startMinutes: 540, endMinutes: 750 }, { weekday: 1, startMinutes: 870, endMinutes: 1260 }]);
    expect(result.filter(r => r.weekday === 6)).toEqual([hours[5]]);
    expect(result.some(r => r.weekday === 0)).toBe(false);
  });
  it("supports weekends, existing gaps, clipping and idempotent reapplication", () => {
    const original = [{ weekday: 0, startMinutes: 540, endMinutes: 720 }, { weekday: 0, startMinutes: 900, endMinutes: 1260 }, ...hours];
    const request = { weekdays: [0, 6], startMinutes: 750, endMinutes: 930 };
    const result = subtractWeeklyPause(original, request);
    expect(result.filter(r => r.weekday === 0)).toEqual([{ weekday: 0, startMinutes: 540, endMinutes: 720 }, { weekday: 0, startMinutes: 930, endMinutes: 1260 }]);
    expect(subtractWeeklyPause(result, request)).toEqual(result);
    expect(result.filter(r => r.weekday === 1)).toEqual([hours[0]]);
  });
  it("never creates hours where the professional was unavailable", () => {
    expect(subtractWeeklyPause(hours, { weekdays: [1], startMinutes: 0, endMinutes: 1440 }).some(r => r.weekday === 1)).toBe(false);
    expect(subtractWeeklyPause(hours, { weekdays: [1], startMinutes: 0, endMinutes: 540 })).toEqual(hours);
  });
  it("validates weekdays and interval at the server boundary", () => {
    expect(weeklyPauseInput.safeParse({ ...pause, professionalIds: ["p"] }).success).toBe(true);
    for (const invalid of [{ weekdays: [] }, { weekdays: [7] }, { startMinutes: 900 }, { professionalIds: [] }]) expect(weeklyPauseInput.safeParse({ ...pause, professionalIds: ["p"], ...invalid }).success).toBe(false);
  });
});
