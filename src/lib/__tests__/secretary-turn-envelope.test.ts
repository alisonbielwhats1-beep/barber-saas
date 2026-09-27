import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { createServicesAgent,createPaidModel,runServicesTurn,withConversationRouting,decodeConversationTurn,SecretaryNewRequest,SecretaryResumeRequest,type ConversationRoutingContext,type Model,type SecretarySkill } from '@everflair/salon-secretary';
import { ScriptedServicesModel,call } from '../../test/scripted-services-model';
import { expandedWire,turnWire } from '../../test/secretary-wire-schema';
import historical from '../../test/fixtures/secretary-real-wire-golden5-routing.json';

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const active={plan_ref:'10000000-0000-4000-8000-000000000001',actions:[
  {item_key:'price',operation:'service.change',status:'READY_FOR_CONFIRMATION',depends_on:[]},
  {item_key:'finished',operation:'appointment.cancel',status:'DONE',depends_on:[]},
  {item_key:'visit',operation:'appointment.change',status:'NEEDS_INPUT',depends_on:['finished']},
]};
const suspended={plan_ref:'20000000-0000-4000-8000-000000000001',actions:[{item_key:'saved',operation:'service.change',status:'NEEDS_INPUT',depends_on:[]}]};
const context={active_plan:active,suspended_plans:[suspended]};
// Synthetic LIVE fixtures use explicit neutral evidence fields in the published contract.
// Historical provider arguments below are not migrated.
const service=(key='new_service')=>({operation:'service.create',item_key:key,depends_on:[],released_slot_of:null,source_scope:null,target_name:null,name:'Serviço Sintético',priceCents:0,durationMin:30});
const delta={operation:null,source_scope:null,target_name:null,name:null,priceCents:0,durationMin:null};
const modes=[
  {mode:'NEW',operations:[service()]},
  {mode:'ADD',operations:[service()]},
  {mode:'PATCH',operations:[{item_key:'price',fields:delta}]},
  {mode:'RESUME',plan_ref:suspended.plan_ref,patches:{operations:[{item_key:'saved',fields:delta}]}},
  {mode:'CONVERSATION',response:'Bom dia!'},
  {mode:'UNSUPPORTED',unavailable_capability:'professional_management',response:'Ainda indisponível.'},
  {mode:'AMBIGUOUS',response:'Qual pedido deseja fazer?'},
];
const toolschema=()=>{const t=createServicesAgent(new ScriptedServicesModel([]),()=>{},'discovery',true).tools[0];if(t.type!=='function')throw Error('TOOL');return t.parameters;};
async function sdk(raw:unknown,ctx?:ConversationRoutingContext,skill:SecretarySkill|'discovery'='discovery'){
  const text=JSON.stringify(raw),requests:Record<string,unknown>[]=[];
  const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    const request=JSON.parse(String(init?.body));requests.push(request);
    expect(request.tools[0].strict).toBe(true);expect(request.parallel_tool_calls).toBe(false);expect(request.store).toBe(false);
    expect(new Ajv({allErrors:true}).compile(request.tools[0].parameters)(raw)).toBe(true);
    return new Response(JSON.stringify({id:'resp_offline',object:'response',created_at:0,status:'completed',model:'gpt-6-luna',output:[{id:'fc_offline',call_id:'call_offline',type:'function_call',name:skill==='discovery'?'select_capabilities':'upsert_action_draft',arguments:text,status:'completed'}],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}),{status:200,headers:{'content-type':'application/json'}});
  });
  vi.stubGlobal('fetch',transport);
  const model=await createPaidModel({SALON_SECRETARY_ALLOW_PAID_CALLS:'true',SALON_SECRETARY_MODEL:'gpt-6-luna',SALON_SECRETARY_OPENAI_API_KEY:'synthetic-offline-not-a-key',SALON_SECRETARY_OPENAI_PROJECT:'proj_offline'});
  const invoke=()=>(runServicesTurn as (m:Model,message:string,fields:object,requirements:object,skill:SecretarySkill|'discovery',v2:boolean)=>Promise<unknown>)(model,'Mensagem sintética',{}, {},skill,true);
  let value:unknown,error:unknown;
  try{value=await (ctx?withConversationRouting(invoke,ctx):invoke());}catch(caught){error=caught;}
  expect(transport).toHaveBeenCalledOnce();expect(JSON.stringify(raw)).toBe(text);
  return {value,error,requests};
}

