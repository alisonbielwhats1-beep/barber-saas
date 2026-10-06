import { describe, expect, it } from "vitest";
import { applyAnswer, applyIntent, approve, attachProposal, createPilotPlan, invalidate, withdraw, PILOT_FIELDS, PILOT_PROVENANCES, PILOT_STATUSES,
  type PilotField, type PilotPatch, type PilotPlan, type PilotProposal, type PilotProvenance, type PilotReduction } from "../secretary-pilot-plan";

/** Reschedule pilot, E1 unit tests written before the code (docs/c5-spike/12-piloto-remarcacao.md §4, §7 "Unidade"): the plan of the ONE action
 * and its pure reducer. An answer fills only its question's field; an independent correction is its own patch; a question already closed or of
 * another revision changes nothing; a change is accepted only on the current revision (compare-and-swap); every accepted change moves the
 * revision by one and drops the proposal and the approval; "desistir" withdraws, and with a correction in the same message the corrected draft
 * stands and the old value is never kept; every field always has its provenance. Synthetic refs only; no network, database or model. */
const resolved = (value: string, provenance: Exclude<PilotProvenance, "unresolved"> = "explicit", display = value): PilotField => ({ value, display, provenance });
const UNRESOLVED: PilotField = { value: null, display: null, provenance: "unresolved" };
const FIELDS = { customer: resolved("cli-odete", "explicit", "Odete Vasconcelos"), appointment: resolved("apt-odete", "derived", "qua, 12/03 às 10h"),
  date: resolved("2031-03-14", "explicit", "sex, 14/03"), time: resolved("15:00", "explicit", "15h"), professional: resolved("pro-carlos", "inherited", "Carlos Imbiriba"),
  service: resolved("srv-limpeza", "inherited", "Limpeza de pele") };
const proposal = (revision: number): PilotProposal => ({ proposalRef: `prop-${revision}`, draftRef: "draft-1", draftRevision: revision, revision, text: "Proposta sintética." });
/** Revision 4 with a ready proposal (and, `approved`, the owner's approval of it); q1 was answered at revision 2. */
function ready(approved = false): PilotPlan {
  return { planId: "plan-sintetico", revision: 4, turns: [], action: { actionId: "a1", status: approved ? "approved" : "proposal_ready", fields: structuredClone(FIELDS),
    questions: [{ questionId: "q1", actionId: "a1", field: "customer", reason: "CUSTOMER_AMBIGUOUS", revision: 2, open: false }],
    proposal: proposal(4), ...(approved ? { approval: { proposalRef: "prop-4", draftRevision: 4, revision: 4 } } : {}) } };
}
/** Revision 3 asking the clock: q2 open (asked at revision 3, two readings), q1 closed. */
function asking(): PilotPlan {
  return { planId: "plan-sintetico", revision: 3, turns: [], action: { actionId: "a1", status: "pending", fields: { ...structuredClone(FIELDS), time: UNRESOLVED },
    questions: [{ questionId: "q1", actionId: "a1", field: "customer", reason: "CUSTOMER_AMBIGUOUS", revision: 2, open: false },
      { questionId: "q2", actionId: "a1", field: "time", reason: "TIME_TWO_READINGS", options: [{ id: "08:00", label: "8h" }, { id: "20:00", label: "20h" }], revision: 3, open: true }] } };
}
const accepted = (result: PilotReduction) => { expect(result).toMatchObject({ ok: true }); if (!result.ok) throw Error(result.code); return result; };
const rejected = (result: PilotReduction, code: string, before: PilotPlan) => { expect(result).toMatchObject({ ok: false, code }); expect(result.plan).toEqual(before); };
const openOf = (plan: PilotPlan) => plan.action.questions.filter(question => question.open);

