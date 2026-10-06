import {describe,it,expect} from "vitest";
import {groundSchedulingTemporal} from "../scheduling-temporal-source";
import {groundSchedulingReasons,pendingSourceFields} from "../scheduling-literal-source";
import type {SchedulingFields} from "../scheduling-contract";
import type {SchedulingTemporalEvidence} from "@everflair/salon-secretary";
const now=new Date("2027-04-12T12:00:00Z");
const ground=(text:string,fields:SchedulingFields,evidence:SchedulingTemporalEvidence)=>groundSchedulingTemporal({},fields,text,"America/Sao_Paulo",now,undefined,"appointment.change",evidence);
describe("partial proof is scoped to typed facts and roles",()=>{
 it.each([
  ["Transfere de terça às 13h para quarta às 16h.",2,3,"terça às 13h","quarta às 16h"],
  ["Passa de quinta às 13h para sexta às 16h.",4,5,"quinta às 13h","sexta às 16h"],
 ])("one clock proof per role also proves its unambiguous date: %s",(text,source_weekday,weekday,source,target)=>{
   const result=ground(text,{source_weekday,weekday,source_time:"13:00",time:"16:00"},[{field:"source_time",text:source},{field:"time",text:target}]);
   expect(result.rejected).toEqual([]);expect(result.fields).toMatchObject({source_time:"13:00",time:"16:00",source_date:source_weekday===2?"2027-04-13":"2027-04-15",date:weekday===3?"2027-04-14":"2027-04-16"});
 });
 it("a date with no companion date atom still uses its explicit legacy role scope",()=>{
   const result=ground("Transfere de terça às duas para quarta às quatro.",{source_weekday:2,weekday:3},[{field:"source_time",text:"às duas"},{field:"time",text:"às quatro"}]);
   expect(result.fields).toMatchObject({source_date:"2027-04-13",date:"2027-04-14"});
   expect(result.rejected.map(r=>r.field).sort()).toEqual(["source_time","time"]); // Never infer missing model clocks.
 });
 it("a single operational role can retain its date when only a clock quote was supplied",()=>{
   const result=ground("Altere uma reserva para quinta às 16h.",{weekday:4,time:"16:00"},[{field:"time",text:"16h"}]);
   expect(result.fields).toEqual({date:"2027-04-15",time:"16:00"});expect(result.rejected).toEqual([]);
 });
 it.each(["hoje consta na terça às 14h","amanhã vamos rever a reserva de terça às 14h"])("a disconnected discourse date does not override an explicit weekday: %s",source=>{
   const text="Na quarta às 16h fica melhor; "+source;
   const result=ground(text,{weekday:3,time:"16:00",source_weekday:2,source_time:"14:00"},[{field:"time",text:"Na quarta às 16h"},{field:"source_date",text:source},{field:"source_time",text:source}]);
   expect(result.rejected).toEqual([]);expect(result.fields).toMatchObject({date:"2027-04-14",time:"16:00",source_date:"2027-04-13",source_time:"14:00"});
 });
 it.each([
  ["domingo 17/04/2027",{weekday:0},"domingo 17/04/2027"],
  ["terça ou quarta",{weekday:2},"terça ou quarta"],
  ["depois de amanhã",{day_offset:1},"amanhã"],
  ["domingo 17/04/2027",{date:"2027-04-17"},"domingo 17/04/2027"],
 ] as const)("compound and ambiguous facts remain fail closed: %s",(text,fields,proof)=>{
  const result=ground(text,fields,[{field:"date",text:proof}]);expect(result.fields.date).toBeUndefined();expect(result.rejected).toContainEqual(expect.objectContaining({field:"date"}));
 });
 it("a clock of another role cannot supply a missing date witness",()=>{
   const result=ground("Quinta às 16h é o destino; terça às 14h é a origem.",{weekday:4,source_weekday:2,time:"16:00",source_time:"14:00"},[{field:"source_time",text:"terça às 14h"}]);
   expect(result.fields.source_date).toBe("2027-04-13");expect(result.fields.date).toBeUndefined();
 });
});
describe("literal causes have model-selected semantics and backend provenance",()=>{
 it.each([
  ["reason","Ela pediu porque vai viajar."],
  ["reason","não vai conseguir chegar"],
  ["override_reason","a cliente veio de outra cidade"],
  ["override_reason","ele NÃO está aguardando"],
 ] as const)("retains exact cause and its offsets: %s %s",(field,value)=>{
  const message="Registre o seguinte motivo: "+value;const patch:Record<string,unknown>={[field]:value};
  const result=groundSchedulingReasons(patch,{},message);expect(result).toEqual({accepted:[field],rejected:[]});
  const proof=patch[field==="reason"?"reason_source":"override_reason_source"] as {start:number;end:number;original_text:string};
  expect(message.slice(proof.start,proof.end)).toBe(value);expect(proof.original_text).toBe(value);expect(patch[field]).toBe(value);
 });
 it.each([
  ["reason","Ele vai viajar.","Ele pediu porque vai viajar."],
  ["reason","Cliente pediu","Outro motivo informado"],
  ["override_reason","Joana tem pressa","ela tem pressa"],
  ["override_reason","ele está aguardando","ele não está aguardando"],
 ] as const)("rejects paraphrase/invention while preserving accepted prior state: %s",(field,value,message)=>{
  const previous={[field]:"motivo anteriormente aceito"},patch:Record<string,unknown>={[field]:value};
  const result=groundSchedulingReasons(patch,previous,message);
  expect(result.rejected).toEqual([{code:"SOURCE_REASON_CONFLICT",field,value}]);expect(patch[field]).toBeUndefined();expect(previous[field]).toBe("motivo anteriormente aceito");expect(pendingSourceFields(undefined,result)).toEqual([field]);
 });
 it("pending correction cannot clear through unrelated updates or repeated historical fields",()=>{
  const previous={reason:"motivo aceito"};const repeated={...previous};const result=groundSchedulingReasons(repeated,previous,"mude o horário");
  expect(pendingSourceFields(["reason"],result)).toEqual(["reason"]);expect(repeated).toEqual({});
  const fresh={reason:"novo motivo literal"};expect(pendingSourceFields(["reason"],groundSchedulingReasons(fresh,previous,"novo motivo literal"))).toEqual([]);
 });
 it("consent and reason stay separate facts",()=>{
   expect(()=>groundSchedulingReasons({override_requested:true,override_reason:"a cliente tem pressa"},{},"a cliente tem pressa")).toThrow("OVERRIDE_INTENT_NOT_GROUNDED");
   expect(groundSchedulingReasons({override_reason:"Pode encaixar"},{},"Pode encaixar").rejected).toHaveLength(1);
 });
});

