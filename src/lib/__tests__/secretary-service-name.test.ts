import { describe, expect, it } from "vitest";
import { normalizeSecretaryServiceName } from "../secretary-service-name";

describe("conservative model-extracted service name", () => {
  it.each([
    ["massagem", "Massagem"],
    ["  massagem \t", "Massagem"],
    ["Massagem", "Massagem"],
    ["massagem relaxante", "Massagem relaxante"],
    ["massagem  relaxante", "Massagem  relaxante"],
    ["  LED facial  ", "LED facial"],
    ["SPA", "SPA"],
    ["iPhone Care", "iPhone Care"],
    ["pH Therapy", "pH Therapy"],
    ["e.l.f.", "e.l.f."],
    ["massagem Thai", "massagem Thai"],
    ["ácido hialurônico", "Ácido hialurônico"],
    ["ßpecial", "ßpecial"],
    ["3D facial", "3D facial"],
  ])("%s -> %s (idempotent)", (input, expected) => {
    const result = normalizeSecretaryServiceName(input);
    expect(result).toBe(expected);
    expect(normalizeSecretaryServiceName(result)).toBe(result);
  });
  it("retains domain validation instead of inventing an empty name", () => {
    expect(() => normalizeSecretaryServiceName("  ")).toThrow();
    expect(() => normalizeSecretaryServiceName("a")).toThrow();
  });
});
