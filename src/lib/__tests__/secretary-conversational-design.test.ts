import { describe, expect, it , vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveCandidates, confirmApproximation, clarificationFrontier, reviseDraft, switchIntent, reviewGraph, previewIsCurrent, measuredRate,
  type CandidateSnapshot, type OfflineDraft, type FieldEvidence, type OfflineItem } from "../../../packages/salon-secretary/evaluation/conversational-resolution";
import { hardConversations, conversationFixtures } from "../../../packages/salon-secretary/evaluation/hard-conversations";
import { publishedOperation } from "../../../packages/salon-secretary/src/skill-registry";
import { secretaryFastPath } from "../secretary-fast-path";
import { schedulingRequirements } from "../scheduling-contract";
import { findVisitPlan, type VisitDay } from "../visit-scheduling";

const scope = { tenant: "tenant-a", actor: "owner-a", conversation: "conversation-a", revision: 1 };
const snapshot = (match: "EXACT" | "APPROXIMATE" = "APPROXIMATE"): CandidateSnapshot => ({
  scope: { ...scope }, expiresAt: 100, complete: true, candidates: [{ ref: "service-a", label: "Corte Completo", match }],
});
const field = (value: string | number, dependsOn: string[] = []): FieldEvidence => ({ value, dependsOn,
  source: dependsOn.length ? "BACKEND_DETERMINISTIC" : "USER_EXPLICIT", informedByUser: !dependsOn.length, confirmed: true });
const draft = (): OfflineDraft => ({ scope: { ...scope }, itemKey: "a1", operation: "appointment.create", status: "ACTIVE",
  fields: { service_name: field("Corte Completo"), service_ref: field("s1", ["service_name"]), durationMin: field(45, ["service_ref"]),
    professional_ref: field("p1", ["service_ref"]), time: field("15:00"), availability: field("valid", ["time", "durationMin", "professional_ref"]),
    customer_name: field("Alisson") }, preview: { revision: 1, fingerprint: "preview-1" }, pendingQuestion: "q1", history: [] });

describe("Gate 4.0A entity evidence, not fuzzy authority", () => {
  it("unique contains result requires confirmation; exact unique can resolve", () => {
    expect(resolveCandidates(scope, snapshot(), 1)).toMatchObject({ level: "APPROXIMATE_SINGLE_CANDIDATE", reason: "ASK_CONFIRMATION" });
    expect(resolveCandidates(scope, snapshot(), 1)).not.toHaveProperty("resolvedRef");
    expect(resolveCandidates(scope, snapshot("EXACT"), 1)).toMatchObject({ level: "EXACT", resolvedRef: "service-a" });
  });
  it("multiple exact names do not choose first; approximate alternatives do not defeat a unique exact", () => {
    const s = snapshot("EXACT"); s.candidates.push({ ref: "service-b", label: "Corte Completo", match: "EXACT" });
    expect(resolveCandidates(scope, s, 1).level).toBe("AMBIGUOUS");
    s.candidates[1].match = "APPROXIMATE";
    expect(resolveCandidates(scope, s, 1).resolvedRef).toBe("service-a");
  });
  it("not found is not a fabricated entity and truncated results never prove unique", () => {
    expect(resolveCandidates(scope, { ...snapshot(), candidates: [] }, 1)).toMatchObject({ reason: "NOT_FOUND" });
    expect(resolveCandidates(scope, { ...snapshot("EXACT"), complete: false }, 1)).toMatchObject({ reason: "REFINE_TRUNCATED_SEARCH" });
  });
  it.each(["tenant", "actor", "conversation", "revision"] as const)("rejects foreign/stale %s before showing candidates", key => {
    const s = snapshot(); s.scope = { ...scope, [key]: key === "revision" ? 2 : "foreign" };
    expect(resolveCandidates(scope, s, 1)).toEqual({ level: "DOMAIN_CONFLICT", reason: "STALE_OR_FOREIGN_SNAPSHOT" });
  });
  it.each([100, 101, NaN, Infinity])("rejects expired/non-finite time %s", now => {
    expect(resolveCandidates(scope, snapshot(), now).level).toBe("DOMAIN_CONFLICT");
  });
  it("rejects duplicate refs and unknown match kinds", () => {
    const s = snapshot(); s.candidates.push(s.candidates[0]);
    expect(resolveCandidates(scope, s, 1).reason).toBe("INVALID_CANDIDATE_SNAPSHOT");
    s.candidates = [{ ...s.candidates[0], match: "MODEL_CONFIDENT" as "EXACT" }];
    expect(resolveCandidates(scope, s, 1).reason).toBe("INVALID_CANDIDATE_SNAPSHOT");
  });
  it("sim can confirm only the scoped approximation, never business execution", () => {
    const answer = { questionId: "q1", currentQuestionId: "q1", selectedRef: "service-a", sourceField: "service_name" };
    expect(confirmApproximation(scope, snapshot(), 1, answer)).toMatchObject({ source: "USER_CONFIRMED_APPROXIMATION", value: "service-a", confirmed: true });
    expect(() => confirmApproximation(scope, snapshot(), 1, { ...answer, currentQuestionId: "q2" })).toThrow("CONTEXT");
    expect(() => confirmApproximation(scope, snapshot(), 1, { ...answer, selectedRef: "foreign" })).toThrow("CONTEXT");
    expect(() => confirmApproximation(scope, snapshot(), 100, answer)).toThrow("CONTEXT");
    const d = draft(); d.fields.service_ref = confirmApproximation(scope, snapshot(), 1, answer);
    expect(reviseDraft(d, scope, { service_name: field("Corte + Barba") }, "USER_CORRECTION").fields.service_ref).toBeUndefined();
  });
});

