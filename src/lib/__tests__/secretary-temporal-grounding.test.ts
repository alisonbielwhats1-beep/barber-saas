import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { applySchedulingInterpretation, sendSchedulingTurn, schedulingSourceTimeReply, schedulingState } from "../secretary-scheduling";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { confirmAppointmentCreate, proposeAppointmentCreate, upsertSchedulingDraft } from "../scheduling-actions";
import { groundBatchPatch } from "../secretary-batch";
import type { BatchPlan } from "../scheduling-batch";
import { locateSchedulingAppointments, inspectSchedulingMove } from "../scheduling-mutations";

const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(), schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => ({ ...await importOriginal<object>(), authorizeSchedulingOperation: async () => "OWNER",
  locateSchedulingAppointments: vi.fn(async (_tx:unknown, _actor:unknown, fields:{source_time?:string}) => fields.source_time === "11:00" ? [{appointment_ref:"appointment-amanda-11"}] : []),
  inspectSchedulingMove: vi.fn(async () => ({result:{violation:"SALON_CLOSED"},alternatives:[]})),
}));
vi.mock("../customer-catalog",async importOriginal=>({...await importOriginal<object>(),searchSalonCustomer:async()=>[{id:"customer-amanda",name:"Amanda Souza"}]}));
vi.mock("../scheduling-entity-mentions", () => ({ validateSchedulingEntityMentions: async () => undefined }));

