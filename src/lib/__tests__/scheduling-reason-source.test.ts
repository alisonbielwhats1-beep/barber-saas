import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const { frontHistoricalFs } = await import('../../test/secretary-front-history');
  return { ...actual, readFileSync: vi.fn(frontHistoricalFs(actual)) };
});
import { groundOriginalSchedulingException } from "../scheduling-reason-source";
import { schedulingPatch, schedulingResolved } from "../scheduling-contract";
import { equivalentField, equivalentReason } from "../../../packages/salon-secretary/evaluation/evaluator-text";
import { verifyPrior, verifyFrozenTarget, protectExisting, canStartCompleteCase, targetCases } from "../../../packages/salon-secretary/evaluation/x94-original-target";
import { verifyOriginalEvidence } from "../../../packages/salon-secretary/evaluation/topic14-final-target";

const prefix = "Coloca Fábio Santos para Corte Completo, mesmo que dê conflito, porque ";
function extract(original: string, interpreted: string) {
  const patch: Record<string, unknown> = { customer_name: "Fábio Santos", override_reason: interpreted };
  const message = prefix + original + ".";
  groundOriginalSchedulingException(patch, {}, message);
  return { patch, message, source: patch.override_reason_source as { start: number; end: number; original_text: string; interpreted_text: string; message_sha256: string } };
}
describe("Original override reason — extraction, never coreference resolution", () => {
  it("preserves the earlier source archive and rejects reuse of the old live authorization", () => {
    expect(verifyPrior().changes).toHaveLength(5);
    expect(() => verifyOriginalEvidence()).toThrow("FINAL_RUNTIME_DRIFT");
    expect(targetCases.map(c => c.id)).toEqual(["x94"]);
    expect(canStartCompleteCase(0, "x94")).toBe(true);
    expect(canStartCompleteCase(1, "x94")).toBe(false);
    expect(() => canStartCompleteCase(0, "x93")).toThrow("X94_CASE_FORBIDDEN");
  });
  it("rejects the changed live runtime before the old authorization can reach database or network", async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const databaseAccess = vi.fn(() => { throw Error('DATABASE_FORBIDDEN'); });
    const admin = new Proxy({} as Parameters<typeof protectExisting>[0], { get: databaseAccess });
    await vi.mocked(readFileSync).withImplementation(actual.readFileSync, async () => {
      expect(() => verifyPrior()).toThrow('X94_UNAUTHORIZED_SOURCE_DRIFT');
      expect(() => verifyFrozenTarget()).toThrow('X94_UNAUTHORIZED_SOURCE_DRIFT');
      await expect(protectExisting(admin)).rejects.toThrow('X94_UNAUTHORIZED_SOURCE_DRIFT');
      expect(databaseAccess).not.toHaveBeenCalled();
    });
    // Restoration belongs only to the test's historical reader. Live admission has no bypass.
    expect(verifyPrior().changes).toHaveLength(5);
  });
  it("preserves the exact original and source span when the model expands an unproved subject", () => {
    const { patch, source, message } = extract("ele já está aguardando", "Fábio já está aguardando");
    expect(patch.override_reason).toBe("ele já está aguardando");
    expect(source.original_text).toBe(message.slice(source.start, source.end));
    expect(source.interpreted_text).toBe("Fábio já está aguardando");
    expect(source.message_sha256).toBe(createHash("sha256").update(message).digest("hex"));
    expect(source).not.toHaveProperty("resolved_entity");
    expect(schedulingResolved.parse(patch).override_reason_source).toEqual(source);
  });
  it("preserves original capitalization rather than the interpreter's capitalization", () => {
    expect(extract("Ele já está aguardando", "ele já está aguardando").patch.override_reason).toBe("Ele já está aguardando");
  });
  it("preserves literal pronouns and negation without inferring a referent", () => {
    expect(extract("ele já está aguardando", "ele já está aguardando").patch.override_reason).toBe("ele já está aguardando");
    expect(extract("ele NÃO está aguardando", "Fábio NÃO está aguardando").patch.override_reason).toBe("ele NÃO está aguardando");
    expect(extract("ela já está aguardando", "Fábio já está aguardando").patch.override_reason).toBe("ela já está aguardando");
  });
  it("rejects removed negation, invented predicates and different subjects instead of fuzzy matching", () => {
    for (const reason of ["Fábio está com pressa", "Fábio pediu encaixe", "João já está aguardando"])
      expect(() => extract("ele já está aguardando", reason)).toThrow("OVERRIDE_REASON_NOT_GROUNDED");
    expect(() => extract("ele NÃO está aguardando", "Fábio está aguardando")).toThrow("OVERRIDE_REASON_NOT_GROUNDED");
  });
  it("rejects invented reasons when no original causal span exists", () => {
    expect(() => groundOriginalSchedulingException({ customer_name: "Fábio Santos", override_reason: "Fábio já está aguardando" }, {}, "Pode encaixar."))
      .toThrow("OVERRIDE_REASON_NOT_GROUNDED");
    const absent: Record<string, unknown> = { override_requested: true };
    groundOriginalSchedulingException(absent, {}, "Pode encaixar.");
    expect(absent).not.toHaveProperty("override_reason"); // Existing domain asks for the mandatory reason.
  });
  it("does not convert an unrelated because-clause or multiple clauses into an override reason", () => {
    for (const message of ["Cancela porque ele já está aguardando. Pode encaixar.",
      prefix + "ele já está aguardando porque está atrasado.", prefix + "ele já está aguardando. Cancela outra pessoa.",
      prefix + "ele já está aguardando e cancela Amanda."])
      expect(() => groundOriginalSchedulingException({ customer_name: "Fábio Santos", override_reason: "Fábio já está aguardando" }, {}, message))
        .toThrow("OVERRIDE_REASON_NOT_GROUNDED");
  });
  it("does not weaken interpreter schema, operational values, EXACT or evaluator semantics", () => {
    const { patch } = extract("ele já está aguardando", "Fábio já está aguardando");
    expect(() => schedulingPatch.parse(patch)).toThrow(); // Provenance is backend-only.
    expect(equivalentReason("ele já está aguardando", "Fábio já está aguardando")).toBe(false);
    expect(equivalentField("time", "10:00", "11:00")).toBe(false);
    expect(equivalentField("EXACT", "Seu horário foi cancelado.", "seu horário foi cancelado.")).toBe(false);
  });
  it("repairs only the reason in the recorded x94 extraction, without changing the frozen evidence", () => {
    const row = JSON.parse(readFileSync("packages/salon-secretary/evaluation/results/topic14-final/real-result-1790311762668.json", "utf8")).rows[0];
    const fields = structuredClone(row.plan.actions.find((a: { operation: string }) => a.operation === "appointment.create").fields);
    const before = structuredClone(fields);
    groundOriginalSchedulingException(fields, {}, row.user);
    const { override_reason, override_reason_source, ...rest } = fields;
    const { override_reason: discarded, ...expected } = before;
    expect(discarded).toBe("Fábio já está aguardando");
    expect(override_reason).toBe("ele já está aguardando");
    expect(override_reason_source.original_text).toBe(override_reason);
    expect(rest).toEqual(expected);
  });
});