describe("minimal actionable clarification", () => {
  const fields = () => [
    { key: "customer", status: "RESOLVED" as const, dependsOn: [] },
    { key: "date", status: "RESOLVED" as const, dependsOn: [] },
    { key: "service", status: "ASK" as const, dependsOn: [] },
    { key: "time", status: "ASK" as const, dependsOn: [] },
    { key: "duration", status: "BACKEND_PENDING" as const, dependsOn: ["service"] },
    { key: "professional", status: "BACKEND_PENDING" as const, dependsOn: ["service"] },
    { key: "availability", status: "BACKEND_PENDING" as const, dependsOn: ["date", "time", "duration", "professional"] },
  ];
  it("Alisson tomorrow asks service/time, not professional/duration", () => {
    expect(clarificationFrontier(fields())).toEqual({ ask: ["service", "time"], resolveFirst: [], blocked: [] });
    expect(schedulingRequirements("appointment.create").required_fields).toContain("professional_ref");
  });
  it("10h without service does not make availability actionable", () => {
    const f = fields().filter(f => f.key !== "time"); f.push({ key: "time", status: "RESOLVED", dependsOn: [] });
    expect(clarificationFrontier(f)).toEqual({ ask: ["service"], resolveFirst: [], blocked: [] });
  });
  it("service unlocks backend duration/professional before asking for a professional", () => {
    const f = fields().filter(f => f.key !== "service"); f.push({ key: "service", status: "RESOLVED", dependsOn: [] });
    expect(clarificationFrontier(f)).toMatchObject({ ask: ["time"], resolveFirst: ["duration", "professional"] });
  });
  it("cycles, unknown dependencies and duplicate fields fail closed", () => {
    expect(() => clarificationFrontier([{ key: "a", status: "ASK", dependsOn: ["a"] }])).toThrow("CYCLE");
    expect(() => clarificationFrontier([{ key: "a", status: "ASK", dependsOn: ["b"] }])).toThrow("UNKNOWN");
    expect(() => clarificationFrontier([...fields(), fields()[0]])).toThrow("DUPLICATE");
  });
  it("short replies use only approved contextual fast paths", () => {
    expect(secretaryFastPath("time", "15h")).toEqual({ time: "15:00" });
    expect(secretaryFastPath("date", "amanhã")).toEqual({ day_offset: 1 });
    expect(secretaryFastPath("durationMin", "45 minutos")).toEqual({ durationMin: 45 });
    for (const message of ["sim", "não", "a outra Amanda", "Tatiana", "não, 16h"])
      expect(secretaryFastPath("time", message)).toBeUndefined();
    expect(secretaryFastPath(undefined, "15h")).toBeUndefined();
  });
});

