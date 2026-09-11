import { describe, expect, it } from "vitest";
import { minuteAtSlotPointer } from "./agenda-slot-pointer";

describe("pointer inside a half-hour row", () => {
  it.each([0, 5, 10, 15, 20, 25])("preserves the %i-minute segment instead of selecting 18:30", minute => {
    expect(minuteAtSlotPointer(18 * 60 + 30, 100 + (minute + 1) * 1.7, 100, 51)).toBe(18 * 60 + 30 + minute);
  });
  it("clamps a pointer outside the row", () => {
    expect(minuteAtSlotPointer(1110, 90, 100, 51)).toBe(1110);
    expect(minuteAtSlotPointer(1110, 155, 100, 51)).toBe(1135);
  });
});
