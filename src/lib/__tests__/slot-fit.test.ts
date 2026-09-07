import { expect, it } from "vitest";
import { bestFitSlots } from "../slot-fit";
it("prefers the smallest free run, preserving the larger gap", () => {
  expect(bestFitSlots(["09:00", "09:15", "09:30", "11:00", "14:00", "14:15"])).toEqual(["11:00", "14:00", "09:00"]);
  expect(bestFitSlots([])).toEqual([]);
});
