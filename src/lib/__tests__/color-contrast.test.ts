import { expect, it } from "vitest";
import { contrastForeground } from "../color-contrast";
it("keeps initials readable on both dark and light professional colors", () => {
  expect(contrastForeground("#9e315a")).toBe("#ffffff");
  expect(contrastForeground("#f4c430")).toBe("#000000");
  expect(contrastForeground("#126949")).toBe("#ffffff");
  expect(contrastForeground("#ffffff")).toBe("#000000");
});
