import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inventoryClosedSemanticsV1 } from "../../../packages/salon-secretary/src/inventory-closed-semantics";
import { inventorySkill } from "../../../packages/salon-secretary/src/inventory-skill";
import { loadSkills } from "../../../packages/salon-secretary/src/skill-registry";
import { deriveOperation, derivationCatalog, publishedDecisionCatalog, isAuditedPublication } from "../../../packages/salon-secretary/evaluation/derivation-catalog";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("closed JEV semantics and open extraction instructions have separate identities", () => {
  it("publishes the audited semantics verbatim in the actual live manual", () => {
    expect(inventorySkill.startsWith(inventoryClosedSemanticsV1 + "\n")).toBe(true);
    expect(inventorySkill).toContain("quantity no transporte é {value,literal}");
    expect(publishedDecisionCatalog().inventory.manualHash).toBe(hash(inventoryClosedSemanticsV1));
    expect(publishedDecisionCatalog().inventory.manualHash).not.toBe(hash(inventorySkill));
    expect(isAuditedPublication(publishedDecisionCatalog())).toBe(true);
  });

  it("rejects a changed closed meaning with the original V1 guard", () => {
    const publication = publishedDecisionCatalog();
    publication.inventory.manualHash = hash(inventoryClosedSemanticsV1.replace("stock <= minStock", "stock < minStock"));
    expect(isAuditedPublication(publication)).toBe(false);
    expect(deriveOperation("inventory", "single", "inventory", "low_stock", derivationCatalog, publication))
      .toEqual({ ok: false, reason: "CATALOG_DRIFT" });
  });

  it("sends the full current manual to Luna instead of silently pinning old extraction instructions", () => {
    const loaded = loadSkills({ skill_ids: ["inventory"] });
    expect(loaded.manuals[0].manual_hash).toBe(createHash("sha256").update(inventorySkill).digest("hex"));
    expect(JSON.stringify(loaded)).toContain("quantity no transporte é {value,literal}");
    expect(JSON.stringify(loaded)).toContain("Uma contagem de embalagens fica pendente");
  });
});