const actor = { salonId: "tenant-a", userId: "owner-a" };
type Row = { id?: string; entityId?: string; action?: string; metadata?: unknown; [key: string]: unknown };
let rows: Row[];
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-26T12:00:00Z")); rows = [];
  const filtered = (where: Row) => rows.filter(row => Object.entries(where).every(([k, v]) => row[k] === v));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Row }) => { rows.push(structuredClone(data)); return data; }),
    findMany: vi.fn(async ({ where }: { where: Row }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Row }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
import { afterEach } from "vitest";
afterEach(() => vi.useRealTimers());

describe("temporal grounding through coordinator and persistent draft/proposal guards", () => {
  it("sends the missing role to Luna and preserves accepted destination through the actual continuation", async()=>{
    const fields={customer_name:"Amanda Souza",customer_ref:"customer-amanda",date:"2026-09-27",time:"09:00"};
    const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields,rejected_temporal:[{code:"SOURCE_TEMPORAL_CONFLICT",field:"source_time",value:"MISSING"}]});
    const state={...schedulingState(),operation:"appointment.change" as const,fields,draft,waiting_for:"source_time",message:"Qual era o horário original?"};
    const model=new ScriptedServicesModel([call("upsert_action_draft",{operation:null,source_time:"11:00"})]);
    await sendSchedulingTurn(actor,state,model,"Era às onze.",()=>{});
    const request=JSON.stringify(model.requests[0]);
    expect(request).toContain('requested_field'); expect(request).toContain('source_time'); expect(request).toContain('Qual era o horário original?');
    expect(state.fields).toMatchObject({...fields,source_time:"11:00"});
    expect(state.draft?.draft_ref).toBe(draft.draft_ref); expect(state.draft?.draft_revision).toBe(2);
    expect(state.draft?.missing_fields).not.toContain("source_time"); expect(rows.some(r=>r.action==="CONFIRMED")).toBe(false);
  });
  it("does not broaden appointment search while an explicit source selector remains unresolved",async()=>{
    const fields={customer_name:"Amanda Souza",customer_ref:"customer-amanda",date:"2026-09-27",time:"09:00"};
    const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields,rejected_temporal:[{code:"SOURCE_TEMPORAL_CONFLICT",field:"source_time",value:"MISSING"}]});
    const state={...schedulingState(),operation:"appointment.change" as const,fields,draft,waiting_for:"source_time"};
    vi.mocked(locateSchedulingAppointments).mockClear();
    await applySchedulingInterpretation(actor,state,{},"um instante");
    expect(locateSchedulingAppointments).not.toHaveBeenCalled(); expect(state.waiting_for).toBe("source_time");
    expect(state.fields.time).toBe("09:00"); expect(state.proposal).toBeUndefined();
  });
  it("rejects an incorrectly targeted model patch atomically without destroying accepted destination",async()=>{
    const fields={customer_name:"Amanda Souza",customer_ref:"customer-amanda",date:"2026-09-27",time:"09:00"};
    const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields,rejected_temporal:[{code:"SOURCE_TEMPORAL_CONFLICT",field:"source_time",value:"MISSING"}]});
    const state={...schedulingState(),operation:"appointment.change" as const,fields:{...fields},draft,waiting_for:"source_time",message:"Qual era o horário original?"};
    await applySchedulingInterpretation(actor,state,{time:"11:00"},"11h");
    expect(state.fields).toEqual(fields); expect(state.draft?.draft_revision).toBe(draft.draft_revision);
    expect(state.waiting_for).toBe("source_time"); expect(state.proposal).toBeUndefined();
    await applySchedulingInterpretation(actor,state,{source_time:"11:00"},"11h");
    expect(state.fields).toMatchObject({...fields,source_time:"11:00"}); expect(state.draft?.draft_ref).toBe(draft.draft_ref);
    expect(state.draft?.missing_fields).not.toContain("source_time");
  });
  it("accepts only an exact clock reply to the requested original time",()=>{
    expect(schedulingSourceTimeReply("source_time","11h")).toEqual({source_time:"11:00"});
    for(const message of ["não 11h","11h e amanhã às 09h","25h","11"])expect(schedulingSourceTimeReply("source_time",message)).toBeUndefined();
    expect(schedulingSourceTimeReply(undefined,"11h")).toBeUndefined();
  });
  it("manual Amanda origin/destination survives preparation and closed Sunday cannot produce a proposal",async()=>{
    const state=schedulingState();
    await applySchedulingInterpretation(actor,state,{operation:"appointment.change",customer_name:"Amanda Souza",source_time:"11:00",day_offset:1,time:"09:00"},"altere a amanda souza das 11h para amanha as 09h");
    expect(state.fields).toMatchObject({source_time:"11:00",date:"2026-09-27",time:"09:00",appointment_ref:"appointment-amanda-11"});
    expect(vi.mocked(locateSchedulingAppointments).mock.lastCall?.[2]).toMatchObject({source_time:"11:00"});
    expect(vi.mocked(inspectSchedulingMove).mock.lastCall?.slice(2)).toEqual(["appointment-amanda-11","2026-09-27","09:00"]);
    expect(state.proposal).toBeUndefined();expect(state.message).toMatch(/indisponível/); // 2026-09-27 wording: cause + alternatives
    expect(state.draft?.temporal_missing).toBeUndefined();
    expect(rows.some(r=>r.action==="PROPOSAL"||r.action==="CONFIRMED")).toBe(false);
  });
  it("an exact original-time reply clears the persisted missing field in the same draft",async()=>{
    const fields={customer_name:"Amanda Souza",customer_ref:"customer-amanda",date:"2026-09-27",time:"09:00"};
    const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields,rejected_temporal:[{code:"SOURCE_TEMPORAL_CONFLICT",field:"source_time",value:"MISSING"}]});
    const state={...schedulingState(),operation:"appointment.change" as const,fields,draft,waiting_for:"source_time"};
    const reply=schedulingSourceTimeReply(state.waiting_for,"11h");expect(reply).toEqual({source_time:"11:00"});
    await applySchedulingInterpretation(actor,state,reply!,"11h");
    expect(state.draft?.draft_ref).toBe(draft.draft_ref);expect(state.draft?.draft_revision).toBe(2);
    expect(state.fields).toMatchObject({...fields,source_time:"11:00",appointment_ref:"appointment-amanda-11"});
    expect(state.draft?.missing_fields).not.toContain("source_time");expect(state.waiting_for).not.toBe("source_time");
    expect(state.proposal).toBeUndefined();expect(rows.some(r=>r.action==="CONFIRMED")).toBe(false);
  });
  it("preserves dependency graph and missing date across batch continuations",()=>{
    const plan:BatchPlan={execution_policy:"all_or_nothing",items:[
      {key:"cancel",operation:"appointment.cancel",depends_on:[],fields:{customer_name:"Amanda",date:"2026-10-03",time:"10:00"}},
      {key:"create",operation:"appointment.create",depends_on:["cancel"],released_slot_of:"cancel",fields:{customer_name:"Fábio",service_name:"Massagem"}},
    ]};
    const changed=groundBatchPatch(plan,"cancel",{weekday:6},"Não, domingo.","America/Sao_Paulo");
    expect(changed.items[0].fields.date).toBeUndefined();expect(changed.items[0].temporal_missing).toEqual(["date"]);
    expect(changed.items[1]).toEqual(plan.items[1]);
    const independent=groundBatchPatch(changed,"cancel",{reason:"a cliente pediu"},"a cliente pediu","America/Sao_Paulo");
    expect(independent.items[0].temporal_missing).toEqual(["date"]);
    const corrected=groundBatchPatch(independent,"cancel",{weekday:0},"domingo","America/Sao_Paulo");
    expect(corrected.items[0].fields.date).toBe("2026-09-27");expect(corrected.items[0].temporal_missing).toBeUndefined();
  });
  it("G: schema-valid Saturday from Sunday cannot produce a proposal", async () => {
    const state = schedulingState();
    await applySchedulingInterpretation(actor, state, { operation:"appointment.create",weekday:6,time:"10:00",customer_name:"Fábio",service_name:"Massagem",professional_name:"Tatiana A" }, "Marca o Fábio para Massagem com a Tatiana A no domingo às dez horas.");
    expect(state.proposal).toBeUndefined(); expect(state.draft?.status).toBe("NEEDS_INPUT");
    expect(state.fields).toEqual({time:"10:00",customer_name:"Fábio",service_name:"Massagem",professional_name:"Tatiana A"});
    expect(state.draft?.temporal_missing).toContain("date");
    expect(rows.filter(r=>r.action==="TEMPORAL_RECONCILED")).toHaveLength(1);
    await expect(proposeAppointmentCreate(db.tx, actor, {draft_ref:state.draft!.draft_ref,draft_revision:state.draft!.draft_revision})).rejects.toThrow("NEEDS_INPUT");
    expect(rows.some(r=>r.action==="PROPOSAL"||r.action==="CONFIRMED")).toBe(false);
  });
  it("same draft advances revision, clears persisted old date, rejects old confirmation and retains non-temporal references",async()=>{
    const fields={date:"2026-10-03",time:"10:00",customer_ref:"c",service_ref:"s",professional_ref:"p"};
    const old=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.create",fields});
    const proposal_ref=randomUUID();
    const payload_hash=createHash("sha256").update(JSON.stringify({operation:old.operation,fields:old.fields,snapshot:old.snapshot,action_snapshot:old.action_snapshot,temporal_missing:old.temporal_missing})).digest("hex");
    const {status:_status,missing_fields:_missing,temporal_conflicts:_conflicts,...oldDraft}=old;void _status;void _missing;void _conflicts;
    rows.push({salonId:actor.salonId,userId:actor.userId,entityType:"SECRETARY_SCHEDULING",id:proposal_ref,entityId:old.draft_ref,action:"PROPOSAL",metadata:{...oldDraft,proposal_ref,payload_hash,preview:"previous proposal"}});
    const state={...schedulingState(),operation:"appointment.create" as const,fields,draft:old};
    await applySchedulingInterpretation(actor,state,{weekday:6},"Não, domingo.");
    expect(state.draft?.draft_ref).toBe(old.draft_ref);expect(state.draft?.draft_revision).toBe(2);
    expect(state.draft?.fields).toEqual({time:"10:00",customer_ref:"c",service_ref:"s",professional_ref:"p"});
    await expect(confirmAppointmentCreate(db.tx,actor,{proposal_ref,draft_revision:1})).rejects.toThrow("REVISION_CONFLICT");
    const next=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.create",draft_ref:old.draft_ref,expected_revision:2,fields:{reason:"informação independente"}});
    expect(next.status).toBe("NEEDS_INPUT");expect(next.temporal_missing).toContain("date");expect(next.fields.date).toBeUndefined();
    expect(rows.some(r=>r.action==="CONFIRMED")).toBe(false);
  });
});