it("repeated accepted dates without new date assertions are not erased by a clock-only correction",()=>{
 const previous={date:"2027-04-14",source_date:"2027-04-13",time:"16:00",source_time:"14:00"};
 const result=groundSchedulingTemporal(previous,{...previous,time:"17:00"},"Mude para 17h","America/Sao_Paulo",now,undefined,"appointment.change",[{field:"time",text:"17h"}]);
 expect(result.fields).toEqual({...previous,time:"17:00"});expect(result.rejected).toEqual([]);
});
it("a literal substring may not discard an explicit negation",()=>{
 const patch={reason:"vai viajar"};const result=groundSchedulingReasons(patch,{},"Ele não vai viajar");
 expect(result.rejected).toEqual([{code:"SOURCE_REASON_CONFLICT",field:"reason",value:"vai viajar"}]);expect(patch).toEqual({});
});

it("another action's negation cannot contaminate the literal cancellation cause",()=>{
 const patch={reason:"vai viajar"};const result=groundSchedulingReasons(patch,{},"Cancela porque vai viajar e não altera o serviço.");
 expect(result.rejected).toEqual([]);expect(patch.reason).toBe("vai viajar");
});
it("NFC/case normalization preserves exact original graphemes and offsets",()=>{
 const message="Motivo: ela está sem TRANSPORTE.",patch:Record<string,unknown>={reason:"ELA ESTA\u0301 SEM TRANSPORTE"};
 const result=groundSchedulingReasons(patch,{},message);expect(result.rejected).toEqual([]);expect(patch.reason).toBe("ela está sem TRANSPORTE");
 const proof=patch.reason_source as {start:number;end:number};expect(message.slice(proof.start,proof.end)).toBe(patch.reason);
});

it("an explicit negation contradicting the previous literal reason cannot be mistaken for a copied old field",()=>{
 const previous={reason:"vai viajar"},patch={reason:"vai viajar"};const result=groundSchedulingReasons(patch,previous,"ele não vai viajar");
 expect(result.rejected).toEqual([{code:"SOURCE_REASON_CONFLICT",field:"reason",value:"vai viajar"}]);expect(patch).toEqual({});expect(previous.reason).toBe("vai viajar");expect(pendingSourceFields(undefined,result)).toEqual(["reason"]);
});