describe("revisioned conversation prototypes, no confirmation/executor", () => {
  it("corrects 15h to 16h in same item and revokes preview and dependent availability", () => {
    const before = draft(), after = reviseDraft(before, scope, { time: field("16:00") }, "USER_CORRECTION");
    expect(after.itemKey).toBe(before.itemKey); expect(after.operation).toBe(before.operation);
    expect(after.scope.revision).toBe(2); expect(after.fields.time.value).toBe("16:00");
    expect(after.fields.customer_name.value).toBe("Alisson");
    expect(after.fields.availability).toBeUndefined(); expect(after.preview).toBeUndefined();
    expect(after.pendingQuestion).toBeUndefined(); expect(before.preview).toBeDefined();
    expect(before.fields.time.value).toBe("15:00");
    expect(after.history[0].changedFields).toEqual(["time", "availability"]);
  });
  it("service correction transitively invalidates refs, duration, professional, availability", () => {
    const after = reviseDraft(draft(), scope, { service_name: field("Corte + Barba") }, "USER_CORRECTION");
    expect(Object.keys(after.fields).sort()).toEqual(["customer_name", "service_name", "time"]);
    expect(() => reviseDraft(draft(), scope, { service_name: field("Corte + Barba"), durationMin: field(45, ["service_ref"]) }, "USER_CORRECTION")).toThrow("STALE_DERIVED_PATCH");
  });
  it("stale revisions and different actor/tenant cannot patch a draft", () => {
    expect(() => reviseDraft(draft(), { ...scope, revision: 0 }, { time: field("16:00") }, "USER_CORRECTION")).toThrow("CONTEXT");
    expect(() => reviseDraft(draft(), { ...scope, tenant: "b" }, { time: field("16:00") }, "USER_CORRECTION")).toThrow("CONTEXT");
  });
  it("old previews and unconfirmed approximation are never current", () => {
    const d = draft(); expect(previewIsCurrent(d, scope, "preview-1")).toBe(true);
    d.fields.service_ref.confirmed = false;
    expect(previewIsCurrent(d, scope, "preview-1")).toBe(false);
    d.fields.service_ref.confirmed = true;
    expect(previewIsCurrent(d, { ...scope, revision: 2 }, "preview-1")).toBe(false);
    expect(previewIsCurrent(d, scope, "different")).toBe(false);
  });
  it("explicit forget abandons, unrelated intent pauses, neither confirms", () => {
    const d = draft(), abandoned = switchIntent(d, scope, "EXPLICIT_ABANDON");
    expect(abandoned.status).toBe("ABANDONED"); expect(abandoned.preview).toBeUndefined();
    expect(() => reviseDraft(abandoned, abandoned.scope, { time: field("16:00") }, "USER_CORRECTION")).toThrow("CONTEXT");
    expect(switchIntent(d, scope, "PAUSE").status).toBe("PAUSED"); expect(d.status).toBe("ACTIVE");
  });
});

describe("dependency and partial-failure design", () => {
  const item = (itemKey: string, dependsOn: string[] = [], state: OfflineItem["state"] = "READY"): OfflineItem => ({ itemKey, dependsOn, state, independent: !dependsOn.length, operation: "appointment.cancel" });
  it("supports 3–5-node analytical graphs without authorizing operational dispatch", () => {
    const graph = [item("a"), item("b", ["a"]), item("c"), item("d"), item("e", ["b"])];
    expect(reviewGraph(graph).filter(i => i.blocked).map(i => i.itemKey)).toEqual(["b", "e"]);
    expect(reviewGraph(graph).every(i => !i.operationalExecutionAllowed)).toBe(true);
  });
  it("failure of A prevents dependent B; independent ready item is not silently executed", () => {
    expect(reviewGraph([item("a", [], "FAILED"), item("b", ["a"]), item("c")])).toEqual([
      { itemKey: "a", blocked: true, operationalExecutionAllowed: false },
      { itemKey: "b", blocked: true, operationalExecutionAllowed: false },
      { itemKey: "c", blocked: false, operationalExecutionAllowed: false },
    ]);
  });
  it("only succeeded dependency unblocks downstream review, not execution", () => {
    expect(reviewGraph([item("a", [], "SUCCEEDED"), item("b", ["a"])])[1]).toMatchObject({ blocked: false, operationalExecutionAllowed: false });
  });
  it("rejects cycles, foreign edge, duplicates, contradictory independence and >5", () => {
    expect(() => reviewGraph([item("a", ["b"]), item("b", ["a"])])).toThrow("CYCLE");
    expect(() => reviewGraph([item("a", ["foreign"])])).toThrow("UNKNOWN");
    expect(() => reviewGraph([item("a"), item("a")])).toThrow("DUPLICATE");
    expect(() => reviewGraph([{ ...item("a", ["b"]), independent: true }, item("b")])).toThrow("DECLARATION");
    expect(() => reviewGraph(Array.from({ length: 6 }, (_, i) => item(String(i))))).toThrow("LIMIT");
  });
});

