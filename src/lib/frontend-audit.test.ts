import { describe, expect, it } from "vitest";
import { percentageChange } from "./dashboard";
import { commandShortcutLabel } from "./platform-shortcut";

describe("frontend audit business rules", () => {
  it("does not invent a 100% increase when the previous period is zero", () => {
    expect(percentageChange(100, 0)).toBeNull();
    expect(percentageChange(0, 0)).toBeNull();
  });

  it("calculates a real comparison when both periods have data", () => {
    expect(percentageChange(150, 100)).toBe(0.5);
    expect(percentageChange(75, 100)).toBe(-0.25);
  });

  it("shows the native command shortcut for macOS and Windows", () => {
    expect(commandShortcutLabel("MacIntel")).toBe("⌘K");
    expect(commandShortcutLabel("Win32")).toBe("Ctrl K");
    expect(commandShortcutLabel("Linux x86_64")).toBe("Ctrl K");
  });
});