describe("§4 plan: creation and compare-and-swap", () => {
  it("a new plan: revision 0, draft, the six fields unresolved with their provenance, nothing asked or proposed", () => {
    expect(createPilotPlan("plan-novo")).toEqual({ planId: "plan-novo", revision: 0, turns: [],
      action: { actionId: "a1", status: "draft", questions: [], fields: Object.fromEntries(PILOT_FIELDS.map(name => [name, UNRESOLVED])) } });
  });
  it("CAS: a change, an answer, a withdrawal or an approval on another revision is rejected and the plan comes back exactly as it was", () => {
    for (const base of [3, 5]) {
      const plan = ready(), before = structuredClone(plan);
      rejected(applyIntent(plan, { fields: { time: resolved("16:00") } }, base), "STALE_REVISION", before);
      rejected(withdraw(plan, base), "STALE_REVISION", before);
      rejected(withdraw(plan, base, { fields: { time: resolved("16:00") } }), "STALE_REVISION", before);
      rejected(approve(plan, { proposalRef: "prop-4", draftRevision: 4, revision: base }), "STALE_REVISION", before);
      expect(plan).toEqual(before);
    }
    const open = asking(), before = structuredClone(open);
    rejected(applyAnswer(open, { questionId: "q2", value: resolved("08:00") }, 2), "STALE_REVISION", before);
    expect(open).toEqual(before);
  });
  it("every accepted change moves the revision by exactly one and drops the proposal and the approval", () => {
    const changes: [string, (plan: PilotPlan) => PilotReduction | PilotPlan][] = [
      ["correction", plan => applyIntent(plan, { fields: { time: resolved("16:00") } }, plan.revision)],
      ["withdrawal", plan => withdraw(plan, plan.revision)],
      ["withdrawal with a correction", plan => withdraw(plan, plan.revision, { fields: { time: resolved("17:00") } })],
      ["invalidation", plan => invalidate(plan, "SLOT_TAKEN")],
    ];
    for (const approved of [false, true]) for (const [label, change] of changes) {
      const out = change(ready(approved)), plan = "ok" in out ? accepted(out).plan : out;
      expect(plan.revision, label).toBe(5);
      expect(plan.action.proposal, label).toBeUndefined();
      expect(plan.action.approval, label).toBeUndefined();
      expect(["proposal_ready", "approved"], label).not.toContain(plan.action.status);
    }
    expect(accepted(applyAnswer(asking(), { questionId: "q2", value: resolved("08:00") }, 3)).plan.revision).toBe(4);
  });
  it("a closed action takes no change: withdrawn, executing or done", () => {
    for (const status of ["withdrawn", "executing", "done"] as const) {
      const plan: PilotPlan = { ...ready(true), action: { ...ready(true).action, status } }, before = structuredClone(plan);
      rejected(applyIntent(plan, { fields: { time: resolved("16:00") } }, 4), "PLAN_CLOSED", before);
      rejected(withdraw(plan, 4, { fields: { time: resolved("16:00") } }), "PLAN_CLOSED", before);
    }
  });
});