describe("real availability engine with in-memory day only", () => {
  function day(): VisitDay {
    const services = [{ id: "cut", name: "Corte Completo", durationMin: 45, priceCents: 5000,
      priceType: "FIXED", priceNote: null, physicalResourceId: null,
      professionals: [{ professional: { id: "tatiana", user: { name: "Tatiana" } } }] }];
    return { salon: { timezone: "America/Sao_Paulo", minBookingLeadMinutes: 0, maxBookingLeadDays: 60, bufferMinutes: 0 },
      services, priced: services, hours: new Map([["tatiana", [{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 780, endMinutes: 1080 }]]]),
      closures: [], blocks: [], appointments: [], resourceBookings: [], offers: [],
      preferences: { slotMode: "FIT", returnDays: 30, serviceReturnDays: {}, addons: {}, simultaneousPairs: [] },
      date: "2026-10-06", now: new Date(conversationFixtures.baseTime) } as VisitDay;
  }
  it("10:00 start is not availability when 45 minutes overlap 10:30", () => {
    const fixture = day(), choices = [{ serviceId: "cut", professionalId: "tatiana" }];
    expect(findVisitPlan(fixture, choices, 600)).not.toBeNull();
    fixture.appointments.push({ professionalId: "tatiana", startAt: new Date("2026-10-06T13:30:00Z"), endAt: new Date("2026-10-06T14:00:00Z") });
    expect(findVisitPlan(fixture, choices, 600)).toBeNull();
    expect(findVisitPlan(fixture, choices, 660)).not.toBeNull();
    expect(fixture.appointments).toHaveLength(1); // no mutation/overwrite of occupied slot
  });
  it("unique eligible professional does not waive interval, breaks or closing", () => {
    const fixture = day(), choices = [{ serviceId: "cut" }];
    expect(findVisitPlan(fixture, choices, 900)?.items[0].professionalName).toBe("Tatiana");
    expect(findVisitPlan(fixture, choices, 705)).toBeNull(); // overlaps lunch
    expect(findVisitPlan(fixture, choices, 1050)).toBeNull(); // 17:30 + 45 > 18:00
  });
});

describe("frozen design dataset and isolation", () => {
  it("60 cases with requested distribution and no operational confirmations", () => {
    expect(hardConversations).toHaveLength(60);
    expect(new Set(hardConversations.map(c => c.case_id)).size).toBe(60);
    expect(Object.fromEntries(["INCOMPLETE", "AMBIGUITY", "CONFLICT", "CONTINUATION", "MULTI_ACTION", "ADVERSARIAL"].map(k => [k, hardConversations.filter(c => c.category === k).length])))
      .toEqual({ INCOMPLETE: 15, AMBIGUITY: 10, CONFLICT: 10, CONTINUATION: 10, MULTI_ACTION: 10, ADVERSARIAL: 5 });
  });
  it.each(hardConversations)("$case_id: valid published operations, fixtures, turn checkpoints and graph", c => {
    expect(conversationFixtures.variants[c.fixture]).toBeTruthy();
    expect(c.expected.confirmation_allowed).toBe(false); expect(c.expected.operational_effects).toBe(0);
    expect(c.expected.invented_fields).toBe(0); expect(c.expected.wrong_entity_auto_selected).toBe(0);
    for (const t of c.turns) { expect(t.message.length).toBeGreaterThan(0); expect(t.expected_checkpoint.length).toBeGreaterThan(10); }
    for (const a of c.expected.actions) { expect(publishedOperation.safeParse(a.operation).success).toBe(true); expect(Object.keys(a.fields).some(k => k.endsWith("_ref"))).toBe(false); }
    if (c.expected.actions.length) expect(() => reviewGraph(c.expected.actions.map(a => ({ itemKey: a.item_key, operation: a.operation, dependsOn: a.dependsOn ?? [], independent: a.independent, state: "NEEDS_INPUT" })))).not.toThrow();
  });
  it("no missing denominator is represented as perfect accuracy", () => {
    expect(measuredRate({ expectedOpportunities: 0, successes: 0, failures: 0 })).toBeNull();
    expect(measuredRate({ expectedOpportunities: 4, successes: 3, failures: 1 })).toBe(.75);
    expect(() => measuredRate({ expectedOpportunities: 2, successes: 2, failures: 1 })).toThrow();
  });
  it("manifest and all protected predecessors remain byte-identical", () => {
    const manifest = JSON.parse(readFileSync("packages/salon-secretary/evaluation/hard-conversations-plan.json", "utf8"));
    const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    for (const [p, hash] of Object.entries(manifest.frozen_files)) expect(sha(p), p).toBe(hash);
    for (const [p, hash] of Object.entries(manifest.predecessors)) expect(sha(p), p).toBe(hash);
    expect(manifest.cases).toEqual(JSON.parse(JSON.stringify(hardConversations)));
    expect(manifest.fixtures).toEqual(JSON.parse(JSON.stringify(conversationFixtures)));
    expect(manifest.max_luna_inferences).toBe(hardConversations.reduce((n, c) => n + c.turns.length, 0));
  });
  it("runtime does not import the conversational evaluation prototypes", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === "__tests__" ? [] : walk(path.join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
    for (const p of [...walk("src/lib"), ...walk("src/app"), ...walk("packages/salon-secretary/src")]) {
      expect(readFileSync(p, "utf8"), p).not.toMatch(/(?:from|import\()\s*["'][^"']*(?:conversational-resolution|hard-conversations)/);
    }
  }, 30_000); // Full source-tree filesystem scan on Windows, no network.
});

// Historical harnesses verify V1 archived bytes; current V2 has separate runtime tests.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
