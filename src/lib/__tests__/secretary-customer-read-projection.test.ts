import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {Tx} from "../prisma-tenant";
import {runServicesTurn,createActionPlan,type CustomerInterpretation} from "@everflair/salon-secretary";
import {ScriptedServicesModel,call} from "../../test/scripted-services-model";
import {intent,plan} from "../../test/secretary-capability-plan";
import {applyCustomerInterpretation,customerState,selectCustomer,sendCustomerTurn} from "../secretary-customers";
import {assessmentFromView,collectedActionFields,viewProposal} from "../secretary-action-plan";
import {customerReadProjection} from "../customer-contract";
type Row={id:string;salonId:string;name:string;phone:string|null;email:string|null;passwordHash:string};
const db=vi.hoisted(()=>({tx:undefined as unknown as Tx,rows:[] as Row[],role:"OWNER",search:vi.fn(),get:vi.fn(),write:vi.fn(()=>{throw Error("MUTATION_FORBIDDEN");})}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,run:(tx:Tx)=>unknown)=>run(db.tx)}));
vi.mock("../customer-actions",()=>({upsertCustomerDraft:db.write,proposeCustomerChange:db.write,confirmCustomerChange:db.write}));
const actor={salonId:"ours",userId:"owner"},fields=["name","phone","email"] as const;
const source={id:"renata",salonId:"ours",name:"Renata Ribeiro",phone:"11999990011",email:"renata@example.test",passwordHash:"must-never-enter-DTO"};
const payload=(extra:object)=>({operation:"customer.read",target_name:null,name:null,phone:null,email:null,requested_fields:[],clear_fields:[],...extra});
const project=(row:Row,select:Record<string,boolean>)=>Object.fromEntries(Object.entries(row).filter(([key])=>select[key]));
beforeEach(()=>{
 vi.clearAllMocks();db.role="OWNER";db.rows=[{...source},{...source,id:"foreign",salonId:"theirs",name:"Outra Pessoa"}];vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");}));
 db.search.mockImplementation(async({where,select}:{where:{salonId:string;OR:{name?:{contains:string}}[]};select:Record<string,boolean>})=>db.rows.filter(row=>row.salonId===where.salonId&&where.OR.some(q=>q.name&&row.name.toLowerCase().includes(q.name.contains.toLowerCase()))).map(row=>project(row,select)));
 db.get.mockImplementation(async({where,select}:{where:{id:string;salonId:string};select:Record<string,boolean>})=>{const row=db.rows.find(row=>row.id===where.id&&row.salonId===where.salonId);return row?project(row,select):null;});
 db.tx={$queryRaw:vi.fn(async(q:readonly string[])=>q.join("").includes('"Membership"')?[{role:db.role}]:[{accessStatus:"APPROVED"}]),clientProfile:{findMany:db.search,findFirst:db.get,updateMany:db.write,create:db.write},auditLog:{create:db.write},$executeRaw:db.write} as unknown as Tx;
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
describe("customer read projection has a separate role from mutation masks",()=>{
 it.each([["name"],["phone"],["email"],["name","phone","email"]].map(requested_fields=>({requested_fields})))("SDK -> authorized adapter -> effective UI for $requested_fields",async({requested_fields})=>{
  const model=new ScriptedServicesModel([call("upsert_action_draft",payload({target_name:"Renata Ribeiro",requested_fields}))]);
  const result=await runServicesTurn(model,"Consulte os dados da Renata Ribeiro.",{}, {},"customers"),state=customerState();await applyCustomerInterpretation(actor,state,result);
  expect(state.read_fields).toEqual(requested_fields);expect(state.patch).toEqual({});expect(state.requested).toEqual([]);expect(state.draft).toBeUndefined();expect(state.proposal).toBeUndefined();
  expect(Object.keys(state.customer!).sort()).toEqual(["email","id","name","phone"]);expect(state.customer).not.toHaveProperty("passwordHash");
  expect(db.get).toHaveBeenCalledWith({where:{id:"renata",salonId:"ours",mergedIntoId:null},select:{id:true,name:true,phone:true,email:true}});
  for(const field of fields){const label={name:"Nome:",phone:"Telefone:",email:"E-mail:"}[field];expect(state.message.includes(label)).toBe(requested_fields.includes(field));}
  const action=createActionPlan(plan([intent("customer.read",{target_name:"Renata Ribeiro",requested_fields})])).actions[0],view={sessionId:"offline",cancelled:false,message:state.message,customer:state};
  expect(collectedActionFields(view,action)).toMatchObject({requested_fields,target_name:"Renata Ribeiro",name:null,phone:null,email:null,clear_fields:[]});expect(assessmentFromView(view,action)).toMatchObject({status:"DONE",missing_fields:[]});expect(viewProposal(view)).toBeUndefined();expect(db.write).not.toHaveBeenCalled();expect(model.requests).toHaveLength(1);
 });
 it("default full profile remains the fixed authorized DTO",async()=>{
  const state=customerState();await applyCustomerInterpretation(actor,state,{operation:"customer.read",target_name:"Renata Ribeiro"});expect(state.message).toBe("Nome: Renata Ribeiro\nTelefone: 11999990011\nE-mail: renata@example.test");expect(state.read_fields).toBeUndefined();expect(db.write).not.toHaveBeenCalled();
 });
 it("keeps the projection when a later turn supplies only the missing target",async()=>{
  const state=customerState(),model=new ScriptedServicesModel([call("upsert_action_draft",payload({requested_fields:["email"]})),call("upsert_action_draft",payload({target_name:"Renata Ribeiro"}))]);
  await sendCustomerTurn(actor,state,model,"Quero consultar o e-mail.");expect(state.read_fields).toEqual(["email"]);expect(state.customer).toBeUndefined();expect(db.get).not.toHaveBeenCalled();
  await sendCustomerTurn(actor,state,model,"Da Renata Ribeiro.");expect(state.message).toBe("E-mail: renata@example.test");expect(state.read_fields).toEqual(["email"]);expect(state.requested).toEqual([]);expect(db.write).not.toHaveBeenCalled();
 });
 it("preserves the projection through factual ambiguity and explicit selection",async()=>{
  db.rows.push({...source,id:"second",name:"Renata Lima",email:"lima@example.test"});const state=customerState();await applyCustomerInterpretation(actor,state,{operation:"customer.read",target_name:"Renata",requested_fields:["email"]});expect(state.candidates).toHaveLength(2);expect(state.customer).toBeUndefined();
  await expect(selectCustomer(actor,state,"foreign")).rejects.toThrow("SELECTION_INVALID");await selectCustomer(actor,state,"second");expect(state.message).toBe("E-mail: lima@example.test");expect(state.read_fields).toEqual(["email"]);expect(db.write).not.toHaveBeenCalled();
 });
 it("search and read share the same safe display whitelist",async()=>{
  const state=customerState();await applyCustomerInterpretation(actor,state,{operation:"customer.search",target_name:"Renata Ribeiro",requested_fields:["phone"]});expect(state.message).toBe("Telefone: 11999990011");expect(state.patch).toEqual({});expect(state.requested).toEqual([]);expect(db.write).not.toHaveBeenCalled();
 });
 it.each([{name:"Nova"},{phone:"11999990022"},{email:"new@example.test"},{phone:null},{email:null},{clear_fields:["phone"]},{clear_fields:["email"]}])("read cannot contain mutation values or clears: %j",async patch=>{
  const state=customerState();await expect(applyCustomerInterpretation(actor,state,{operation:"customer.read",target_name:"Renata Ribeiro",requested_fields:["email"],...patch} as CustomerInterpretation)).rejects.toThrow("OPERATION_MISMATCH");expect(db.search).not.toHaveBeenCalled();expect(db.get).not.toHaveBeenCalled();expect(db.write).not.toHaveBeenCalled();expect(state.operation).toBeUndefined();
 });
 it.each([["passwordHash"],["salonId"],["role"],["name","phone","email","passwordHash"]].map(requested_fields=>({requested_fields})))("unknown read projection is rejected before IO: $requested_fields",async({requested_fields})=>{
  await expect(applyCustomerInterpretation(actor,customerState(),{operation:"customer.read",target_name:"Renata Ribeiro",requested_fields} as CustomerInterpretation)).rejects.toThrow();expect(db.search).not.toHaveBeenCalled();expect(db.get).not.toHaveBeenCalled();expect(db.write).not.toHaveBeenCalled();
 });
 it("duplicate display labels are canonicalized without arbitrary projection",()=>{expect(customerReadProjection.parse(["phone","phone"])).toEqual(["phone"]);});
 it("read projection grants no additional role permission",async()=>{db.role="PROFESSIONAL";await expect(applyCustomerInterpretation(actor,customerState(),{operation:"customer.read",target_name:"Renata Ribeiro",requested_fields:["email"]})).rejects.toThrow("FORBIDDEN");expect(db.get).not.toHaveBeenCalled();expect(db.write).not.toHaveBeenCalled();});
 it("foreign customer remains invisible under a valid read projection",async()=>{const state=customerState();await applyCustomerInterpretation(actor,state,{operation:"customer.read",target_name:"Outra Pessoa",requested_fields:["email"]});expect(state.customer).toBeUndefined();expect(state.target).toBeUndefined();expect(state.message).toContain("Não encontrei");expect(db.get).not.toHaveBeenCalled();expect(db.write).not.toHaveBeenCalled();});
});