describe("§4 plan: answers belong to their question, corrections are their own patch", () => {
  it("an answer fills only its question's field, closes it and moves the revision", () => {
    const plan = asking(), before = structuredClone(plan);
    const out = accepted(applyAnswer(plan, { questionId: "q2", value: resolved("20:00", "explicit", "20h") }, 3));
    expect(out.changed).toEqual(["time"]);
    expect(out.plan.revision).toBe(4);
    expect(out.plan.action.fields).toEqual({ ...before.action.fields, time: resolved("20:00", "explicit", "20h") });
    expect(out.plan.action.questions.find(question => question.questionId === "q2")).toMatchObject({ open: false });
    expect(openOf(out.plan)).toEqual([]);
    expect(plan).toEqual(before);
  });
  it("a scope answer (before the possible part is proposed) closes its question and changes no field; a field answer without a value is empty", () => {
    const plan = asking();
    plan.action.fields.time = resolved("15:00");
    plan.action.questions[1] = { questionId: "q2", actionId: "a1", field: "scope", reason: "OUT_OF_SCOPE_PART", revision: 3, open: true };
    const out = accepted(applyAnswer(plan, { questionId: "q2" }, 3));
    expect(out.changed).toEqual([]);
    expect(out.plan.action.fields).toEqual(plan.action.fields);
    expect(out.plan.revision).toBe(4);
    const empty = asking();
    rejected(applyAnswer(empty, { questionId: "q2" }, 3), "ANSWER_EMPTY", structuredClone(empty));
  });
  it("a question already closed, asked at another revision or unknown changes nothing", () => {
    const plan = asking(), before = structuredClone(plan);
    rejected(applyAnswer(plan, { questionId: "q1", value: resolved("cli-outra") }, 3), "QUESTION_CLOSED", before);
    rejected(applyAnswer(plan, { questionId: "q9", value: resolved("08:00") }, 3), "QUESTION_UNKNOWN", before);
    const moved = structuredClone(plan);
    moved.revision = 5;
    rejected(applyAnswer(moved, { questionId: "q2", value: resolved("08:00") }, 5), "QUESTION_STALE", structuredClone(moved));
  });
  it("an independent correction in the same message is its own patch, on the revision the answer left", () => {
    const answer = accepted(applyAnswer(asking(), { questionId: "q2", value: resolved("20:00") }, 3));
    const correction = accepted(applyIntent(answer.plan, { fields: { professional: resolved("pro-dalva", "explicit", "Dalva Nascimento") } }, 4));
    expect(answer.changed).toEqual(["time"]);
    expect(correction.changed).toEqual(["professional"]);
    expect(correction.plan.revision).toBe(5);
    expect(correction.plan.action.fields).toEqual({ ...answer.plan.action.fields, professional: resolved("pro-dalva", "explicit", "Dalva Nascimento") });
    rejected(applyIntent(answer.plan, { fields: { professional: resolved("pro-dalva") } }, 3), "STALE_REVISION", structuredClone(answer.plan));
  });
  it("a change closes the questions that were open and opens its own at the new revision (pending), or none (draft)", () => {
    const plan = asking();
    const patch: PilotPatch = { fields: { professional: resolved("pro-dalva", "explicit", "Dalva Nascimento") },
      questions: [{ questionId: "q3", field: "time", reason: "TIME_TWO_READINGS", options: [{ id: "08:00", label: "8h" }, { id: "20:00", label: "20h" }] }] };
    const out = accepted(applyIntent(plan, patch, 3));
    expect(out.changed).toEqual(["professional"]);
    expect(out.plan.action.status).toBe("pending");
    expect(out.plan.action.questions.find(question => question.questionId === "q2")).toMatchObject({ open: false, revision: 3 });
    expect(openOf(out.plan)).toEqual([{ questionId: "q3", actionId: "a1", field: "time", reason: "TIME_TWO_READINGS",
      options: [{ id: "08:00", label: "8h" }, { id: "20:00", label: "20h" }], revision: 4, open: true }]);
    const quiet = accepted(applyIntent(ready(), { fields: { time: resolved("16:00") } }, 4));
    expect(quiet.plan.action.status).toBe("draft");
    expect(quiet.changed).toEqual(["time"]);
    expect(openOf(quiet.plan)).toEqual([]);
  });
});

