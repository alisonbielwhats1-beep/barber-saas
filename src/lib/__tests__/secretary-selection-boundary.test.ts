import { afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(),
  salon: {findUniqueOrThrow: vi.fn().mockResolvedValue({timezone:"America/Sao_Paulo"})},
  auditLog: { create: vi.fn().mockResolvedValue({}) } }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(db) }));
vi.mock("../salon-secretary-usage", () => ({ usageRecorder: () => async () => {} }));
import { validateSelection } from "@everflair/salon-secretary";
import { validateBatchPlan } from "../scheduling-batch";
import { startBatch } from "../secretary-batch";
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import golden from "../../test/fixtures/secretary-real-outputs.json";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const dependent = (edges: unknown = ["a"]) => ({skills:["scheduling"], independent:false, operations:[
  intent("appointment.cancel", {item_key:"a", depends_on:null, customer_name:"Amanda"}),
  intent("appointment.create", {item_key:"b", depends_on:edges, released_slot_of:"a", customer_name:"Fábio"}),
]});
describe("optional dependency boundary", () => {
  it.each([{}, {depends_on:[]}, {depends_on:null}])("canonicalizes no edges: %j", fields => {
    const input = plan([intent("financial.report", fields)]);
    const before = structuredClone(input);
    expect(validateSelection(input).operations[0].depends_on).toEqual([]);
    expect(input).toEqual(before);
  });
  it.each(["a", {}, 1, [1], [null]])("rejects invalid wire dependency %j", depends_on => {
    expect(() => validateSelection(dependent(depends_on))).toThrow();
  });
  it("preserves real edges through canonicalization and domain validation", () => {
    const selected = validateSelection(dependent());
    const items = selected.operations.map(op => ({key:op.item_key, operation:op.operation,
      depends_on:op.depends_on, ...(op.released_slot_of ? {released_slot_of:op.released_slot_of} : {}), fields:{}}));
    expect(validateBatchPlan({execution_policy:"all_or_nothing",items}).items.map(i => i.depends_on)).toEqual([[],["a"]]);
  });
  it.each(["missing", "cycle", "null-edge", "arbitrary-ref"])("real batch coordinator still rejects %s before persistence", async kind => {
    db.$queryRaw.mockResolvedValue([{accessStatus:"APPROVED", timezone:"America/Sao_Paulo", role:"OWNER"}]);
    const input = dependent(kind === "missing" ? ["unknown"] : kind === "null-edge" ? null : kind === "arbitrary-ref" ? ["../../admin"] : ["a"]);
    if (kind === "null-edge") Object.assign(input.operations[1], {released_slot_of:null});
    if (kind === "cycle") Object.assign(input.operations[0], {depends_on:["b"]});
    const result = Promise.resolve().then(() => startBatch({salonId:"synthetic",userId:"owner"},validateSelection(input)));
    await expect(result).rejects.toThrow(kind === "cycle" ? "DEPENDENCY_CYCLE" : kind === "null-edge" ? "UNSUPPORTED_BATCH" : "DEPENDENCY_ERROR");
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it.each(["service.create", "customer.create", "appointment.create"])("canonical independent %s", operation => {
    expect(validateSelection(plan([intent(operation,{depends_on:null})])).operations[0]).toMatchObject({operation,depends_on:[]});
    expect(() => validateSelection(plan([intent(operation,{depends_on:["a"]})]))).toThrow("DEPENDENCY_ERROR");
  });
  it("does not normalize unrelated mandatory arrays", () => {
    for (const field of ["requested_fields", "clear_fields"]) {
      expect(() => validateSelection(plan([intent("customer.create",{[field]:null})]))).toThrow();
    }
  });
  it.each(golden.filter(g => g.id.startsWith("gate25")))("real Financial $id traverses SDK, automatic coordinator and T09 with fake SQL", async recorded => {
    const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
    vi.stubGlobal("fetch",network);
    const aggregate = {label:"current",revenue:12000n,count:2n,products:0n,product_invalid:0n,
      received:0n,payment_count:0n,payment_invalid:0n,receivable:0n,unpaid_count:0n,unpaid_invalid:0n,snapshot_invalid:0n,groups:[]};
    db.$queryRaw.mockImplementation(async (query: {strings?:readonly string[]; sql?:string} | readonly string[]) => {
      const sql = Array.isArray(query) ? query.join("") : (query as {sql?:string}).sql ?? "";
      if (sql.includes("WITH ranges")) return [aggregate];
      if (sql.includes('"Membership"')) return [{role:"OWNER"}];
      return [{accessStatus:"APPROVED",timezone:"America/Sao_Paulo",currency:"BRL"}];
    });
    const fake = new ScriptedServicesModel([call("select_capabilities",recorded.payload)]);
    const secretary = new SalonSecretary(async () => fake, () => "fake-only");
    const actor = {salonId:"synthetic",userId:"owner"};
    const session = await secretary.start(actor,"auto");
    const result = await secretary.send(actor,{sessionId:session.sessionId,message:"Quanto faturei ontem?"});
    const financial = result.operations?.[0].state.financial;
    expect(financial).toMatchObject({status:"DONE",result:{metrics:[{id:"service_revenue",value:12000}]}});
    expect(fake.requests).toHaveLength(1);
    expect(network).not.toHaveBeenCalled();
  });
});
