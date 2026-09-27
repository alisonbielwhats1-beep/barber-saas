import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerDTO } from "../customer-contract";
const db = vi.hoisted(()=>({ rows: new Map<string,CustomerDTO & { salonId:string; version:number }>(), logs: [] as Record<string,unknown>[], allowed:true }));
vi.mock("../prisma-tenant",()=>({withTenant:async (actor: {salonId:string;userId:string},fn:(tx:unknown)=>Promise<unknown>)=>fn({
  $executeRaw:async()=>0,
  auditLog:{
    create:async({data}:{data:Record<string,unknown>})=>{db.logs.push(structuredClone(data));return data;},
    findMany:async({where}:{where:Record<string,unknown>})=>db.logs.filter(row=>Object.entries(where).every(([k,v])=>row[k]===v)),
    findFirst:async({where}:{where:Record<string,unknown>})=>db.logs.find(row=>Object.entries(where).every(([k,v])=>row[k]===v))??null,
  },actor,
})}));
vi.mock("../customer-catalog",async importOriginal=>{
  const original=await importOriginal<typeof import("../customer-catalog")>();
  type Actor={salonId:string;userId:string};
  const get=async(_tx:unknown,a:Actor,id:string)=>{const r=db.rows.get(id);if(!db.allowed)throw Error("FORBIDDEN");if(!r||r.salonId!==a.salonId)throw Error("CUSTOMER_NOT_FOUND");return {id:r.id,name:r.name,phone:r.phone,email:r.email};};
  const duplicates=async(_tx:unknown,a:Actor,f:{phone?:string|null;email?:string|null},exclude?:string)=>[...db.rows.values()].filter(r=>r.salonId===a.salonId&&r.id!==exclude&&((f.phone&&r.phone===f.phone)||(f.email&&r.email===f.email))).map(r=>({id:r.id,name:r.name,phone:r.phone}));
  return {...original,
    assertCustomerAccess:async()=>{if(!db.allowed)throw Error("FORBIDDEN");},
    searchSalonCustomer:async(_tx:unknown,a:Actor,q:string)=>[...db.rows.values()].filter(r=>r.salonId===a.salonId&&r.name.toLowerCase().includes(q.toLowerCase())).map(r=>({id:r.id,name:r.name,phone:r.phone})),
    getCustomer:get,customerSnapshot:async(tx:unknown,a:Actor,id:string)=>({customer:await get(tx,a,id),revision:String(db.rows.get(id)!.version)}),customerDuplicates:duplicates,
    executeCustomerPatch:async(tx:unknown,a:Actor,p:object,target?:{id:string;revision:string})=>{
      const patch=original.normalizedCustomerPatch(p);const old=target?await get(tx,a,target.id):undefined;
      if(target&&String(db.rows.get(target.id)!.version)!==target.revision)throw Error("CUSTOMER_CHANGED");
      if((await duplicates(tx,a,{...old,...patch},target?.id)).length)throw Error("DUPLICATE_CANDIDATE");
      const row={id:target?.id??crypto.randomUUID(),name:"",phone:null,email:null,...old,...patch};
      db.rows.set(row.id,{...row,salonId:a.salonId,version:(target?db.rows.get(target.id)!.version:0)+1});return row;
    },
  };
});
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
const actor={salonId:"synthetic-salon",userId:"synthetic-owner"};
const add=(id:string,name="Amanda Souza",salonId=actor.salonId)=>db.rows.set(id,{id,name,phone:"11999990011",email:"old@example.test",salonId,version:1});
async function chat(steps:object[]){const model=new ScriptedServicesModel(steps.map(p=>call("upsert_action_draft",{operation:"customer.create",name:null,phone:null,email:null,target_name:null,requested_fields:[],clear_fields:[],...p})));
  const secretary=new SalonSecretary(async()=>model,()=>"fake-customers");const s=await secretary.start(actor,"customers");return {model,secretary,id:s.sessionId,send:(message:string)=>secretary.send(actor,{sessionId:s.sessionId,message})};}
