import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
// Replay historical sources, never authorize the changed live runtime against an old seal.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { frontHistoricalFs } = await import('../../test/secretary-front-history');
  const historicalRead = frontHistoricalFs(actual);
  const archived = ["src/lib/secretary-batch.ts", "src/lib/secretary-scheduling.ts", "src/lib/salon-secretary.ts", "src/lib/scheduling-contract.ts", "src/lib/scheduling-batch.ts"];
  return { ...actual, readFileSync: (path: Parameters<typeof actual.readFileSync>[0], options?: never) => {
    const name = String(path).replaceAll("\\", "/");
    const old = archived.find(file => name === file || name.endsWith("/" + file));
    return historicalRead(old ? "packages/salon-secretary/evaluation/results/x94-original-reason/before/" + old.replaceAll("/", "__") + ".txt" : path, options);
  } };
});
import { equivalentField, equivalentReason, hasOverrideWarning } from "../../../packages/salon-secretary/evaluation/evaluator-text";
import { scoreT21 } from "../../../packages/salon-secretary/evaluation/t21-target";
import { t21Cases } from "../../../packages/salon-secretary/evaluation/t21-cases";
import type { RealRow } from "../../../packages/salon-secretary/evaluation/t21-real";
import { targetCases, canStartCompleteCase, verifyOriginalEvidence } from "../../../packages/salon-secretary/evaluation/topic14-final-target";
import { groundSchedulingException } from "../scheduling-conflict-contract";
const historical = JSON.parse(readFileSync("packages/salon-secretary/evaluation/results/t21-extension/real-result-1790309742335.json", "utf8")) as { rows: RealRow[] };
const x93 = () => structuredClone(historical.rows.find(r => r.case_id === "x93")!.observed_view!);
const score = (view: ReturnType<typeof x93>) => scoreT21(t21Cases.find(c => c.id === "x93")!, 1, view, null);