describe("§4 plan: withdrawal, invalidation, proposal and approval", () => {
  it("desistir alone: withdrawn, nothing open or confirmable, and nothing more is accepted", () => {
    const out = accepted(withdraw(ready(true), 4));
    expect(out.plan.action.status).toBe("withdrawn");
    expect(out.plan.revision).toBe(5);
    expect(out.changed).toEqual([]);
    expect(out.plan.action.proposal).toBeUndefined();
    expect(out.plan.action.approval).toBeUndefined();
    rejected(applyIntent(out.plan, { fields: { time: resolved("16:00") } }, 5), "PLAN_CLOSED", structuredClone(out.plan));
    const fromQuestion = accepted(withdraw(asking(), 3)).plan;
    expect(openOf(fromQuestion)).toEqual([]);
    const late = applyAnswer(fromQuestion, { questionId: "q2", value: resolved("08:00") }, 4);
    expect(late.ok).toBe(false);
    expect(["PLAN_CLOSED", "QUESTION_CLOSED"]).toContain(late.ok ? "" : late.code);
    expect(late.plan).toEqual(fromQuestion);
  });
  it("desistir with a correction: the corrected draft stands (new revision) and the old value is kept nowhere", () => {
    const out = accepted(withdraw(ready(true), 4, { fields: { time: resolved("17:00", "explicit", "17h") } }));
    expect(out.plan.action.status).toBe("draft");
    expect(out.plan.revision).toBe(5);
    expect(out.changed).toEqual(["time"]);
    expect(out.plan.action.fields).toEqual({ ...FIELDS, time: resolved("17:00", "explicit", "17h") });
    expect(JSON.stringify(out.plan.action)).not.toContain("15:00");
    expect(out.plan.action.proposal).toBeUndefined();
    expect(out.plan.action.approval).toBeUndefined();
  });
  it("invalidate: the backend drops the proposal and the approval (needs_review, new revision); a settled action stays as it was", () => {
    const out = invalidate(ready(true), "SLOT_TAKEN");
    expect(out).toMatchObject({ revision: 5, action: { status: "needs_review", fields: FIELDS } });
    expect(out.action.proposal).toBeUndefined();
    expect(out.action.approval).toBeUndefined();
    expect(openOf(invalidate(asking(), "AGENDA_CHANGED"))).toEqual([]);
    for (const status of ["done", "withdrawn"] as const) {
      const settled: PilotPlan = { ...ready(), action: { ...ready().action, status } };
      expect(invalidate(settled, "AGENDA_CHANGED")).toEqual(settled);
    }
  });
  it("a proposal attaches only to the current revision; the approval is a compare-and-swap on the revision and the proposal's own refs", () => {
    const draft = accepted(applyIntent(ready(), { fields: { time: resolved("16:00") } }, 4)).plan;
    rejected(attachProposal(draft, proposal(4)), "STALE_REVISION", structuredClone(draft));
    const shown = accepted(attachProposal(draft, proposal(5))).plan;
    expect(shown).toMatchObject({ revision: 5, action: { status: "proposal_ready", proposal: proposal(5) } });
    rejected(approve(shown, { proposalRef: "prop-5", draftRevision: 5, revision: 4 }), "STALE_REVISION", structuredClone(shown));
    rejected(approve(shown, { proposalRef: "prop-4", draftRevision: 5, revision: 5 }), "PROPOSAL_MISMATCH", structuredClone(shown));
    rejected(approve(shown, { proposalRef: "prop-5", draftRevision: 4, revision: 5 }), "PROPOSAL_MISMATCH", structuredClone(shown));
    rejected(approve(draft, { proposalRef: "prop-5", draftRevision: 5, revision: 5 }), "PROPOSAL_MISMATCH", structuredClone(draft));
    const approved = accepted(approve(shown, { proposalRef: "prop-5", draftRevision: 5, revision: 5 })).plan;
    expect(approved).toMatchObject({ revision: 5, action: { status: "approved", approval: { proposalRef: "prop-5", draftRevision: 5, revision: 5 } } });
    const moved = accepted(applyIntent(approved, { fields: { time: resolved("17:00") } }, 5)).plan;
    expect(moved.revision).toBe(6);
    expect(moved.action.approval).toBeUndefined();
    expect(moved.action.proposal).toBeUndefined();
  });
});