it("a new service intent is returned to coordinator before touching the scheduling draft", async()=>{
  const {withConversationRouting,SecretaryNewRequest,schedulingInterpretation}=await import("@everflair/salon-secretary");
  const {intent,plan}=await import("../../test/secretary-capability-plan");
  const state=schedulingState();Object.assign(state,{operation:"appointment.change",fields:{customer_name:"Lara",source_time:"11:00",date:"2026-09-27",time:"09:00"},message:"Qual agendamento?"});
  const before=structuredClone(state.fields),auditCount=rows.length;
  const model=new ScriptedServicesModel([call("upsert_action_draft",{...Object.fromEntries(Object.keys(schedulingInterpretation.shape).map(key=>[key,null])),new_request:plan([intent("service.change",{target_name:"Hidratação",priceCents:9000})])})]);
  await expect(withConversationRouting(()=>sendSchedulingTurn(actor,state,model,"Altere o preço da Hidratação para noventa reais.",()=>{}))).rejects.toBeInstanceOf(SecretaryNewRequest);
  expect(state.fields).toEqual(before);expect(rows).toHaveLength(auditCount);expect(model.requests).toHaveLength(1);
});

describe("per-turn evidence crosses the real Scheduling adapter and draft boundary", () => {
  it("preserves destination-before-source and consumes evidence before draft persistence", async () => {
    const state = schedulingState();
    const source = "Para amanhã às 9h, muda a Amanda do horário das 11h.";
    await applySchedulingInterpretation(actor, state, { operation: "appointment.change", customer_name: "Amanda Souza", source_time: "11:00", day_offset: 1, time: "09:00", temporal_evidence: [
      { field: "date", text: "amanhã" }, { field: "time", text: "às 9h" }, { field: "source_time", text: "das 11h" },
    ] }, source);
    expect(state.fields).toMatchObject({ source_time: "11:00", date: "2026-09-27", time: "09:00", appointment_ref: "appointment-amanda-11" });
    expect(state.draft?.fields).toEqual(state.fields);
    expect(state.fields).not.toHaveProperty("temporal_evidence");
    expect(state.draft?.temporal_missing).toBeUndefined();
    expect(state.proposal).toBeUndefined(); // The domain still rejects closed Sunday.
    expect(state.message).toMatch(/indisponível/); // 2026-09-27 wording: cause + alternatives
  });

  it("accepts literal evidence from a Scheduling tool continuation without losing existing fields", async () => {
    const fields = { customer_name: "Amanda Souza", customer_ref: "customer-amanda", date: "2026-09-27", time: "09:00" };
    const draft = await upsertSchedulingDraft(db.tx, actor, { operation: "appointment.change", fields, rejected_temporal: [{ code: "SOURCE_TEMPORAL_CONFLICT", field: "source_time", value: "MISSING" }] });
    const state = { ...schedulingState(), operation: "appointment.change" as const, fields, draft, waiting_for: "source_time", message: "Qual era o horário original?" };
    const model = new ScriptedServicesModel([call("upsert_action_draft", { operation: null, source_time: "11:00", temporal_evidence: [{ field: "source_time", text: "às onze" }] })]);
    await sendSchedulingTurn(actor, state, model, "Era às onze.", () => {});
    expect(state.fields).toMatchObject({ ...fields, source_time: "11:00" });
    expect(state.draft?.draft_ref).toBe(draft.draft_ref);
    expect(state.draft?.missing_fields).not.toContain("source_time");
    expect(state.draft?.fields).not.toHaveProperty("temporal_evidence");
  });

  it("wrong weekday with evidence remains non-confirmable and never broadens appointment search", async () => {
    const state = schedulingState();
    vi.mocked(locateSchedulingAppointments).mockClear();
    await applySchedulingInterpretation(actor, state, { operation: "appointment.change", customer_name: "Amanda Souza", weekday: 6, time: "10:00", temporal_evidence: [{ field: "date", text: "domingo" }, { field: "time", text: "às dez horas" }] }, "Muda a Amanda para domingo às dez horas.");
    expect(state.fields.date).toBeUndefined();
    expect(state.fields.time).toBe("10:00");
    expect(state.draft?.temporal_missing).toContain("date");
    expect(state.proposal).toBeUndefined();
    expect(locateSchedulingAppointments).not.toHaveBeenCalled();
    expect(rows.some(row => row.action === "PROPOSAL" || row.action === "CONFIRMED")).toBe(false);
  });

  it("batch corrections ground only their action while preserving dependencies and sibling fields", () => {
    const plan: BatchPlan = { execution_policy: "all_or_nothing", items: [
      { key: "cancel", operation: "appointment.cancel", depends_on: [], fields: { customer_name: "Amanda", date: "2026-09-27", time: "10:00" } },
      { key: "create", operation: "appointment.create", depends_on: ["cancel"], released_slot_of: "cancel", fields: { customer_name: "Fábio", service_name: "Corte" } },
    ] };
    const result = groundBatchPatch(plan, "cancel", { time: "11:00" }, "O cancelamento é o das 11h; a outra consulta é depois de amanhã às 15h.", "America/Sao_Paulo", [{ field: "time", text: "11h" }]);
    expect(result.items[0].fields).toEqual({ ...plan.items[0].fields, time: "11:00" });
    expect(result.items[1]).toEqual(plan.items[1]);
    expect(result.items[0].temporal_missing).toBeUndefined();
    expect(result.items[0].fields).not.toHaveProperty("temporal_evidence");
  });
});

