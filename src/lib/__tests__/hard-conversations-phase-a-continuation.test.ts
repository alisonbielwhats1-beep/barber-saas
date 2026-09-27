import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AuditLog, Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { PhaseAWireWitness } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-witness";
import { assertApprovedI01Audit, assertContinuationCaseScope, assertContinuationTotalAuditCount,
  assertOperationalBaseline, buildContinuationPlan, CONTINUATION_CASE_IDS, CONTINUATION_SCOPE,
  CONTINUATION_TURNS, type ContinuationBaseline } from
  "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-continuation";
import type { OperationalSnapshot } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-db";
import type { buildPhaseAPlan } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a";
import { executePhaseA } from "../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-execution";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const wire = () => JSON.stringify({ model: "gpt-6-luna", instructions: "synthetic", input: [{ role: "user", content: "synthetic" }],
  tools: [{ type: "function", name: "select_capabilities", parameters: {} }],
  tool_choice: { type: "function", name: "select_capabilities" }, parallel_tool_calls: false,
  max_output_tokens: 1200, store: false, stream: false, include: [] });

function syntheticHistory() {
  const tenant = "synthetic-i01-tenant", actor = "synthetic-owner", conversation = "synthetic-conversation";
  const draft = "synthetic-draft";
  const actions = ["MODEL_CALL_STARTED", "MODEL_CALL_FINISHED", "SKILLS_LOADED", "DRAFT",
    "SCHEDULING_TIMINGS", "OPERATIONS_PREPARED", "DIRECT_LUNA"];
  const entityTypes = ["SALON_SECRETARY_USAGE", "SALON_SECRETARY_USAGE", "SECRETARY_SKILL_LOAD",
    "SECRETARY_SCHEDULING", "SECRETARY_LATENCY", "SECRETARY_OPERATION_PLAN", "SECRETARY_ROUTER"];
  const metadata: Prisma.JsonObject[] = [
    { session_id: conversation, status: "STARTED" },
    { session_id: conversation, status: "SUCCEEDED", model_id_requested: "gpt-6-luna",
      model_id_returned: "gpt-6-luna", request_id: "req_synthetic", response_id: "resp_synthetic" },
    { session_id: conversation }, { draft_ref: draft, operation: "appointment.create" },
    { session_id: "internal-scheduling-id", operation: "appointment.create" },
    { session_id: conversation, operations: [{ operation: "appointment.create" }] },
    { router_path: "DIRECT_LUNA", jev_http_calls: 0, retries: 0 },
  ];
  const rows = actions.map((action, index): AuditLog => ({
    id: `synthetic-log-${index}`, salonId: tenant, userId: actor, actorName: "Synthetic Owner",
    action, entityType: entityTypes[index], entityId: "synthetic-entity", reason: null,
    metadata: metadata[index], createdAt: new Date(Date.UTC(2026, 8, 24, 6, 1, index)),
  }));
  const report = { records: [{ capture: { conversation_ref: conversation,
    operations: [{ draft_ref: draft }] } }] } as unknown as Parameters<typeof assertApprovedI01Audit>[2];
  const baseline = { historical_technical_logs: 7, total_audit_logs: 7,
    i01_audit: { tenant_sha256: sha(tenant), conversation_sha256: sha(conversation), draft_sha256: sha(draft),
      rows: rows.map(row => ({ row_sha256: sha(JSON.stringify(row)), action: row.action,
        entity_type: row.entityType, created_at: row.createdAt.toISOString(),
        status: (row.metadata as Record<string, unknown>).status as string ?? null })) } } as ContinuationBaseline;
  return { rows, baseline, report, tenant, actor };
}

const operational = (): OperationalSnapshot => ({ hashes: { services: "approved-services", customers: "approved-customers",
  appointments: "approved-appointments", products: "approved-products", outbox: "approved-outbox" },
  counts: { services: 1, customers: 1, appointments: 0, products: 1, outbox: 0, appointment_events: 0 },
  technical_audits: 7, technical_audit_hash: "approved-seven-logs",
  technical_by_kind: { drafts: 1, proposals: 0, usage: 2, router: 1, other: 3 }, confirmations: 0 });

