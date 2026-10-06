import { describe, it, expect } from "vitest";
import { benchmarkCases, benchmarkFixture, benchmarkTurnCount } from "../../../packages/salon-secretary/evaluation/multi-action-benchmark-cases";
import { BenchmarkBudget, selectionDiagnostic } from "../../../packages/salon-secretary/evaluation/multi-action-benchmark-wire";
import { createActionPlan, validateSelectionV2, secretaryOutputLimit } from "@everflair/salon-secretary";
import { validateFixture } from "../../../packages/salon-secretary/evaluation/hard-conversations-fixtures";
import { DurableJournal, resumeCursor, checkpoint } from "../../../packages/salon-secretary/evaluation/hard-conversations-durable";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { estimatedCost } from "../../../packages/salon-secretary/evaluation/multi-action-benchmark-real";
import { modelCallUsage } from "@everflair/salon-secretary";

describe("Multi-Action benchmark preflight, no provider or database", () => {
  it("does not convert unknown cache writes to zero or double-count reasoning", () => {
    expect(estimatedCost(null)).toBeNull();
    const usage = { ...modelCallUsage("gpt-6-luna", "SUCCEEDED"), input_tokens: 1000,
      cached_input_tokens: 100, output_tokens: 200, reasoning_tokens: 50, total_tokens: 1200 };
    const unknown = estimatedCost(usage)!;
    expect(unknown.cache_write_unknown).toBe(true);
    expect(unknown.low).toBeCloseTo(.000191, 10);
    expect(unknown.high).toBeCloseTo(.0002135, 10);
    const known = estimatedCost({ ...usage, cache_write_tokens: 0 })!;
    expect(known.low).toEqual(known.high);
  });
  it("freezes ten distinct cases/fifteen turns and unpaired primary samples", () => {
    expect(benchmarkCases).toHaveLength(10); expect(benchmarkTurnCount).toBe(15);
    expect(new Set(benchmarkCases.map(c => c.id)).size).toBe(10);
    expect(benchmarkCases.filter(c => c.primary).map(c => c.actions)).toEqual([1, 2, 5, 10]);
    for (const c of benchmarkCases) {
      expect(validateSelectionV2(c.expected).operations).toHaveLength(c.actions);
      expect(c.messages.every(message => message.length <= 1000)).toBe(true);
      expect(c.messages.length).toBe(c.outputs.length + 1);
      for (const phase of ["a", "b"] as const) {
        const f = benchmarkFixture(c, phase);
        expect(validateFixture(f)).toEqual([]);
        expect(f.services.find(s => s.name === "Corte Completo")!.durationMin).toBe(45);
        expect(f.customers.filter(customer => customer.name === "Andrinho")).toHaveLength(1);
        for (const a of f.appointments) for (const b of f.appointments)
          if (a.id !== b.id && a.professionalId === b.professionalId)
            expect(Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(a.endAt) > Date.parse(b.startAt)).toBe(false);
      }
      expect(benchmarkFixture(c, "a").tenant).not.toBe(benchmarkFixture(c, "b").tenant);
    }
  });
  it("ten incomplete actions keep the graph and two explicit gaps", () => {
    const c = benchmarkCases.find(c => c.id === "x49")!, p = createActionPlan(c.expected);
    expect(p.actions).toHaveLength(10); expect(p.dependencies).toHaveLength(2);
    expect(c.missing).toEqual({ b: ["service_name"], h: ["end_time"] });
    expect(c.messages[1]).toBe("Corte Completo para o Fábio e bloqueia até 16h.");
  });
  it("keeps exact schema issue paths without retaining rejected arguments", () => {
    const result = selectionDiagnostic({ ...benchmarkCases[0].expected, made_up: "sensitive-not-to-log" });
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sensitive-not-to-log");
    expect(result.issues.length).toBeGreaterThan(0);
  });
  it("resource budget rejects overflow/retries and V1 keeps 1200", () => {
    const b = new BenchmarkBudget(1, .013, .013);
    b.reserve(20000, 8192); expect(() => b.reserve(20000, 8192)).toThrow("BUDGET");
    expect(() => new BenchmarkBudget().reserve(64001, 8192)).toThrow("BUDGET");
    expect(secretaryOutputLimit(false)).toBe(1200);
  });
  it("crash-safe journal marks partial case inconclusive and refuses automatic replay", () => {
    const dir = mkdtempSync(join(tmpdir(), "benchmark-journal-test-")), file = join(dir, "run.jsonl");
    const scope = { ids: ["x40"], maxRequests: 1, allowNetworkInconclusive: false, turnCounts: { x40: 1 } };
    try {
      const j = new DurableJournal(file, "binding", [], scope);
      j.append("STARTED", "x40", null); j.append("TURN_STARTED", "x40", 1); j.append("BEFORE_NETWORK", "x40", 1); j.close();
      const reopened = new DurableJournal(file, "binding", [], scope);
      expect(checkpoint(reopened.rows, "x40")).toBe("INCONCLUSIVE");
      expect(() => resumeCursor(reopened.rows, scope.ids)).toThrow("INCONCLUSIVE_REQUIRES_AUTHORIZATION");
      expect(() => reopened.append("BEFORE_NETWORK", "x40", 1)).toThrow(); reopened.close();
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir()) + "/") && !resolve(dir).startsWith(resolve(tmpdir()) + "\\")) throw Error("UNSAFE_TEST_CLEANUP");
      rmSync(dir, { recursive: true });
    }
  });
});