describe("effective source state survives the real U03 journal boundary",()=>{
 it("two unresolved date roles ask for dates without inventing an end-time conflict",async()=>{
  const fields={customer_name:"Amanda Souza",time:"16:00",source_time:"14:00"};
  const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields,rejected_temporal:[{code:"SOURCE_TEMPORAL_CONFLICT",field:"date",value:"2026-09-30"},{code:"SOURCE_TEMPORAL_CONFLICT",field:"source_date",value:"2026-09-29"}]});
  const state={...schedulingState(),operation:"appointment.change" as const,fields,draft};
  await applySchedulingInterpretation(actor,state,{},"um momento");
  expect(state.message).toContain("data de destino");expect(state.message).toContain("data original");expect(state.message).not.toMatch(/final|horário final|incompatível/);
  expect(state.fields).toEqual(fields);expect(state.proposal).toBeUndefined();expect(state.draft?.temporal_missing).toEqual(["date","source_date"]);
 });
 it("rejected retarget keeps the old accepted value through persistence and unrelated patches",async()=>{
  const {groundSchedulingTemporal}=await import("../scheduling-temporal-source");
  const fields={customer_name:"Amanda Souza",date:"2026-09-27",time:"09:00"};
  const first=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields});
  const grounded=groundSchedulingTemporal(fields,{time:"11:00"},"11h","America/Sao_Paulo",new Date(),"source_time","appointment.change",[{field:"time",text:"11h"}]);
  const next=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields:grounded.fields,rejected_temporal:grounded.rejected,draft_ref:first.draft_ref,expected_revision:first.draft_revision});
  expect(next.fields).toEqual(fields);expect(next.temporal_missing).toEqual(["source_time"]);expect(next.missing_fields).not.toContain("time");
  const later=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields:{customer_name:"Amanda Souza"},draft_ref:next.draft_ref,expected_revision:next.draft_revision});
  expect(later.fields).toEqual(fields);expect(later.temporal_missing).toEqual(["source_time"]);
 });
 it("a fabricated retained value cannot override the previously accepted revision",async()=>{
  const first=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields:{time:"09:00"}});
  const next=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.change",fields:{time:"11:00"},rejected_temporal:[{code:"SOURCE_TEMPORAL_CONFLICT",field:"time",value:"11:00",retained_value:"11:00"}],draft_ref:first.draft_ref,expected_revision:first.draft_revision});
  expect(next.fields.time).toBeUndefined();expect(next.temporal_missing).toEqual(["time"]);
 });
 it("an invented cancellation cause stays missing and cannot create a proposal",async()=>{
  const state=schedulingState();await applySchedulingInterpretation(actor,state,{operation:"appointment.cancel",customer_name:"Amanda Souza",reason:"Cliente pediu"},"Pedido sintético do cenário");
  expect(state.fields.reason).toBeUndefined();expect(state.draft?.source_missing).toEqual(["reason"]);expect(state.draft?.missing_fields).toContain("reason");
  expect(state.waiting_for).toBe("reason");expect(state.proposal).toBeUndefined();expect(rows.some(r=>r.action==="PROPOSAL"||r.action==="CONFIRMED")).toBe(false);
 });
 it("rejected reason correction preserves prior accepted reason and blocks proposal until a literal replacement",async()=>{
  const fields={customer_name:"Amanda Souza",reason:"pediu para cancelar"};const draft=await upsertSchedulingDraft(db.tx,actor,{operation:"appointment.cancel",fields});
  const state={...schedulingState(),operation:"appointment.cancel" as const,fields,draft};
  await applySchedulingInterpretation(actor,state,{reason:"Ele vai viajar."},"Ele pediu porque vai viajar.");
  expect(state.fields.reason).toBe(fields.reason);expect(state.draft?.source_missing).toEqual(["reason"]);expect(state.proposal).toBeUndefined();
  await applySchedulingInterpretation(actor,state,{reason:"Ele pediu porque vai viajar."},"Ele pediu porque vai viajar.");
  expect(state.fields.reason).toBe("Ele pediu porque vai viajar.");expect(state.draft?.source_missing).toBeUndefined();expect(state.draft?.fields.reason_source?.original_text).toBe(state.fields.reason);
 });
});