/** Deterministic pseudo-random source (mulberry32). */
function random(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(next: () => number, items: readonly T[]) => items[Math.floor(next() * items.length)];
const randomField = (next: () => number): PilotField => next() < 0.2 ? UNRESOLVED
  : { value: `v${Math.floor(next() * 1000)}`, display: `d${Math.floor(next() * 1000)}`, provenance: pick(next, ["explicit", "inherited", "derived"] as const) };
function randomPatch(next: () => number, id: () => string): PilotPatch {
  const fields = Object.fromEntries(PILOT_FIELDS.filter(() => next() < 0.35).map(name => [name, randomField(next)]));
  return { fields, ...(next() < 0.4 ? { questions: [{ questionId: id(), field: pick(next, PILOT_FIELDS), reason: "TIME_MISSING" as const }] } : {}) };
}

describe("§4 plan: provenance on every field", () => {
  it("a field breaking the value/provenance rule is rejected; clearing a field back to unresolved is a valid change", () => {
    const plan = ready(), before = structuredClone(plan);
    rejected(applyIntent(plan, { fields: { time: { value: "16:00", display: "16h", provenance: "unresolved" } } }, 4), "FIELD_INVALID", before);
    rejected(applyIntent(plan, { fields: { time: { value: null, display: null, provenance: "explicit" } } }, 4), "FIELD_INVALID", before);
    rejected(applyIntent(plan, { fields: { time: { value: "16:00", display: "16h", provenance: "guessed" as PilotProvenance } } }, 4), "FIELD_INVALID", before);
    expect(accepted(applyIntent(plan, { fields: { time: UNRESOLVED } }, 4)).plan.action.fields.time).toEqual(UNRESOLVED);
  });
  it("property: over random sequences every field keeps a provenance, the revision only moves by one on an accepted change, a rejection changes nothing", () => {
    const next = random(3103022);
    for (let run = 0; run < 40; run++) {
      let plan = createPilotPlan(`plan-${run}`), ids = 0;
      for (let step = 0; step < 25 && !["withdrawn", "done"].includes(plan.action.status); step++) {
        const before = structuredClone(plan), base = next() < 0.8 ? plan.revision : plan.revision + (next() < 0.5 ? -1 : 1), kind = Math.floor(next() * 6);
        const open = openOf(plan), question = open.length && next() < 0.8 ? open[0].questionId : `q${ids + 500}`;
        const result: PilotReduction | PilotPlan = kind === 0 ? applyIntent(plan, randomPatch(next, () => `q${++ids}`), base)
          : kind === 1 ? applyAnswer(plan, { questionId: question, value: resolved(`v${step}`) }, base)
          : kind === 2 ? withdraw(plan, base, next() < 0.5 ? randomPatch(next, () => `q${++ids}`) : undefined)
          : kind === 3 ? invalidate(plan, "AGENDA_CHANGED")
          : kind === 4 ? attachProposal(plan, proposal(next() < 0.8 ? plan.revision : plan.revision + 1))
          : approve(plan, { proposalRef: plan.action.proposal?.proposalRef ?? "prop-x", draftRevision: plan.action.proposal?.draftRevision ?? 0, revision: base });
        const after = "ok" in result ? result.plan : result, label = `run ${run} step ${step} kind ${kind}`;
        if ("ok" in result && !result.ok) expect(after, label).toEqual(before);
        if ("ok" in result && result.ok && kind <= 2) {
          expect(after.revision, label).toBe(before.revision + 1);
          expect(after.action.proposal, label).toBeUndefined();
          expect(after.action.approval, label).toBeUndefined();
        }
        if (kind >= 4) expect(after.revision, label).toBe(before.revision);
        for (const name of PILOT_FIELDS) {
          const field = after.action.fields[name];
          expect(PILOT_PROVENANCES, `${label} ${name}`).toContain(field.provenance);
          expect(field.value === null, `${label} ${name}`).toBe(field.provenance === "unresolved");
        }
        expect(PILOT_STATUSES).toContain(after.action.status);
        if (after.action.proposal) expect(after.action.proposal.revision, label).toBe(after.revision);
        if (after.action.approval) expect(after.action.approval.revision, label).toBe(after.revision);
        for (const item of openOf(after)) expect(item.revision, label).toBe(after.revision);
        plan = after;
      }
    }
  });
});