describe('decision-first typed envelope matches the actual strict SDK wire',()=>{
  it.each(modes)('serializes and validates only the $mode payload with one inference',async turn=>{
    const input={turn},result=await sdk(input,context);
    expect(result.error).toBeInstanceOf(turn.mode==='RESUME'?SecretaryResumeRequest:SecretaryNewRequest);
    const wire=expandedWire((result.requests[0].tools as {parameters:unknown}[])[0].parameters);
    expect(Object.keys(wire.properties!)).toEqual(['turn']);expect(wire.required).toEqual(['turn']);
    expect(wire.additionalProperties).toBe(false);expect(wire.anyOf).toBeUndefined();
    for(const branch of wire.properties!.turn.anyOf!){expect(Object.keys(branch.properties!)[0]).toBe('mode');expect(branch.required![0]).toBe('mode');expect(branch.additionalProperties).toBe(false);}
    expect(wire.properties!.turn.anyOf!.filter(branch=>new Ajv().compile(branch)(turn))).toHaveLength(1);
    expect(()=>turnWire(wire,'CURRENT')).toThrow();
    if(result.error instanceof SecretaryNewRequest){
      if(['NEW','ADD','PATCH'].includes(turn.mode))expect(result.error.selection.operations[0].priceCents).toBe(0);
      else expect(result.error.selection.operations).toEqual([]);
    }
  });
  it.each([1,2,5,10])('preserves all %i operations without redundant selection metadata',async count=>{
    const operations=Array.from({length:count},(_,i)=>service('item_'+i)),result=await sdk({turn:{mode:'NEW',operations}});
    expect(result.error).toBeUndefined();expect(result.value).toMatchObject({skills:['services'],independent:true,disposition:'SUPPORTED',operations});
  });
  it('preserves mixed reads, writes, graph edges, EXACT text, zero/false and explicit clear',async()=>{
    const operations=[service(),
      {operation:'customer.change',item_key:'contact',depends_on:[],released_slot_of:null,source_scope:null,target_name:'Pessoa Sintética',name:null,phone:null,email:null,requested_fields:[],clear_fields:['email']},
      {operation:'stock.balance',item_key:'balance',depends_on:[],released_slot_of:null,source_scope:null,inventory:{product_name:'Produto Sintético',low_stock:false,mode:null,quantity:null,reason:null,reference:null}},
      {operation:'financial.report',item_key:'read',depends_on:['new_service'],released_slot_of:null,source_scope:null,financial:{metrics:['received_revenue'],period:'today',compare_period:null,group_by:null}},
      {operation:'customer.message',item_key:'message',depends_on:[],released_slot_of:null,source_scope:null,communication:{recipient_name:'Pessoa Sintética',channel:'WHATSAPP',message_mode:'EXACT',content:'Oi.  Pode vir às 11h?'}},
    ];
    const result=await sdk({turn:{mode:'NEW',operations}});
    expect(result.error).toBeUndefined();expect(result.value).toMatchObject({independent:false,operations});
  });
  it('publishes CURRENT only for an isolated adapter, and retains its typed field checks',async()=>{
    const result=await sdk({turn:{mode:'CURRENT',fields:{name:null,priceCents:0,durationMin:null,operation:null,target_name:null}}},{},'services');
    expect(result.error).toBeUndefined();expect(result.value).toEqual({priceCents:0});
    const wire=expandedWire((result.requests[0].tools as {parameters:unknown}[])[0].parameters);
    expect(()=>turnWire(wire,'PATCH')).toThrow();expect(()=>turnWire(wire,'RESUME')).toThrow();
  });
  it.each([
    {mode:'PATCH'}, {mode:'PATCH',operations:null}, {mode:'PATCH',operations:[]},
    {mode:'PATCH',operations:[{item_key:'price',priceCents:0}]},
    {mode:'PATCH',operations:[{item_key:'price',fields:delta}],response:'Outra rota'},
    {mode:'NEW',operations:[]}, {mode:'UNSUPPORTED',unavailable_capability:'other',response:null,operations:[service()]},
    {mode:'CONVERSATION',response:'Olá',operations:[]},
    {mode:'RESUME',plan_ref:active.plan_ref,patches:null},
    {mode:'CURRENT',fields:delta},
  ])('rejects structurally impossible or unavailable decision %j before applying any field',async turn=>{
    await withConversationRouting(async()=>{
      const raw={turn},before=JSON.stringify(raw);
      expect(new Ajv().compile(toolschema())(raw)).toBe(false);
      expect(()=>decodeConversationTurn(raw)).toThrow();expect(JSON.stringify(raw)).toBe(before);
      const receive=vi.fn(),tool=createServicesAgent(new ScriptedServicesModel([]),receive,'discovery',true).tools[0];
      if(tool.type!=='function')throw Error('TOOL');
      await expect(tool.invoke({} as Parameters<typeof tool.invoke>[0],before)).rejects.toThrow();expect(receive).not.toHaveBeenCalled();
    },context);
  });
  it.each([
    {mode:'PATCH',operations:[{item_key:'foreign',fields:delta}]},
    {mode:'PATCH',operations:[{item_key:'finished',fields:{reason:'Causa literal'}}]},
    {mode:'PATCH',operations:[{item_key:'price',fields:{operation:'appointment.change',time:'11:00'}}]},
    {mode:'PATCH',operations:[{item_key:'price',fields:{depends_on:['visit']}}]},
    {mode:'RESUME',plan_ref:suspended.plan_ref,patches:{operations:[{item_key:'price',fields:delta}]}},
  ])('keeps canonical identity, completed actions and graph authority: %j',async turn=>{
    const before=structuredClone(context);
    await withConversationRouting(async()=>expect(()=>decodeConversationTurn({turn})).toThrow(),context);
    expect(context).toEqual(before);
  });
  it('never routes an invalid new envelope through the legacy decoder',async()=>{
    const raw={turn:{mode:'PATCH'},new_request_mode:null,name:null,priceCents:null,durationMin:null};
    const model=new ScriptedServicesModel([call('upsert_action_draft',raw)]);
    await expect(withConversationRouting(()=>runServicesTurn(model,'Resposta curta',{},{}),context)).rejects.toThrow();
    expect(model.requests).toHaveLength(1);
  });
  it.each(historical.rows)('retains historical failure/classification $caseId turn $turn without inventing lost values',async row=>{
    expect(createHash('sha256').update(row.arguments).digest('hex')).toBe(row.sha256);
    const raw=JSON.parse(row.arguments),model=new ScriptedServicesModel([call(row.tool,raw)]);
    if(row.tool==='upsert_action_draft')await expect(withConversationRouting(()=>runServicesTurn(model,'Resposta histórica',{}, {},'scheduling'),context)).rejects.toThrow('CONVERSATION_ROUTE_CONFLICT');
    else{
      const result=await runServicesTurn(model,'Mensagem histórica',{}, {},'discovery',true);
      expect(result.disposition).toBe(raw.disposition);expect(result.operations).toEqual([]);
    }
    expect(model.requests).toHaveLength(1);expect(JSON.stringify(raw)).toBe(row.arguments);
  });
});


