import { describe, expect, it } from "vitest";
import { createActionPlan } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
import { clarificationContext } from "../secretary-clarification";
import { collectedActionFields } from "../secretary-action-plan";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import { schedulingState } from "../secretary-scheduling";

const now = new Date("2026-09-26T12:00:00Z");
describe("conversation state invariants across interpretation and domain projection", () => {
  it("carries the actual clarification target and accepted destination without leaking refs", () => {
    expect(clarificationContext({operation:"appointment.change", fields:{time:"09:00",customer_ref:"private",override_reason_source:{text:"private"},reason_source:{text:"private"}}, missing_fields:["source_time"], waiting_for:"source_time", message:"Qual era o horário original?"})).toEqual({
      operation:"appointment.change", fields:{time:"09:00"}, clarification:{missing_fields:["source_time"],requested_field:"source_time",previous_response:"Qual era o horário original?"},
    });
  });
  it("does not choose a clarification target with multiple omissions", () => {
    expect(clarificationContext({fields:{},missing_fields:["date","time"],message:"Qual dia e horário?"}).clarification.requested_field).toBeNull();
  });
  it("projects only effective scheduling values: removed selectors never resurrect from initial Luna", () => {
    const p = createActionPlan(plan([intent("appointment.change",{item_key:"move",customer_name:"Lara Matos",source_time:"11:00",time:"09:00",day_offset:1})]));
    const fields = collectedActionFields({sessionId:"test",cancelled:false,message:"Informe a origem",scheduling:{...schedulingState(),fields:{customer_name:"Lara Matos",date:"2026-09-27",time:"09:00"}}},p.actions[0]);
    expect(fields).toMatchObject({customer_name:"Lara Matos",date:"2026-09-27",time:"09:00"});
    expect(fields).not.toHaveProperty("source_time"); expect(fields).not.toHaveProperty("day_offset");
  });
  it.each([
    ["mude de domingo às dez para segunda às onze",{source_weekday:0,source_time:"10:00",weekday:1,time:"11:00"}],
    ["remarque de 27/09/2026 às 10:30 para 28/09/2026 às 15h",{source_date:"2026-09-27",source_time:"10:30",date:"2026-09-28",time:"15:00"}],
    ["troque de amanhã às onze para depois de amanhã às dez e meia",{source_day_offset:1,source_time:"11:00",day_offset:2,time:"10:30"}],
  ] as const)("validates explicit roles separately: %s", (message, patch) => {
    const correct = groundSchedulingTemporal({},patch,message,"America/Sao_Paulo",now,undefined,"appointment.change");
    expect(correct.rejected).toEqual([]);
    const swapped = groundSchedulingTemporal({},{...patch,source_time:patch.time,time:patch.source_time},message,"America/Sao_Paulo",now,undefined,"appointment.change");
    expect(swapped.rejected.map(r=>r.field)).toEqual(expect.arrayContaining(["source_time","time"]));
  });
  it("a destination correction preserves the accepted origin", () => {
    const before={source_date:"2026-09-27",source_time:"11:00",date:"2026-09-28",time:"09:00",customer_name:"Lara Matos"};
    const after=groundSchedulingTemporal(before,{day_offset:3,time:"14:00"},"Não, depois, dia 29 às 14h.","America/Sao_Paulo",now,undefined,"appointment.change");
    expect(after.rejected).toEqual([]); expect(after.fields).toEqual({...before,date:"2026-09-29",time:"14:00"});
  });
  it("date clarification preserves a different already accepted date role", () => {
    const before={source_time:"11:00",date:"2026-09-28",time:"09:00"};
    const after=groundSchedulingTemporal(before,{source_day_offset:1},"amanhã","America/Sao_Paulo",now,"source_date","appointment.change");
    expect(after.rejected).toEqual([]); expect(after.fields).toEqual({...before,source_date:"2026-09-27"});
  });
  it("validates an interval by start/end roles while the domain still owns duration/conflict",()=>{
    const result=groundSchedulingTemporal({},{day_offset:1,time:"14:00",end_time:"16:00"},"Bloqueie amanhã das quatorze até dezesseis.","America/Sao_Paulo",now,undefined,"schedule.block");
    expect(result.rejected).toEqual([]); expect(result.fields).toEqual({date:"2026-09-27",time:"14:00",end_time:"16:00"});
    expect(groundSchedulingTemporal({},{day_offset:1,time:"16:00",end_time:"14:00"},"Bloqueie amanhã das 14h às 16h.","America/Sao_Paulo",now,undefined,"schedule.block").rejected.map(r=>r.field)).toEqual(["time","end_time"]);
  });
  it("preserves and validates roles across every distinct pair of whole hours",()=>{
    for(let a=0;a<24;a++)for(let b=0;b<24;b++)if(a!==b){
      const source_time=`${String(a).padStart(2,"0")}:00`,time=`${String(b).padStart(2,"0")}:00`;
      const text=`Remarque de ${a}h para ${b}h.`;
      expect(groundSchedulingTemporal({},{source_time,time},text,"America/Sao_Paulo",now,undefined,"appointment.change").rejected).toEqual([]);
      expect(groundSchedulingTemporal({},{source_time:time,time:source_time},text,"America/Sao_Paulo",now,undefined,"appointment.change").rejected).toHaveLength(2);
    }
  });
});

it("customer field deletion stays deleted in the effective ActionPlan",()=>{
  const p=createActionPlan(plan([intent("customer.change",{item_key:"edit",target_name:"Lia",email:"previous@example.test"})]));
  const fields=collectedActionFields({sessionId:"test",cancelled:false,message:"Confira",customer:{operation:"customer.change",query:"Lia",target:"private",patch:{email:null},requested:[],message:"Confira"}},p.actions[0]);
  expect(fields.email).toBeNull();expect(fields.clear_fields).toContain("email");
});

it("per-turn temporal evidence never becomes effective ERP state",()=>{
  const p=createActionPlan(plan([intent("appointment.create",{item_key:"visit",customer_name:"Lia",temporal_evidence:[{field:"time",text:"onze horas"}]})]));
  const fields=collectedActionFields({sessionId:"test",cancelled:false,message:"Confira",scheduling:{...schedulingState(),fields:{time:"11:00"}}},p.actions[0]);
  expect(fields).not.toHaveProperty("temporal_evidence");
});

it("conversation snapshots omit transport blanks while preserving accepted values and explicit clears",()=>{
  const fields={name:null,priceCents:0,override_requested:false,phone:null,email:null,clear_fields:["phone","email"],requested_fields:[],financial:null,inventory:null};
  const frozen=structuredClone(fields);
  expect(clarificationContext({fields,missing_fields:["name"],message:"Qual nome?"}).fields).toEqual({priceCents:0,override_requested:false,phone:null,email:null,clear_fields:["phone","email"]});
  expect(fields).toEqual(frozen);
});
