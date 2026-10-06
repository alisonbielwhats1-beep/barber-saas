import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyFrozen } from "../../../packages/salon-secretary/evaluation/hard-conversations-preflight";
import { verifyUltimate10Plan } from "../../../packages/salon-secretary/evaluation/ultimate-10";
import { assertInventoryAuditPins } from "../../../packages/salon-secretary/evaluation/inventory-readonly-plan";

// Default filesystem reads stay live. A single inner-guard test restores only
// its predecessor source so the later inventory guard can also be exercised.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
describe("V2 does not inherit authorization from frozen V1 evaluation manifests", () => {
  it("refuses the old Hard Conversations source seal", () => {
    expect(() => verifyFrozen(process.cwd())).toThrow("HASH_MISMATCH");
  });
  it("refuses the old Ultimate source seal without any inference", () => {
    expect(() => verifyUltimate10Plan(process.cwd())).toThrow("ULTIMATE10_CONTENT_DRIFT");
  });
  it("refuses the old JEV Inventory audit without expanding its allowlist", async () => {
    expect(() => assertInventoryAuditPins()).toThrow("FROZEN_PREDECESSOR_DRIFT");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
    const historical = legacyEvidenceFs(actual);
    const predecessor = resolve("packages/salon-secretary/evaluation/derivation-catalog.ts");
    await vi.mocked(readFileSync).withImplementation(((file, options) => {
      return typeof file === "string" && resolve(file) === predecessor
        ? historical(file, options) : actual.readFileSync(file, options);
    }) as typeof readFileSync, async () => {
      expect(() => assertInventoryAuditPins()).toThrow("INVENTORY_AUDIT_DRIFT");
    });
    expect(() => assertInventoryAuditPins()).toThrow("FROZEN_PREDECESSOR_DRIFT");
  });
});