it('completed preserved plans expose resume without an impossible mutable patch branch',async()=>{
  const done={...suspended,actions:suspended.actions.map(action=>({...action,status:'DONE'}))};
  await withConversationRouting(async()=>{
    const wire=expandedWire(toolschema());
    expect(turnWire(wire,'RESUME').properties!.patches).toEqual({type:'null'});
    expect(new Ajv().compile(toolschema())({turn:{mode:'RESUME',plan_ref:done.plan_ref,patches:null}})).toBe(true);
    expect(()=>decodeConversationTurn({turn:{mode:'RESUME',plan_ref:done.plan_ref,patches:{operations:[{item_key:'saved',fields:delta}]}}})).toThrow('CONTINUATION_ACTION_MISMATCH');
  },{suspended_plans:[done]});
});

it('keeps identical repeated schemas identical across reference-name digit boundaries',async()=>{
  const operations=['service.create','service.change','customer.create','customer.change','appointment.create','appointment.change','appointment.cancel','stock.movement','financial.report','customer.message'];
  const actions=operations.map((operation,i)=>({item_key:'item_'+i,operation,status:'NEEDS_INPUT'}));
  await withConversationRouting(async()=>{
    const wire=toolschema() as {properties:{turn:{anyOf:{properties:{mode:{enum:string[]};operations?:unknown}}[]}}};
    const modes=wire.properties.turn.anyOf;
    expect(modes.find(branch=>branch.properties.mode.enum[0]==='NEW')!.properties.operations)
      .toEqual(modes.find(branch=>branch.properties.mode.enum[0]==='ADD')!.properties.operations);
  },{active_plan:{...active,actions},suspended_plans:[{...suspended,actions}]});
});