const confirm=(s:Awaited<ReturnType<SalonSecretary["send"]>>)=>({proposal_ref:s.customer!.proposal!.proposal_ref,draft_revision:s.customer!.proposal!.draft_revision});
beforeEach(()=>{db.rows.clear();db.logs.length=0;db.allowed=true;});
describe("Customers conversation with real SDK/journal and fake catalog (not PostgreSQL evidence)",()=>{
  it("expired session after model response cannot persist draft/proposal",async()=>{
    const c=await chat([{name:"Amanda Souza"}]);const clock=Date.now();const time=vi.spyOn(Date,"now").mockImplementation(()=>clock+(c.model.requests.length?21*60000:0));
    try {await expect(c.send("Cadastre Amanda Souza")).rejects.toThrow("SECRETARY_TURN_FAILED");expect(db.rows.size).toBe(0);expect(db.logs.some(row=>row.entityType==="SECRETARY_CUSTOMERS")).toBe(false);}
    finally {time.mockRestore();}
  });
  it("A/B/J: name sufficient; write only on confirmation; repeat returns original receipt",async()=>{
    const c=await chat([{name:"Amanda Souza"}]);const s=await c.send("Cadastre Amanda Souza");expect(s.customer?.draft?.missing_fields).toEqual([]);expect(db.rows.size).toBe(0);
    const r=await c.secretary.confirm(actor,c.id,confirm(s));expect(r.customer?.receipt?.customer.name).toBe("Amanda Souza");expect(db.rows.size).toBe(1);
    const replay=await c.secretary.confirm(actor,c.id,confirm(s));expect(replay.customer?.receipt).toEqual({...r.customer?.receipt,duplicate:true});expect(db.rows.size).toBe(1);expect(c.model.requests).toHaveLength(1);
  });
  it("C/D: partial phone patch; missing new email asks and keeps same draft",async()=>{
    add("amanda");const c=await chat([{operation:"customer.change",target_name:"Amanda Souza",phone:"11999990022"}]);const s=await c.send("Altere o telefone da Amanda Souza para 11999990022");expect(s.customer?.proposal?.patch).toEqual({phone:"11999990022"});expect(db.rows.get("amanda")?.phone).toBe("11999990011");await c.secretary.confirm(actor,c.id,confirm(s));expect(db.rows.get("amanda")).toMatchObject({name:"Amanda Souza",email:"old@example.test",phone:"11999990022"});
    const d=await chat([{operation:"customer.change",target_name:"Amanda",requested_fields:["email"]},{operation:"customer.change",email:"new@example.test"}]);const first=await d.send("Mude o e-mail da Amanda Souza");expect(first.customer?.draft?.missing_fields).toEqual(["email"]);expect(first.customer?.proposal).toBeUndefined();
    const next=await d.send("new@example.test");expect(next.customer?.draft?.draft_ref).toBe(first.customer?.draft?.draft_ref);expect(next.customer?.proposal?.patch).toEqual({email:"new@example.test"});
  });
  it("E/F/H: ambiguity requires selection; foreign/absent target cannot prepare a proposal",async()=>{
    add("a");add("b","Amanda Silva");add("foreign","Aline","another-salon");
    const c=await chat([{operation:"customer.read",target_name:"Amanda"}]);const s=await c.send("Quem é Amanda?");expect(s.customer?.candidates).toHaveLength(2);expect(s.customer?.customer).toBeUndefined();
    await expect(c.secretary.selectCustomer(actor,c.id,"foreign")).rejects.toThrow("SELECTION_INVALID");await expect(c.secretary.selectCustomer({...actor,salonId:"other"},c.id,"a")).rejects.toThrow("SESSION_NOT_FOUND");
    expect((await c.secretary.selectCustomer(actor,c.id,"b")).customer?.customer?.name).toBe("Amanda Silva");
    const missing=await chat([{operation:"customer.change",target_name:"Aline",phone:"11999990022"}]);expect((await missing.send("Altere Aline")).customer?.draft).toBeUndefined();expect(c.model.requests).toHaveLength(1);
  });
  it("G: duplicate creation blocked, explicit choice reads instead of writing",async()=>{
    add("existing");const c=await chat([{name:"Amanda Souza",phone:"11999990011"}]);const s=await c.send("Cadastre Amanda Souza, telefone 11999990011");expect(s.customer?.duplicate).toBe(true);expect(s.customer?.proposal).toBeUndefined();
    const selected=await c.secretary.selectCustomer(actor,c.id,"existing");expect(selected.customer?.customer?.id).toBe("existing");expect(selected.customer?.proposal).toBeUndefined();expect(db.rows.size).toBe(1);
  });
  it("K: changed version and revoked access reject confirmation",async()=>{
    add("a");const c=await chat([{operation:"customer.change",target_name:"Amanda",phone:"11999990022"}]);const s=await c.send("Mude telefone");db.rows.get("a")!.version++;
    await expect(c.secretary.confirm(actor,c.id,confirm(s))).rejects.toThrow("CUSTOMER_CHANGED");expect(db.rows.get("a")?.phone).toBe("11999990011");
    const d=await chat([{name:"Nova"}]);const p=await d.send("Cadastre Nova");db.allowed=false;await expect(d.secretary.confirm(actor,d.id,confirm(p))).rejects.toThrow("FORBIDDEN");
  });
  it("explicit clear is distinct from omitted; errors do not claim success",async()=>{
    add("a");const c=await chat([{operation:"customer.change",target_name:"Amanda",clear_fields:["email"]}]);const s=await c.send("Remova o e-mail da Amanda");expect(s.customer?.proposal?.patch).toEqual({email:null});await c.secretary.confirm(actor,c.id,confirm(s));expect(db.rows.get("a")?.email).toBeNull();
    const bad=await chat([{name:"Nova",passwordHash:"forged"}]);await expect(bad.send("forged")).rejects.toThrow("SECRETARY_TURN_FAILED");expect(db.rows.size).toBe(1);
  });
});
