import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createServicesAgent, createPaidModel, runServicesTurn, publishedOperation, selectionSchemaV2, selectionTransportSchemaV2, validateSelectionV2,
  withConversationRouting, SecretaryNewRequest, SecretaryResumeRequest, validateExistingPlanPatches, type SecretarySkill, type Model } from '@everflair/salon-secretary';
import { ScriptedServicesModel, call } from '../../test/scripted-services-model';
import { intent, plan } from '../../test/secretary-capability-plan';
import { expandedWire, operationWire, turnWire, suspendedWirePlan } from '../../test/secretary-wire-schema';

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const active={plan_ref:'20000000-0000-4000-8000-000000000001',actions:[
  {item_key:'cancel',operation:'appointment.cancel',status:'DONE',depends_on:[]},
  {item_key:'replacement',operation:'appointment.create',status:'NEEDS_INPUT',depends_on:['cancel']},
  {item_key:'price',operation:'service.change',status:'READY',depends_on:[]},
]};
const context={active_plan:active,suspended_plans:[suspendedWirePlan]};
const stressActions=['service.create','service.change','customer.create','customer.change','appointment.create','appointment.change','appointment.cancel','stock.movement','financial.report','customer.message'].map((operation,i)=>({item_key:'item_'+i,operation,status:'NEEDS_INPUT',depends_on:[],fields:{},clarification:{missing_fields:[],requested_field:null,previous_response:'Questão sintética'}}));
const stressContext={active_plan:{plan_ref:'10000000-0000-4000-8000-000000000001',actions:stressActions},suspended_plans:Array.from({length:5},(_,i)=>({plan_ref:'20000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),actions:stressActions.map(action=>({...action,item_key:action.item_key+'_p'+i}))}))};

const neutral=(operation:string,fields:object={})=>({...intent(operation),...Object.fromEntries(Object.keys(selectionSchemaV2.shape.operations.element.shape).map(key=>[key,['depends_on','requested_fields','clear_fields'].includes(key)?[]:null])),operation,item_key:'action',...fields});
const wireIntent=(operation:string,fields:object={})=>{
  const allowed=operationWire(expandedWire(toolWire()),operation),input=neutral(operation,fields);
  return {...Object.fromEntries(Object.entries(input).filter(([key])=>key in allowed)),...fields};
};
const envelope=(selection:{operations:unknown[]})=>({turn:{mode:'NEW',operations:selection.operations}});
const selection=(operation:string,fields:object={})=>({...plan([neutral(operation)]),operations:[wireIntent(operation,fields)],disposition:'SUPPORTED',conversation_response:null,unavailable_capability:null});
function toolWire(){const tool=createServicesAgent(new ScriptedServicesModel([]),()=>{},'discovery',true).tools[0];if(tool.type!=='function')throw Error('tool');return tool.parameters;}

describe('capability wire reflects backend field guards',()=>{
  it.each(publishedOperation.options)('supports %s without weakening backend validation',operation=>{
    const wire=toolWire(),validate=new Ajv({allErrors:true}).compile(wire);
    const value=selection(operation);
    expect(validate(envelope(value)),JSON.stringify(validate.errors)).toBe(true);
    expect(()=>validateSelectionV2(selectionTransportSchemaV2.parse(value))).not.toThrow();
    const expanded=expandedWire(wire),op=operationWire(expanded,operation);
    expect(op.operation.enum).toContain(operation);
    expect(expanded.type).toBe('object');expect(expanded.anyOf).toBeUndefined();
  });
  it.each([
    ['customer.create',{name:'Cliente Exemplo',customer_name:'Cliente Exemplo'}],
    ['customer.read',{target_name:'Cliente Exemplo',customer_name:'Cliente Exemplo'}],
    ['service.change',{target_name:'Serviço',phone:'11999998888'}],
    ['appointment.create',{customer_name:'Cliente',name:'Cliente'}],
    ['financial.report',{priceCents:100}],
    ['customer.message',{customer_name:'Cliente'}],
    ['appointment.cancel',{override_requested:true}],
    ['stock.balance',{inventory:{product_name:'Produto',mode:'IN',quantity:null,reason:null,low_stock:null}}],
    ['stock.movement',{inventory:{product_name:'Produto',mode:'IN',quantity:2,reason:null,low_stock:true}}],
  ] as const)('rejects cross-capability fields for %s in schema and backend', (operation,fields)=>{
    const validate=new Ajv().compile(toolWire()),value=selection(operation,fields),before=structuredClone(value);
    expect(validate(envelope(value))).toBe(false);expect(()=>validateSelectionV2(selectionTransportSchemaV2.parse(value))).toThrow('CAPABILITY_FIELD_MISMATCH');
    expect(value).toEqual(before);
  });
  it.each([1,2,5,10])('keeps %i actions and their canonical fields',count=>{
    const input={...plan(Array.from({length:count},(_,i)=>neutral('customer.create',{item_key:'person_'+i,name:'Pessoa '+i}))),operations:Array.from({length:count},(_,i)=>wireIntent('customer.create',{item_key:'person_'+i,name:'Pessoa '+i})),disposition:'SUPPORTED',conversation_response:null,unavailable_capability:null};
    expect(new Ajv().compile(toolWire())(envelope(input))).toBe(true);expect(validateSelectionV2(selectionTransportSchemaV2.parse(input)).operations).toHaveLength(count);
  });
});

describe('context-bound existing action deltas',()=>{
  it('decodes a structural fields wrapper and rejects a key bound to another operation',()=>{
    expect(validateExistingPlanPatches({operations:[{item_key:'price',fields:{priceCents:7200}}]},active).operations[0]).toMatchObject({operation:'service.change',priceCents:7200});
    expect(()=>validateExistingPlanPatches({operations:[{item_key:'price',fields:{operation:'appointment.create',time:'11:00'}}]},active)).toThrow('CONTINUATION_ACTION_MISMATCH');
  });
  it('rejects another suspended plan key even when the shared wire can describe it',async()=>{
    const other={plan_ref:'30000000-0000-4000-8000-000000000001',actions:[{item_key:'elsewhere',operation:'service.change',status:'READY'}]};
    await withConversationRouting(async()=>{
      expect(()=>new SecretaryResumeRequest(suspendedWirePlan.plan_ref,{operations:[{item_key:'elsewhere',fields:{priceCents:9000}}]})).toThrow('CONTINUATION_ACTION_MISMATCH');
    },{...context,suspended_plans:[suspendedWirePlan,other]});
  });
  it('requires coherent capability disposition even for an empty patch',()=>{
    for(const input of [{operations:[],disposition:'CONVERSATION'},{operations:[],disposition:'SUPPORTED'},{operations:[],conversation_response:'Texto solto'}])
      expect(()=>validateExistingPlanPatches(input,active)).toThrow('CAPABILITY_DISPOSITION_MISMATCH');
  });
  it('only fills omitted neutral transport fields, retaining valid and incompatible supplied values for backend validation',()=>{
    const raw={...plan([intent('customer.create')]),operations:[{operation:'customer.create',name:'Pessoa Nova'}]};
    const before=structuredClone(raw),normalized=selectionTransportSchemaV2.parse(raw);
    expect(raw).toEqual(before);expect(normalized.operations[0]).toMatchObject({name:'Pessoa Nova',priceCents:null,phone:null,requested_fields:[],clear_fields:[]});
    const bad={...raw,operations:[{...raw.operations[0],customer_name:'Pessoa Nova'}]};
    expect(()=>validateSelectionV2(selectionTransportSchemaV2.parse(bad))).toThrow('CAPABILITY_FIELD_MISMATCH');
  });
  it('derives operation/skill, preserves graph ownership and never restores accepted fields from interpretation',()=>{
    const patch={operations:[{item_key:'replacement',service_name:'Serviço selecionado'}]};
    const before=structuredClone(active),result=validateExistingPlanPatches(patch,active);
    expect(result.skills).toEqual(['scheduling']);expect(result.independent).toBe(true);
    expect(result.operations[0]).toMatchObject({operation:'appointment.create',service_name:'Serviço selecionado',depends_on:[],released_slot_of:null});
    expect(result.operations[0]).not.toHaveProperty('customer_name');expect(active).toEqual(before);
  });
  it('accepts legacy neutral metadata but derives the actual skill instead of requiring it again',()=>{
    const result=validateExistingPlanPatches({skills:[],independent:false,operations:[intent('appointment.create',{item_key:'replacement',service_name:'Serviço'})]},active);
    expect(result.skills).toEqual(['scheduling']);expect(result.operations[0].operation).toBe('appointment.create');
  });
  it.each([
    {item_key:'foreign',priceCents:100}, {item_key:'cancel',reason:'Trecho explícito'},
    {item_key:'price',operation:'customer.change',email:'a@example.test'},
    {item_key:'price',depends_on:['replacement']}, {item_key:'replacement',released_slot_of:'cancel'},
  ])('rejects unknown/DONE/type/graph mutation %j',patch=>{
    expect(()=>validateExistingPlanPatches({operations:[patch]},active)).toThrow('CONTINUATION_ACTION_MISMATCH');
  });
  it('rejects duplicate keys, capability mismatch and foreign skill metadata',()=>{
    expect(()=>validateExistingPlanPatches({operations:[{item_key:'price'},{item_key:'price'}]},active)).toThrow('CONTINUATION_ACTION_MISMATCH');
    expect(()=>validateExistingPlanPatches({operations:[{item_key:'price',customer_name:'Outro cliente'}]},active)).toThrow('CAPABILITY_FIELD_MISMATCH');
    expect(()=>validateExistingPlanPatches({skills:['customers'],operations:[{item_key:'price'}]},active)).toThrow('SKILL_OPERATION_MISMATCH');
  });
  it('routes PATCH and RESUME with only deltas, and rejects current/foreign plan as RESUME',async()=>{
    await withConversationRouting(async()=>{
      expect(new SecretaryNewRequest({operations:[{item_key:'price',priceCents:4500}]},'PATCH').selection.operations[0].operation).toBe('service.change');
      expect(new SecretaryResumeRequest(suspendedWirePlan.plan_ref,{operations:[{item_key:'a',time:'11:00'}]}).patches!.operations[0].operation).toBe('appointment.change');
      expect(()=>new SecretaryResumeRequest(active.plan_ref,null)).toThrow('PLAN_NOT_IN_SESSION');
      expect(()=>new SecretaryResumeRequest('30000000-0000-4000-8000-000000000001',null)).toThrow('PLAN_NOT_IN_SESSION');
      const model=new ScriptedServicesModel([call('select_capabilities',{operations:[{item_key:'price',priceCents:4500}]})]);
      const result=await runServicesTurn(model,'Corrigir o valor',{mode:'CONTINUE_EXISTING_PLAN'},{},'discovery',true);
      expect(result.operations[0]).toMatchObject({item_key:'price',operation:'service.change',priceCents:4500});
    },context);
  });
  it('does not publish resume when the session has zero suspended plans',async()=>{
    await withConversationRouting(async()=>{
      const wire=expandedWire(toolWire());expect(()=>turnWire(wire,'RESUME')).toThrow('MISSING_TURN_MODE:RESUME');
      expect(()=>new SecretaryResumeRequest(active.plan_ref)).toThrow('PLAN_NOT_IN_SESSION');
    },{active_plan:active});
  });
  it('publishes only mutable keys and their canonical operation in PATCH/RESUME',async()=>{
    await withConversationRouting(async()=>{
      const wire=expandedWire(toolWire()),patch=turnWire(wire,'PATCH');

      expect(patch.required).toEqual(['mode','operations']);
      const created=operationWire(patch,'appointment.create');expect(created.item_key.enum).toEqual(['replacement','price']);expect(created.item_key.enum).not.toContain('cancel');
      expect(created.depends_on).toBeUndefined();expect(created.released_slot_of).toBeUndefined();
      expect(()=>operationWire(patch,'appointment.cancel')).toThrow();
      expect(turnWire(wire,'RESUME').properties!.plan_ref.enum).toEqual([suspendedWirePlan.plan_ref]);
    },context);
  });
});

describe('real SDK serialization with a fake transport only',()=>{
  it.each(['discovery','services','customers','scheduling','scheduling-batch','financial','inventory','communication'] as const)('keeps %s below 64k with 10 active + 50 suspended actions and output8192',async skill=>{
    vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS','8192');vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED','true');
    const args={turn:{mode:'PATCH',operations:[{item_key:'item_0',fields:{operation:null,source_scope:null,target_name:null,name:null,priceCents:5000,durationMin:null}}]}};
    const transport=vi.fn(async(_input:unknown,init?:RequestInit)=>{
      const request=JSON.parse(String(init?.body));
      expect(request.max_output_tokens).toBe(8192);expect(request.tools).toHaveLength(1);expect(request.tools[0].strict).toBe(true);
      expect(new Ajv().compile(request.tools[0].parameters)(args)).toBe(true);
      const bytes=Buffer.byteLength(String(init?.body),'utf8');expect(bytes+8192).toBeLessThanOrEqual(64000);
      console.info(JSON.stringify({offlineWire:skill,requestBytes:bytes,inputUpper:bytes+8192,outputCap:8192,activeActions:10,suspendedActions:50}));
      return new Response(JSON.stringify({id:'resp_offline',object:'response',created_at:0,status:'completed',model:'gpt-6-luna',
        output:[{id:'fc_offline',call_id:'call_offline',type:'function_call',name:skill==='discovery'?'select_capabilities':'upsert_action_draft',arguments:JSON.stringify(args),status:'completed'}],
        usage:{input_tokens:20,output_tokens:10,total_tokens:30}}),{status:200,headers:{'content-type':'application/json'}});
    });
    vi.stubGlobal('fetch',transport);
    const model=await createPaidModel({SALON_SECRETARY_ALLOW_PAID_CALLS:'true',SALON_SECRETARY_MODEL:'gpt-6-luna',SALON_SECRETARY_OPENAI_API_KEY:'synthetic-test-key',SALON_SECRETARY_OPENAI_PROJECT:'proj_synthetic'});
    await expect(withConversationRouting(()=>(runServicesTurn as (model:Model,message:string,fields:object,requirements:object,skill:SecretarySkill|'discovery',v2:boolean)=>Promise<unknown>)(model,'Pedido sintético offline',{},{},skill,true),stressContext)).rejects.toBeInstanceOf(SecretaryNewRequest);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
