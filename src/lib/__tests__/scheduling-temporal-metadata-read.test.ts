import {describe,it,expect} from "vitest";
import {groundSchedulingTemporal} from "../scheduling-temporal-source";
import type {SchedulingFields} from "../scheduling-contract";
import type {SchedulingTemporalEvidence} from "@everflair/salon-secretary";
const now=new Date("2027-04-12T12:00:00Z"),tz="America/Sao_Paulo";
const ground=(message:string,fields:SchedulingFields,operation:string,evidence?:SchedulingTemporalEvidence,previous:SchedulingFields={})=>groundSchedulingTemporal(previous,fields,message,tz,now,undefined,operation,evidence);
describe("temporal proof metadata never creates values or requirements",()=>{
 it.each([
  ["Leva uma das reservas para quinta às 16h.",4,"16:00","quinta","às 16h","2027-04-15"],
  ["Transfira uma reserva para sexta às 15h.",5,"15:00","sexta","às 15h","2027-04-16"],
 ] as const)("mislabelled orphan source evidence cannot invent a source selector: %s",(message,weekday,time,dateProof,timeProof,date)=>{
  const result=ground(message,{weekday,time},"appointment.change",[{field:"source_date",text:dateProof},{field:"time",text:timeProof}]);
  expect(result.fields).toEqual({date,time});expect(result.rejected).toEqual([]);
 });
 it.each(["appointment.list","availability.get","appointment.create"])("period proof cannot fabricate an exact clock for %s",operation=>{
  const result=ground("Na terça de manhã",{weekday:2,period:"morning"},operation,[{field:"date",text:"terça de manhã"},{field:"time",text:"de manhã"}]);
  expect(result.fields).toEqual({date:"2027-04-13",period:"morning"});expect(result.rejected).toEqual([]);
 });
 it("evidence still validates a previously accepted value when a new field value was omitted",()=>{
  const result=ground("Agora na quarta.",{},"appointment.create",[{field:"date",text:"quarta"}],{date:"2027-04-13",time:"10:00"});
  expect(result.fields).toEqual({time:"10:00"});expect(result.rejected).toContainEqual(expect.objectContaining({field:"date"}));
 });
 it("actual omitted source facts keep narrowing fail closed independently of metadata labels",()=>{
  const result=ground("Mude de terça às 13h para quinta às 16h.",{weekday:4,time:"16:00"},"appointment.change",[{field:"date",text:"quinta"},{field:"time",text:"às 16h"}]);
  expect(result.fields).toMatchObject({date:"2027-04-15",time:"16:00"});expect(result.rejected.map(r=>r.field).sort()).toEqual(["source_date","source_time"]);
 });
 it("an original-time answer still cannot overwrite a previously accepted destination",()=>{
  const result=groundSchedulingTemporal({time:"09:00"},{time:"11:00"},"11h",tz,now,"source_time","appointment.change",[{field:"time",text:"11h"}]);
  expect(result.fields.time).toBe("09:00");expect(result.rejected.map(r=>r.field).sort()).toEqual(["source_time","time"]);
 });
});
describe("read selectors use factual negation scope",()=>{
 it.each([
  ["Não cancele a reserva de terça às dez; consulte o atendimento.",{weekday:2,time:"10:00"},"2027-04-13","10:00"],
  ["Não mude nada, só mostre a agenda de quinta às 15h.",{weekday:4,time:"15:00"},"2027-04-15","15:00"],
  ["Quarta às 14h, quero consultar. Não altere esse horário.",{weekday:3,time:"14:00"},"2027-04-14","14:00"],
 ] as const)("negated mutation does not erase the selected read's filters: %s",(message,fields,date,time)=>{
  for(const operation of ["appointment.read","appointment.list","availability.get"]){const result=ground(message,fields,operation);expect(result.fields).toEqual({date,time});expect(result.rejected).toEqual([]);}
 });
 it("the same scope applies when literal proof is present",()=>{
  const result=ground("Não cancele a reserva de quinta às 15h; só consulte.",{weekday:4,time:"15:00"},"appointment.read",[{field:"date",text:"quinta"},{field:"time",text:"às 15h"}]);
  expect(result.fields).toEqual({date:"2027-04-15",time:"15:00"});expect(result.rejected).toEqual([]);
 });
 it.each([
  ["Não na terça",{weekday:2},"date"],
  ["Não às 10h",{time:"10:00"},"time"],
  ["Não às dez",{time:"10:00"},"time"],
  ["Nunca em 14/04/2027",{date:"2027-04-14"},"date"],
  ["Não no domingo 18 de abril de 2027",{date:"2027-04-18"},"date"],
 ] as const)("a directly denied factual selector is still rejected: %s",(message,fields,field)=>{
  const result=ground(message,fields,"appointment.read");expect(result.rejected).toContainEqual(expect.objectContaining({field}));expect(result.fields[field]).toBeUndefined();
 });
 it.each(["appointment.create","appointment.change","appointment.cancel"])("does not relax the conservative mutation guard for %s",operation=>{
  const result=ground("Não agende terça às dez.",{weekday:2,time:"10:00"},operation);expect(result.rejected.length).toBeGreaterThan(0);
 });
 it("weekday/calendar contradiction remains blocked for a read",()=>{
  const result=ground("Consulte terça, dia 14 de abril de 2027 às 13h.",{date:"2027-04-14",time:"13:00"},"appointment.list",[{field:"date",text:"terça, dia 14 de abril de 2027"},{field:"time",text:"às 13h"}]);
  expect(result.fields.date).toBeUndefined();expect(result.fields.time).toBe("13:00");expect(result.rejected).toContainEqual(expect.objectContaining({field:"date"}));
 });
});
