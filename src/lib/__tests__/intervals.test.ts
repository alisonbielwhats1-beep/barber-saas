import { describe, expect, it } from "vitest";
import { subtractIntervals, unionIntervals } from "../intervals";

describe("capacity intervals", () => {
  it("counts overlapping shifts once without mutating input", () => {
    const shifts = [{ start: 9, end: 13 }, { start: 12, end: 17 }];
    expect(unionIntervals(shifts)).toEqual([{ start: 9, end: 17 }]);
    expect(shifts[0].end).toBe(13);
  });
  it("clips absence to working hours and avoids double subtraction", () => {
    expect(subtractIntervals([{ start: 9, end: 17 }], [
      { start: 0, end: 10 }, { start: 9, end: 11 }, { start: 16, end: 24 },
    ])).toEqual([{ start: 11, end: 16 }]);
  });
  it("removes closures completely and keeps adjacent intervals available", () => {
    expect(subtractIntervals([{ start: 9, end: 17 }], [{ start: 0, end: 24 }])).toEqual([]);
    expect(subtractIntervals([{ start: 9, end: 17 }], [{ start: 17, end: 20 }])).toEqual([{ start: 9, end: 17 }]);
  });
});
