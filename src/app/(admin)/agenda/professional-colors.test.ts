import { describe, expect, it } from "vitest";
import { professionalColors } from "./professional-colors";

describe("professional calendar identity", () => {
  it("preserves configured colors and separates missing, duplicate and invalid ones", () => {
    const roster = [
      { id: "a", colorHex: "#aa77cc" }, { id: "b", colorHex: "#AA77CC" },
      { id: "c", colorHex: null }, { id: "d", colorHex: "invalid" },
      { id: "e", colorHex: "#4b91d1" },
    ];
    const colors = professionalColors(roster);
    expect(colors.get("a")).toBe("#AA77CC");
    expect(colors.get("e")).toBe("#4B91D1");
    expect(new Set(colors.values()).size).toBe(roster.length);
    expect([...professionalColors([...roster].reverse())]).toEqual([...colors]);
    expect(roster[0].colorHex).toBe("#aa77cc");
  });
  it("does not repeat the palette for larger teams", () => {
    const colors = professionalColors(Array.from({ length: 30 }, (_, i) => ({ id: String(i), colorHex: null })));
    expect(new Set(colors.values()).size).toBe(30);
  });
});