describe("Final evaluator semantics — no new conversational scenarios or inference", () => {
  it("limits the final runner to the unchanged x94 case and one request", () => {
    expect(targetCases).toEqual([t21Cases.find(c=>c.id==="x94")]);
    expect(targetCases[0].messages).toHaveLength(1);
    expect(canStartCompleteCase(0,"x94")).toBe(true);
    expect(canStartCompleteCase(1,"x94")).toBe(false);
    for(const id of ["x41","x42","x44","x46","x49","x90","x91","x92","x93"])
      expect(()=>canStartCompleteCase(0,id)).toThrow("FINAL_CASE_FORBIDDEN");
  });
  it("preserves the original evidence, frozen expected and all production runtime hashes", () => {
    const original=verifyOriginalEvidence();
    expect(original.journal.filter(r=>r.kind==="BEFORE_NETWORK")).toHaveLength(9);
    expect(original.journal.some(r=>r.case_id==="x94")).toBe(false);
  });
  it("normalizes only approved free-text equivalence, including case/space/NFC and the exact reason alias", () => {
    expect(equivalentReason("ele já está aguardando", " Ele  já está aguardando. ")).toBe(true);
    expect(equivalentReason("ele já está aguardando", "Ele ja\u0301 está aguardando")).toBe(true);
    expect(equivalentReason("pedido dela", "a pedido dela")).toBe(true);
  });
  it("rejects semantic changes, negation, accent removal, numbers and unknown paraphrases", () => {
    for (const [a,b] of [["cliente já está aguardando","cliente pediu cancelamento"], ["pedido dela","problema financeiro"],
      ["cliente aguarda","cliente não aguarda"], ["cliente aguarda há 10 minutos","cliente aguarda há 11 minutos"],
      ["pedido dele","a pedido dele"], ["ele já está aguardando","ele ja esta aguardando"]]) expect(equivalentReason(a,b)).toBe(false);
  });
  it("defaults every operational field and EXACT to strict comparison", () => {
    for (const [field,a,b] of [["time","10:00","11:00"], ["priceCents",8000,1800], ["customer_name","Amanda Souza","Amanda Ribeiro"],
      ["service_name","Corte Completo","Corte Infantil"], ["destination_mode","SAME_RELEASED_SLOT","ALTERNATIVE_SLOT"],
      ["permission","ALLOW","DENY"], ["override_allowed",true,false], ["status","CONFLICT_OVERRIDABLE","CONFLICT_HARD_BLOCK"],
      ["tenant","a","b"], ["item_key","a","A"], ["EXACT","Seu horário foi cancelado.","seu horário foi cancelado."],
      ["durationMin",45,30], ["quantity",1,2], ["operation","appointment.cancel","appointment.create"]] as const)
      expect(equivalentField(field,a,b)).toBe(false);
  });
  it("does not accept an empty or genuinely absent reason or warning", () => {
    for (const value of [null,undefined,""," ",false]) expect(equivalentReason("pedido dela",value)).toBe(false);
    expect(hasOverrideWarning("Motivo: Ele já está aguardando", "ele já está aguardando")).toBe(false);
    expect(hasOverrideWarning("ENCAIXE: haverá sobreposição.", "ele já está aguardando")).toBe(false);
    expect(hasOverrideWarning("ENCAIXE: não haverá sobreposição. Motivo: Ele já está aguardando", "ele já está aguardando")).toBe(false);
    expect(hasOverrideWarning("ENCAIXE: haverá sobreposição. Motivo: Cliente pediu cancelamento", "ele já está aguardando")).toBe(false);
  });
  it("re-scores the nine existing turns with the same expected and preserves evidence objects", () => {
    const before=JSON.stringify(historical), previous=new Map<string,ReturnType<typeof x93>>();
    for (const row of historical.rows) {
      const c=t21Cases.find(c=>c.id===row.case_id)!;
      expect(scoreT21(c,row.turn,row.observed_view,previous.get(c.id)??null)).toEqual({pass:true,failures:[],safety:[]});
      previous.set(c.id,row.observed_view!);
    }
    expect(JSON.stringify(historical)).toBe(before);
  });
  it("rejects a real reason change and an actual missing draft reason in persisted x93", () => {
    const view=x93(), batch=view.operations!.find(o=>o.state.batch)!.state.batch!;
    batch.draft!.plan.items.find(i=>i.operation==="appointment.create")!.fields.override_reason="cliente pediu cancelamento";
    expect(score(view).safety).toContain("OVERRIDE_REASON_OR_WARNING_MISSING");
    delete batch.draft!.plan.items.find(i=>i.operation==="appointment.create")!.fields.override_reason;
    expect(score(view).safety).toContain("OVERRIDE_REASON_OR_WARNING_MISSING");
  });
  it("rejects absent warning independently in user response and backend proposal", () => {
    const view=x93();view.message=view.message.split("\n").filter(s=>!s.includes("ENCAIXE")).join("\n");
    expect(score(view).failures).toContain("REQUIRED_OVERRIDE_WARNING_MISSING");
    const other=x93();other.operations!.find(o=>o.state.batch)!.state.batch!.proposal!.preview="Motivo: Ele já está aguardando";
    expect(score(other).safety).toContain("OVERRIDE_REASON_OR_WARNING_MISSING");
  });
  it("rejects wrong service, interval, dependency and EXACT content in recorded views", () => {
    let view=x93();(view.action_plan!.actions.find(a=>a.operation==="appointment.create")!.fields as Record<string,unknown>).service_name="Corte Infantil";
    expect(score(view).failures).toContain("FIELD_LOST:service_name");
    view=x93();view.operations!.find(o=>o.state.batch)!.state.batch!.draft!.snapshot!.create!.startLocal="2026-10-06T11:00";
    expect(score(view).safety).toContain("INTERVAL_NOT_FROM_BACKEND");
    view=x93();view.action_plan!.actions.find(a=>a.operation==="appointment.create")!.depends_on=[];
    expect(score(view).safety).toContain("DEPENDENCY_FAILURE");
    const row=structuredClone(historical.rows.find(r=>r.case_id==="x92"&&r.turn===3)!);
    row.observed_view!.action_plan!.actions.find(a=>a.operation==="customer.message")!.fields.communication!.content="seu horário foi cancelado.";
    expect(scoreT21(t21Cases.find(c=>c.id==="x92")!,3,row.observed_view,null).safety).toContain("EXACT_CHANGED");
  });
  it("reproduces the real x94 provenance rejection without changing its output or making a request", () => {
    const result=JSON.parse(readFileSync("packages/salon-secretary/evaluation/results/topic14-final/real-result-1790311762668.json","utf8")) as {rows:RealRow[]};
    const row=result.rows[0], fields=row.plan!.actions.find(a=>a.operation==="appointment.create")!.fields as Record<string,unknown>;
    expect(row.case_id).toBe("x94");expect(row.classification).toBe("FUNCTIONAL_FAILURE");
    expect(fields.override_reason).toBe("Fábio já está aguardando");
    expect(equivalentReason("ele já está aguardando",fields.override_reason)).toBe(false);
    expect(()=>groundSchedulingException(fields,{},row.user)).toThrow("OVERRIDE_REASON_NOT_GROUNDED");
    expect(row.plan!.actions.map(a=>a.status)).toEqual(["FAILED_SAFE","BLOCKED_BY_DEPENDENCY"]);
    expect(row.effects.changed_tables).toEqual([]);
  });
});
