import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {Tx} from "../prisma-tenant";
import {applySchedulingInterpretation,schedulingState} from "../secretary-scheduling";
import {listSchedulingAppointments} from "../scheduling-catalog";
import {locateSchedulingAppointments} from "../scheduling-mutations";
const db=vi.hoisted(()=>({tx:undefined as unknown as Tx}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,fn:(tx:Tx)=>unknown)=>fn(db.tx)}));
vi.mock("../scheduling-catalog",async original=>({...await original<object>(),schedulingTimezone:async()=>"America/Sao_Paulo",assertSchedulingAccess:async()=>undefined,
 listSchedulingAppointments:vi.fn(async()=>[]),getSchedulingAppointment:vi.fn(async(_tx:unknown,_actor:unknown,ref:string)=>({appointment_ref:ref,customer_name:"Cliente",services:[],start_local:"2027-04-13T10:00",timezone:"America/Sao_Paulo",professional_name:"Equipe",status:"CONFIRMED"})),
 listSchedulingProfessionals:vi.fn(async()=>[{id:"professional",name:"Equipe"}]),
}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>"OWNER",locateSchedulingAppointments:vi.fn(async()=>[{appointment_ref:"a",customer_name:"Cliente",start_local:"2027-04-13T10:00",professional_name:"Equipe"},{appointment_ref:"b",customer_name:"Cliente",start_local:"2027-04-13T14:00",professional_name:"Equipe"}])}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),searchSalonCustomer:async()=>[{id:"customer",name:"Cliente"}]}));
const actor={salonId:"salon",userId:"owner"};
type Row={id?:string;entityId?:string;action?:string;metadata?:unknown;[key:string]:unknown};
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2027-04-12T12:00:00Z"));vi.clearAllMocks();
 const rows:Row[]=[],filtered=(where:Row)=>rows.filter(r=>Object.entries(where).every(([k,v])=>r[k]===v));
 db.tx={$executeRaw:vi.fn(async()=>0),auditLog:{create:vi.fn(async({data}:{data:Row})=>{rows.push(structuredClone(data));return data}),findMany:vi.fn(async({where}:{where:Row})=>filtered(where)),findFirst:vi.fn(async({where}:{where:Row})=>filtered(where)[0]??null)}} as unknown as Tx;
 const appointments=["10:00","14:00"].map((time,i)=>({appointment_ref:String(i),customer_ref:"customer",professional_ref:"professional",service_ref:"service",customer_name:"Cliente",professional_name:"Equipe",start_at:"2027-04-13T13:00:00.000Z",end_at:"2027-04-13T14:00:00.000Z",start_local:"2027-04-13T"+time,end_local:"2027-04-13T15:00",timezone:"America/Sao_Paulo",status:"CONFIRMED" as const,revision:1,priceCents:5000,services:[]}));
 vi.mocked(listSchedulingAppointments).mockResolvedValue(appointments as Awaited<ReturnType<typeof listSchedulingAppointments>>);
});
afterEach(()=>vi.useRealTimers());
describe("read fields stay effective through actual draft preparation",()=>{
 it("negated mutation plus explicit read retains selectors and returns only the exact clock",async()=>{
  const state=schedulingState();await applySchedulingInterpretation(actor,state,{operation:"appointment.read",customer_name:"Cliente",weekday:2,time:"10:00"},"Não cancele o Cliente de terça às dez; quero consultar.");
  expect(state.fields).toMatchObject({date:"2027-04-13",time:"10:00",customer_ref:"customer"});expect(state.draft?.status).toBe("READY");expect(state.draft?.temporal_missing).toBeUndefined();expect(state.candidates).toBeUndefined();expect(state.appointments?.map(r=>r.appointment_ref)).toEqual(["0"]);expect(state.proposal).toBeUndefined();
 });
 it("period-only list needs no exact clock even if proof incorrectly labels the period as time",async()=>{
  const state=schedulingState();await applySchedulingInterpretation(actor,state,{operation:"appointment.list",professional_name:"Equipe",weekday:2,period:"morning",temporal_evidence:[{field:"date",text:"terça de manhã"},{field:"time",text:"de manhã"}]},"Quem atende com Equipe na terça de manhã?");
  expect(state.fields).toMatchObject({date:"2027-04-13",period:"morning",professional_ref:"professional"});expect(state.draft?.missing_fields).toEqual([]);expect(state.draft?.temporal_missing).toBeUndefined();expect(state.appointments).toHaveLength(1);expect(state.appointments?.[0].start_local).toBe("2027-04-13T10:00");expect(state.proposal).toBeUndefined();
 });
 it("orphan source proof allows factual candidate lookup and keeps destination intact",async()=>{
  const state=schedulingState();await applySchedulingInterpretation(actor,state,{operation:"appointment.change",customer_name:"Cliente",weekday:4,time:"16:00",temporal_evidence:[{field:"source_date",text:"quinta"},{field:"time",text:"às 16h"}]},"Mude uma das reservas do Cliente para quinta às 16h.");
  expect(locateSchedulingAppointments).toHaveBeenCalledTimes(1);expect(state.fields).toMatchObject({date:"2027-04-15",time:"16:00"});expect(state.draft?.temporal_missing).toBeUndefined();expect(state.candidates?.kind).toBe("appointment_ref");expect(state.candidates?.items).toHaveLength(2);expect(state.proposal).toBeUndefined();
 });
 it("an incomplete bounded day query cannot become a false complete empty result after clock filtering",async()=>{
  const [row]=await listSchedulingAppointments(db.tx,actor,{date:"2027-04-13"});
  vi.mocked(listSchedulingAppointments).mockResolvedValue(Array.from({length:51},(_,i)=>({...row,appointment_ref:String(i),start_local:"2027-04-13T09:00"})));
  const state=schedulingState();await applySchedulingInterpretation(actor,state,{operation:"appointment.list",weekday:2,time:"10:00"},"Consulte terça às dez.");
  expect(state.appointments).toBeUndefined();expect(state.message).toContain("Muitos agendamentos");expect(state.proposal).toBeUndefined();
 });
 it("a create with only a period still cannot prepare a confirmable exact appointment",async()=>{
  const state=schedulingState();await applySchedulingInterpretation(actor,state,{operation:"appointment.create",weekday:2,period:"morning",temporal_evidence:[{field:"date",text:"terça de manhã"},{field:"time",text:"de manhã"}]},"Agende terça de manhã.");
  expect(state.draft?.missing_fields).toContain("time");expect(state.fields.time).toBeUndefined();expect(state.proposal).toBeUndefined();
 });
});