describe("Phase A continuation frozen scope", () => {
  it("requires an explicit process approval before even entering the database preflight", async () => {
    const previous = process.env.PHASE_A_CONTINUATION_I02_I26_APPROVED;
    delete process.env.PHASE_A_CONTINUATION_I02_I26_APPROVED;
    try {
      await expect(executePhaseA({} as PrismaClient, {} as PrismaClient, CONTINUATION_SCOPE))
        .rejects.toThrow("CONTINUATION_NOT_APPROVED");
    } finally {
      if (previous === undefined) delete process.env.PHASE_A_CONTINUATION_I02_I26_APPROVED;
      else process.env.PHASE_A_CONTINUATION_I02_I26_APPROVED = previous;
    }
  });
  it("copies exactly 25 cases and 27 turns, with i01 excluded and unchanged messages/expected", () => {
    const source = JSON.parse(readFileSync("packages/salon-secretary/evaluation/hard-conversations-phase-a.json", "utf8")) as
      ReturnType<typeof buildPhaseAPlan>;
    const frozen = JSON.parse(readFileSync("packages/salon-secretary/evaluation/hard-conversations-phase-a-continuation.json", "utf8"));
    expect(frozen).toEqual(buildContinuationPlan(source));
    expect(frozen.cases.map((row: { case_id: string }) => row.case_id)).toEqual(CONTINUATION_CASE_IDS);
    expect(frozen.cases.reduce((n: number, row: { turns: unknown[] }) => n + row.turns.length, 0)).toBe(CONTINUATION_TURNS);
    expect(frozen.max_luna_inferences).toBe(27);
    expect(frozen.max_usd).toBe(.2322);
  });

  it("blocks i01 in the continuation manifest and at the wire before network", () => {
    const cases = CONTINUATION_CASE_IDS.map(case_id => ({ case_id, turns: [{ message: "synthetic" }] }));
    cases[0].turns.push({ message: "synthetic" }, { message: "synthetic" });
    expect(() => assertContinuationCaseScope(cases)).not.toThrow();
    expect(() => assertContinuationCaseScope([{ case_id: "i01", turns: [{ message: "synthetic" }] },
      ...cases.slice(1)])).toThrow("CONTINUATION_SCOPE_DRIFT");
    const witness = new PhaseAWireWitness(CONTINUATION_SCOPE);
    witness.expectTurn("i01", 1, "select_capabilities", []);
    expect(() => witness.beforeNetwork({ url: "https://api.openai.com/v1/responses", method: "POST",
      body: wire() })).toThrow("WIRE_CONTINUATION_I01_FORBIDDEN");
    expect(witness.budget.calls).toBe(0);
  });

  it("caps the continuation witness at 27 requests and US$0.2322", () => {
    const witness = new PhaseAWireWitness(CONTINUATION_SCOPE);
    for (let index = 1; index <= 27; index++) {
      witness.expectTurn("i02", index, "select_capabilities", []);
      witness.beforeNetwork({ url: "https://api.openai.com/v1/responses", method: "POST", body: wire() });
      witness.clearTurn();
    }
    witness.expectTurn("i02", 28, "select_capabilities", []);
    expect(() => witness.beforeNetwork({ url: "https://api.openai.com/v1/responses", method: "POST",
      body: wire() })).toThrow("BUDGET_EXCEEDED");
    expect(witness.budget.calls).toBe(27);
    expect(witness.budget.reservedUsd).toBe(.2322);
  });
});

describe("Phase A continuation historical evidence", () => {
  it("accepts exactly the seven approved synthetic i01 logs", () => {
    const h = syntheticHistory();
    expect(() => assertContinuationTotalAuditCount(7)).not.toThrow();
    expect(() => assertApprovedI01Audit(h.rows, h.baseline, h.report, h.tenant, h.actor)).not.toThrow();
  });
  it("rejects an eighth unknown log, even outside the i01 tenant", () => {
    expect(() => assertContinuationTotalAuditCount(8)).toThrow("CONTINUATION_EXTRA_AUDIT");
    const h = syntheticHistory();
    expect(() => assertApprovedI01Audit([...h.rows, { ...h.rows[0], id: "unknown" }], h.baseline,
      h.report, h.tenant, h.actor)).toThrow("CONTINUATION_I01_AUDIT");
  });
  it("rejects any changed historical row, action, status or correlation", () => {
    const h = syntheticHistory();
    const changed = [...h.rows]; changed[1] = { ...changed[1], metadata: { ...changed[1].metadata as object,
      status: "FAILED" } };
    expect(() => assertApprovedI01Audit(changed, h.baseline, h.report, h.tenant, h.actor))
      .toThrow("CONTINUATION_I01_AUDIT");
    const wrongTenant = [...h.rows]; wrongTenant[3] = { ...wrongTenant[3], salonId: "other-tenant" };
    expect(() => assertApprovedI01Audit(wrongTenant, h.baseline, h.report, h.tenant, h.actor))
      .toThrow("CONTINUATION_I01_AUDIT");
  });

  it("rejects changed operational baseline, unexpected Outbox and historical confirmation", () => {
    const approved = operational(), expected = { case_id: "i01", ...approved };
    expect(() => assertOperationalBaseline("i01", approved, expected)).not.toThrow();
    expect(() => assertOperationalBaseline("i01", { ...approved,
      hashes: { ...approved.hashes, services: "changed" } }, expected))
      .toThrow("CONTINUATION_OPERATIONAL_BASELINE");
    expect(() => assertOperationalBaseline("i01", { ...approved,
      counts: { ...approved.counts, outbox: 1 } }, expected))
      .toThrow("CONTINUATION_OPERATIONAL_BASELINE");
    expect(() => assertOperationalBaseline("i01", { ...approved, confirmations: 1 }, expected))
      .toThrow("CONTINUATION_OPERATIONAL_BASELINE");
  });
});
