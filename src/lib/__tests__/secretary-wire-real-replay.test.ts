import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Duplicate-service guard (owner, 04/10/2026; its own tests: secretary-existing-service.test.ts): these scenarios have no service
// catalog, so the guard passes the interpretation through and the flow is exactly the one this file covered before.
vi.mock("../secretary-existing-service", async original => ({ ...await original<object>(), withExistingServiceTargets: async (_actor: unknown, selection: unknown) => selection,
  existingServiceInterpretation: async (_actor: unknown, interpretation: unknown) => interpretation }));
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import evidence from '../../test/fixtures/secretary-real-wire-golden3.json';
import dispositionEvidence from '../../test/fixtures/secretary-real-wire-golden4-disposition.json';
const db=vi.hoisted(()=>({logs:[] as Record<string,unknown>[],drafts:new Map<string,Record<string,unknown>>(),upsert:vi.fn(),propose:vi.fn(),confirm:vi.fn()}));
vi.mock('../prisma-tenant',()=>({withTenant:async(_actor:unknown,fn:(tx:unknown)=>unknown)=>fn({
  $executeRaw:async()=>0,
  $queryRaw:async(query:readonly string[]|{sql?:string})=>{
    const sql=Array.isArray(query)?query.join(''):(query as {sql?:string}).sql??'';
    return sql.includes('"Membership"')?[{role:'OWNER'}]:[{accessStatus:'APPROVED',timezone:'America/Sao_Paulo',currency:'BRL'}];
  },auditLog:{create:async({data}:{data:Record<string,unknown>})=>{db.logs.push(structuredClone(data));return data;},
    findMany:async({where}:{where:Record<string,unknown>})=>db.logs.filter(row=>Object.entries(where).every(([key,value])=>row[key]===value)),
    findFirst:async({where}:{where:Record<string,unknown>})=>db.logs.find(row=>Object.entries(where).every(([key,value])=>row[key]===value))??null},
})}));
vi.mock('../service-create-mvp',async original=>({...await original<object>(),upsertActionDraft:db.upsert,proposeServiceCreate:db.propose,confirmServiceCreate:db.confirm}));
vi.mock('../customer-catalog',async original=>({...await original<object>(),customerDuplicates:async()=>[]}));
import { SalonSecretary } from '../salon-secretary';
import { createPaidModel, createServicesAgent, runServicesTurn, measureServicesModel, withConversationRouting, selectionTransportSchemaV2, validateSelectionV2, validateExistingPlanPatches, publishedOperation, operationSkill, SecretaryNewRequest, type Model } from '@everflair/salon-secretary';
import { entityExtractionInstructions } from '../../../packages/salon-secretary/src/entity-extraction';
import { temporalEvidenceInstructions } from '../../../packages/salon-secretary/src/scheduling-skill';
import { ScriptedServicesModel } from '../../test/scripted-services-model';
import { expandedWire, turnWire } from '../../test/secretary-wire-schema';

beforeEach(()=>{
  vi.clearAllMocks();db.logs.length=0;db.drafts.clear();
  vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');}));
  db.upsert.mockImplementation(async(_tx,_actor,input)=>{
    const draft_ref=input.draft_ref??crypto.randomUUID(),fields={...db.drafts.get(draft_ref),...input.patch};db.drafts.set(draft_ref,fields);
    const missing_fields=['name','priceCents','durationMin'].filter(key=>fields[key]===undefined);
    return {draft_ref,draft_revision:(input.expected_revision??0)+1,fields,status:missing_fields.length?'NEEDS_INPUT':'READY',missing_fields};
  });
  db.propose.mockImplementation(async(_tx,_actor,input)=>({...input,proposal_ref:crypto.randomUUID(),payload_hash:'backend-hash',preview:JSON.stringify(db.drafts.get(input.draft_ref)),expires_at:new Date(Date.now()+60000).toISOString()}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const raw=(id:string)=>evidence.rows.find(row=>row.caseId===id)!;
async function offline(argumentsText:string,tool='select_capabilities'){
  const requests:Record<string,unknown>[]=[];
  const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({id:'resp_offline',object:'response',created_at:0,status:'completed',model:'gpt-6-luna',output:[{id:'fc_offline',call_id:'call_offline',type:'function_call',name:tool,arguments:argumentsText,status:'completed'}],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}),{status:200,headers:{'content-type':'application/json'}});
  });
  vi.stubGlobal('fetch',transport);
  const model=await createPaidModel({SALON_SECRETARY_ALLOW_PAID_CALLS:'true',SALON_SECRETARY_MODEL:'gpt-6-luna',SALON_SECRETARY_OPENAI_API_KEY:'synthetic-offline-not-a-key',SALON_SECRETARY_OPENAI_PROJECT:'proj_offline'});
  return {model,transport,requests};
}
// Explicit recorded-input compatibility. No HTTP provider or live-wire claim.
async function recorded(argumentsText:string,tool='select_capabilities'){
  const model=new ScriptedServicesModel([[{type:'function_call',callId:'recorded_call',name:tool,arguments:argumentsText}]]);
  const transport=vi.fn();return {model:measureServicesModel(model,'recorded-replay',()=>transport()),transport,requests:model.requests};
}
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
describe('unmodified actual Luna arguments through explicit recorded-input and application boundary',()=>{
  it.each(['GF01','GF02','GF03','GF27'])('%s survives neutral provenance without any prefilled defaults',async id=>{
    const row=raw(id),before=row.arguments,payload=JSON.parse(before),f=await recorded(before,row.tool);
    expect(sha(before)).toBe(row.argumentsSha256);
    const result=await withConversationRouting(()=>runServicesTurn(f.model,row.message,{}, {},'discovery',true));
    expect(result.operations.map(op=>op.operation)).toEqual(payload.operations.map((op:{operation:string})=>op.operation));
    for(let i=0;i<payload.operations.length;i++){
      const {temporal_evidence,...domain}=payload.operations[i];expect(temporal_evidence).toEqual([]);
      expect(result.operations[i]).toMatchObject(domain);expect(result.operations[i]).not.toHaveProperty("temporal_evidence");
    }
    expect(row.arguments).toBe(before);expect(f.transport).toHaveBeenCalledOnce();
    // GF27 was the wrong interpreted task. Replay must preserve that diagnosis,
    // not rewrite product.search into the requested stock.movement.
    if(id==='GF27')expect(result.operations[0].operation).toBe('product.search');
  });
  it.each([['GF08','CAPABILITY_FIELD_MISMATCH'],['GF29','SKILL_OPERATION_MISMATCH']])('rejects contradictory original %s without repairing model semantics',async(id,error)=>{
    const row=raw(id),f=await recorded(row.arguments,row.tool);
    await expect(withConversationRouting(()=>runServicesTurn(f.model,row.message,{}, {},'discovery',true))).rejects.toThrow(error);
    expect(f.transport).toHaveBeenCalledOnce();expect(sha(row.arguments)).toBe(row.argumentsSha256);
  });
  it.each(['GF01','GF02','GF03'])('%s reaches actual SalonSecretary, ActionPlan and domain adapters without mutation',async id=>{
    const row=raw(id),f=await recorded(row.arguments,row.tool),actor={salonId:'synthetic-salon',userId:'synthetic-owner'};
    const secretary=new SalonSecretary(async()=>f.model,()=> 'gpt-6-luna',undefined,{}, {enabled:()=>true});
    const session=await secretary.start(actor,'auto'),view=await secretary.send(actor,{sessionId:session.sessionId,message:row.message});
    expect(view.action_plan?.actions).toHaveLength(1);expect(view.operations).toHaveLength(1);
    const action=view.action_plan!.actions[0],child=view.operations![0].state;
    expect(action.operation).toBe(JSON.parse(row.arguments).operations[0].operation);
    if(id==='GF02'){
      expect(child.draft?.fields).toMatchObject({name:'Ritual de Argila',priceCents:9600});
      expect(action.missing_fields).toEqual(['durationMin']);expect(child.proposal).toBeUndefined();
    }else{
      expect(view.action_plan!.status).toBe('READY_FOR_CONFIRMATION');expect(action.missing_fields).toEqual([]);
      if(id==='GF01')expect(child.draft?.fields).toEqual({name:'Brilho de Seda',priceCents:6400,durationMin:40});
      if(id==='GF03'){expect(child.customer?.draft?.fields).toEqual({name:'Joana Torres'});expect(child.customer?.proposal).toBeDefined();}
    }
    expect(db.confirm).not.toHaveBeenCalled();expect(db.logs.some(row=>row.action==='CONFIRMED')).toBe(false);
    expect(f.transport).toHaveBeenCalledOnce();expect(sha(row.arguments)).toBe(row.argumentsSha256);
  });
});

// Current synthetic LIVE fixtures only; archived provider rows above stay byte-identical.
const common={item_key:'action',depends_on:[],released_slot_of:null,source_scope:null};
const scheduling={customer_name:'Pessoa Sintética',service_name:'Serviço Sintético',professional_name:null,date:null,day_offset:1,weekday:null,time:'14:00',period:null,source_date:null,source_day_offset:null,source_weekday:null,source_time:null,end_time:null,end_date:null,reason:null,temporal_evidence:[{field:'date',text:'amanhã'},{field:'time',text:'14h'}]};
const competent=[
  {operation:'service.create',...common,target_name:null,name:'Serviço Sintético',priceCents:8500,durationMin:40},
  {operation:'customer.create',...common,target_name:null,name:'Pessoa Sintética',phone:null,email:null,requested_fields:[],clear_fields:[]},
  {operation:'appointment.create',...common,...scheduling,destination_mode:null,override_requested:null,override_reason:null},
  {operation:'appointment.read',...common,...scheduling},
  {operation:'stock.balance',...common,inventory:{product_name:'Produto Sintético',low_stock:false,mode:null,quantity:null,reason:null,reference:null}},
  {operation:'stock.movement',...common,inventory:{product_name:'Produto Sintético',low_stock:false,mode:'IN',quantity:3,reason:null,reference:null}},
  {operation:'financial.report',...common,financial:{metrics:['received_revenue'],period:'this_week',compare_period:null,group_by:null}},
  {operation:'customer.message',...common,communication:{recipient_name:'Pessoa Sintética',channel:'WHATSAPP',message_mode:'EXACT',content:'Mensagem literal.'}},
];
describe('discriminated decoding and provenance separation',()=>{
  it.each(competent)('serializes operation first and accepts a competent raw $operation branch through the actual SDK',async operation=>{
    const legacyProof=(operation as {temporal_evidence?:{field:string;text:string}[]}).temporal_evidence;
    const wireOperation:Record<string,unknown>=legacyProof?{...operation,day_offset:{value:1,literal:'amanhã'},time:{value:'14:00',literal:'14h'}}:{...operation};
    delete wireOperation.temporal_evidence;
    if(operation.operation==='stock.movement')wireOperation.inventory={...(wireOperation.inventory as Record<string,unknown>),quantity:{value:3,literal:'3 unidades'}};
    const payload={turn:{mode:'NEW',operations:[wireOperation]}};
    const f=await offline(JSON.stringify(payload));
    // Faithful source for this synthetic transport scenario. The semantic oracle
    // remains the competent operation above; the previous placeholder proved no fields.
    const source=legacyProof?'Agende Pessoa Sintética com Serviço Sintético amanhã às 14h.':operation.operation==='stock.movement'?'Entraram 3 unidades de Produto Sintético.':'Dados sintéticos do teste';
    const result=await runServicesTurn(f.model,source,{}, {},'discovery',true);
    expect(result.operations[0]).toMatchObject(operation);
    const sent=f.requests[0] as {tools:{parameters:Parameters<typeof expandedWire>[0]}[]},wire=expandedWire(sent.tools[0].parameters);
    const branches=turnWire(wire,'NEW').properties!.operations.items!.anyOf!;
    expect(branches).toHaveLength(8);
    for(const branch of branches){expect(Object.keys(branch.properties!)[0]).toBe('operation');expect(branch.required![0]).toBe('operation');expect(branch.properties!.operation.description).toBeTruthy();}
    const branch=branches.find(branch=>branch.properties!.operation.enum!.includes(operation.operation))!;
    expect('temporal_evidence' in branch.properties!).toBe(false);
    const validator=new Ajv({allErrors:true}).compile(sent.tools[0].parameters as object);
    expect(validator(payload),JSON.stringify(validator.errors)).toBe(true);
    expect(f.transport).toHaveBeenCalledOnce();
  });
  it.each(publishedOperation.options.filter(op=>operationSkill(op)!=='scheduling'))('%s accepts only structurally empty legacy provenance',operation=>{
    for(const temporal_evidence of [undefined,null,[]]){
      const value=selectionTransportSchemaV2.parse({skills:[operationSkill(operation)],independent:true,operations:[{operation,temporal_evidence}]});
      expect(()=>validateSelectionV2(value)).not.toThrow();
    }
    const value=selectionTransportSchemaV2.parse({skills:[operationSkill(operation)],independent:true,operations:[{operation,temporal_evidence:[{field:'time',text:'11h'}]}]});
    expect(()=>validateSelectionV2(value)).toThrow('CAPABILITY_FIELD_MISMATCH');
  });
  it('retains strict cross-capability guards even after removing provenance from domain keys',()=>{
    const value=selectionTransportSchemaV2.parse({skills:['services'],independent:true,operations:[{operation:'service.create',name:'Serviço',customer_name:'Pessoa',temporal_evidence:[]}]});
    expect(()=>validateSelectionV2(value)).toThrow('CAPABILITY_FIELD_MISMATCH');
  });
  it('publishes the discriminator first inside existing-action field deltas too',async()=>{
    await withConversationRouting(async()=>{
      const agent=createServicesAgent(new ScriptedServicesModel([]) as Model,()=>{},'discovery',true,true),tool=agent.tools[0];
      if(tool.type!=='function')throw Error('TOOL');const wire=expandedWire(tool.parameters);
      for(const branch of turnWire(wire,'PATCH').properties!.operations.items!.properties!.fields.anyOf!)expect(Object.keys(branch.properties!)[0]).toBe('operation');
    },{active_plan:{plan_ref:'20000000-0000-4000-8000-000000000001',actions:[{item_key:'service',operation:'service.change',status:'NEEDS_INPUT'},{item_key:'visit',operation:'appointment.create',status:'NEEDS_INPUT'}]}});
  });
});

it.each([true,false])('empty discovery routing metadata independent=%s is neutral, while real base intent remains conflicting',async independent=>{
  const base={disposition:null,conversation_response:null,unavailable_capability:null,skills:[],independent,operations:[],new_request:{disposition:'SUPPORTED',conversation_response:null,unavailable_capability:null,skills:['services'],independent:true,operations:[competent[0]]},new_request_mode:'ADD',resume_request:null};
  const good=await recorded(JSON.stringify(base));
  await expect(withConversationRouting(()=>runServicesTurn(good.model,'Nova ação',{}, {},'discovery',true))).rejects.toBeInstanceOf(SecretaryNewRequest);
  const bad=await recorded(JSON.stringify({...base,skills:['services'],operations:[competent[0]]}));
  await expect(withConversationRouting(()=>runServicesTurn(bad.model,'Duas rotas',{}, {},'discovery',true))).rejects.toThrow('CONVERSATION_ROUTE_CONFLICT');
});
it('the base extraction and nested scheduling branches retain identical bounded scalar contracts',async()=>{
  await withConversationRouting(async()=>{
    const tool=createServicesAgent(new ScriptedServicesModel([]),()=>{},'scheduling',true).tools[0];
    if(tool.type!=='function')throw Error('TOOL');const wire=expandedWire(tool.parameters),base=turnWire(wire,'CURRENT').properties!.fields.properties!,selection=turnWire(wire,'NEW');
    const create=selection.properties!.operations.items!.anyOf!.find(branch=>branch.properties!.operation.enum!.includes('appointment.create'))!.properties!;
    expect(base.override_reason).toEqual(create.override_reason);expect(base.reason).toEqual(create.reason);expect(base.time).toEqual(create.time);
    expect(base.override_reason.anyOf![0]).toMatchObject({minLength:1,maxLength:200});
  });
});

it('publishes complete shared instructions once while retaining the temporal field constraints',async()=>{
  await withConversationRouting(async()=>{
    const agent=createServicesAgent(new ScriptedServicesModel([]),()=>{},'scheduling',true),tool=agent.tools[0];
    if(tool.type!=='function'||typeof agent.instructions!=='string')throw Error('TOOL');
    expect(agent.instructions.split(entityExtractionInstructions)).toHaveLength(2);
    expect(agent.instructions.split(temporalEvidenceInstructions)).toHaveLength(2);
    expect(JSON.stringify(tool.parameters)).not.toContain(temporalEvidenceInstructions);
    const field=turnWire(expandedWire(tool.parameters),'CURRENT').properties!.fields.properties!.weekday.anyOf!.find(branch=>branch.type==='object')!;
    expect(Object.keys(field.properties!)).toEqual(['value','literal']);
    expect(field.additionalProperties).toBe(false);
    expect(field.properties!.literal).toMatchObject({type:'string',minLength:1,maxLength:600});
  });
});


describe('non-operational disposition is independent from explanatory text',()=>{
  it.each(dispositionEvidence.rows)('replays original GF30 turn $turn through explicit recorded-input compatibility without repairing arguments',async row=>{
    const original=row.arguments,f=await recorded(original,row.tool);
    const result=await withConversationRouting(()=>runServicesTurn(f.model,row.message,{}, {},'discovery',true));
    expect(result).toEqual(JSON.parse(original));expect(sha(original)).toBe(row.argumentsSha256);
    expect(row.arguments).toBe(original);expect(f.transport).toHaveBeenCalledOnce();
  });
  it('completes both original unsupported turns in one real session without a plan, draft, proposal or confirmation',async()=>{
    let current:Model;
    const secretary=new SalonSecretary(async()=>current,()=> 'gpt-6-luna',undefined,{}, {enabled:()=>true});
    const actor={salonId:'synthetic-salon',userId:'synthetic-owner'},session=await secretary.start(actor,'auto');
    for(const row of dispositionEvidence.rows){
      const f=await recorded(row.arguments,row.tool);current=f.model;
      const view=await secretary.send(actor,{sessionId:session.sessionId,message:row.message});
      expect(view.capability_status).toBe('UNSUPPORTED');expect(view.message).toContain('Ainda não consigo cadastrar ou alterar profissionais');
      expect(view.action_plan).toBeUndefined();expect(view.operations??[]).toHaveLength(0);expect(view.proposal).toBeUndefined();expect(view.draft).toBeUndefined();
      expect(f.transport).toHaveBeenCalledOnce();expect(sha(row.arguments)).toBe(row.argumentsSha256);
    }
    expect(db.upsert).not.toHaveBeenCalled();expect(db.propose).not.toHaveBeenCalled();expect(db.confirm).not.toHaveBeenCalled();
    expect(db.logs.some(row=>row.action==='CONFIRMED')).toBe(false);
  });
  it.each(['UNSUPPORTED','AMBIGUOUS'] as const)('%s accepts optional explanation but leaves factual wording to the backend',async disposition=>{
    for(const conversation_response of [null,'Explicação da classificação.']){
      const input={disposition,conversation_response,unavailable_capability:disposition==='UNSUPPORTED'?'other':null,skills:[],independent:true,operations:[]};
      expect(validateSelectionV2(input)).toEqual(input);
      const f=await recorded(JSON.stringify(input));
      const result=await runServicesTurn(f.model,'Pedido sintético',{}, {},'discovery',true);
      expect(result).toEqual(input);
      const sent=f.requests[0] as {tools:{parameters:Parameters<typeof expandedWire>[0]}[]};
      const schema=expandedWire(sent.tools[0].parameters);
      expect(turnWire(schema,disposition).properties!.response.anyOf![0]).toMatchObject({type:'string',minLength:1,maxLength:600});
      expect(turnWire(schema,disposition).properties).not.toHaveProperty('operations');
    }
  });
  it.each([
    {disposition:'UNSUPPORTED',operations:[{operation:'service.create'}],unavailable_capability:'professional_management',conversation_response:'Não disponível.'},
    {disposition:'AMBIGUOUS',operations:[{operation:'service.create'}],conversation_response:'Preciso de mais detalhes.'},
    {disposition:'SUPPORTED',operations:[{operation:'service.create'}],conversation_response:'Pronto.'},
    {disposition:null,operations:[],conversation_response:'Texto sem classificação.'},
    {disposition:'CONVERSATION',operations:[],conversation_response:null},
    {disposition:'CONVERSATION',operations:[],conversation_response:'Olá.',unavailable_capability:'professional_management'},
    {disposition:'AMBIGUOUS',operations:[],conversation_response:'Qual pedido?',unavailable_capability:'other'},
  ])('keeps contradictions fail-closed across new selection and existing-plan patches: %j',partial=>{
    const input=selectionTransportSchemaV2.parse({skills:partial.operations.length?['services']:[],independent:true,unavailable_capability:null,...partial});
    expect(()=>validateSelectionV2(input)).toThrow('CAPABILITY_DISPOSITION_MISMATCH');
    const patch={...input,operations:input.operations.map(operation=>({...operation,item_key:'current'}))};
    expect(()=>validateExistingPlanPatches(patch,{plan_ref:'synthetic-plan',actions:[{item_key:'current',operation:'service.create',status:'NEEDS_INPUT'}]})).toThrow('CAPABILITY_DISPOSITION_MISMATCH');
  });
  it('never turns unsupported model text claiming success into a factual receipt',async()=>{
    const input={disposition:'UNSUPPORTED',conversation_response:'Operação concluída com sucesso.',unavailable_capability:'financial_mutation',skills:[],independent:true,operations:[]};
    const f=await recorded(JSON.stringify(input)),secretary=new SalonSecretary(async()=>f.model,()=> 'gpt-6-luna',undefined,{}, {enabled:()=>true});
    const actor={salonId:'synthetic-salon',userId:'synthetic-owner'},session=await secretary.start(actor,'auto');
    const view=await secretary.send(actor,{sessionId:session.sessionId,message:'Pedido sintético fora do catálogo.'});
    expect(view.capability_status).toBe('UNSUPPORTED');expect(view.message).not.toContain(input.conversation_response);
    expect(view.action_plan).toBeUndefined();expect(view.operations??[]).toHaveLength(0);
    expect(db.upsert).not.toHaveBeenCalled();expect(db.propose).not.toHaveBeenCalled();expect(db.confirm).not.toHaveBeenCalled();
  });
});


it('runs NEW, short PATCH, casual, topic change, RESUME, correction and ADD through the actual SDK and one real Secretary session',async()=>{
  let current:Model;
  const secretary=new SalonSecretary(async()=>current,()=> 'gpt-6-luna',undefined,{}, {enabled:()=>true});
  const actor={salonId:'synthetic-salon',userId:'synthetic-owner'},session=await secretary.start(actor,'auto');
  let first=true;
  const send=async(turn:Record<string,unknown>,message:string)=>{
    const raw={turn},f=await offline(JSON.stringify(raw),first?'select_capabilities':'upsert_action_draft');first=false;current=f.model;
    const view=await secretary.send(actor,{sessionId:session.sessionId,message});
    const sent=f.requests[0] as {tools:{parameters:object}[]};
    const validate=new Ajv({allErrors:true}).compile(sent.tools[0].parameters);
    expect(validate(raw),JSON.stringify(validate.errors)).toBe(true);expect(f.transport).toHaveBeenCalledOnce();return view;
  };
  const operation={operation:'service.create',item_key:'first',depends_on:[],released_slot_of:null,source_scope:null,target_name:null,name:'Tratamento Sintético',priceCents:6400,durationMin:null};
  let view=await send({mode:'NEW',operations:[operation]},'Cadastra Tratamento Sintético por 64 reais.');
  const originalPlan=view.action_plan!.plan_ref,originalDraft=view.operations![0].state.draft!.draft_ref;
  expect(view.action_plan!.actions[0].missing_fields).toEqual(['durationMin']);
  view=await send({mode:'PATCH',operations:[{item_key:'first',fields:{operation:null,source_scope:null,target_name:null,name:null,priceCents:null,durationMin:45}}]},'Quarenta e cinco minutos.');
  expect(view.action_plan!.status).toBe('READY_FOR_CONFIRMATION');
  expect(view.operations![0].state.draft).toMatchObject({draft_ref:originalDraft,fields:{name:'Tratamento Sintético',priceCents:6400,durationMin:45}});
  view=await send({mode:'CONVERSATION',response:'De nada!'},'Obrigada.');
  expect(view.capability_status).toBe('CONVERSATION');expect(view.message).toBe('De nada!');expect(view.action_plan!.plan_ref).toBe(originalPlan);
  view=await send({mode:'NEW',operations:[{...operation,item_key:'second',name:'Outro Serviço',priceCents:9800,durationMin:60}]},'Agora cadastra Outro Serviço por 98 reais, uma hora.');
  expect(view.action_plan!.plan_ref).not.toBe(originalPlan);expect(view.suspended_plans?.some(plan=>plan.plan_ref===originalPlan)).toBe(true);
  expect(view.operations![0].state.draft!.fields).toEqual({name:'Outro Serviço',priceCents:9800,durationMin:60});
  view=await send({mode:'RESUME',plan_ref:originalPlan,patches:null},'Volta ao primeiro pedido.');
  expect(view.action_plan!.plan_ref).toBe(originalPlan);expect(view.operations![0].state.draft!.draft_ref).toBe(originalDraft);
  view=await send({mode:'PATCH',operations:[{item_key:'first',fields:{operation:null,source_scope:null,target_name:null,name:null,priceCents:0,durationMin:null}}]},'Esse serviço será gratuito.');
  expect(view.operations![0].state.draft!.fields).toEqual({name:'Tratamento Sintético',priceCents:0,durationMin:45});
  view=await send({mode:'ADD',operations:[{...operation,item_key:'third',name:'Serviço Adicional',priceCents:7200,durationMin:30}]},'Acrescenta Serviço Adicional por 72 reais e meia hora.');
  expect(view.action_plan!.actions).toHaveLength(2);expect(view.action_plan!.actions.map(action=>action.key)).toEqual(['first','third']);
  expect(view.operations![0].state.draft!.fields).toEqual({name:'Tratamento Sintético',priceCents:0,durationMin:45});
  expect(view.operations![1].state.draft!.fields).toEqual({name:'Serviço Adicional',priceCents:7200,durationMin:30});
  expect(db.confirm).not.toHaveBeenCalled();expect(db.logs.some(row=>row.action==='CONFIRMED')).toBe(false);
});

it.each(['appointment.create','appointment.read','stock.movement'])('old synthetic placeholder cannot prove new literal fields for %s or fabricate an accepted repair',async id=>{
  const operation=competent.find(item=>item.operation===id)!;
  const wireOperation:Record<string,unknown>={...operation};delete wireOperation.temporal_evidence;
  if(id==='stock.movement')wireOperation.inventory={...(wireOperation.inventory as Record<string,unknown>),quantity:{value:3,literal:'3 unidades'}};
  else Object.assign(wireOperation,{day_offset:{value:1,literal:'amanhã'},time:{value:'14:00',literal:'14h'}});
  const payload={turn:{mode:'NEW',operations:[wireOperation]}},before=JSON.stringify(payload),f=await offline(before);
  await expect(runServicesTurn(f.model,'Dados sintéticos do teste',{}, {},'discovery',true)).rejects.toThrow('SOURCE_LITERAL_REPAIR_INVALID');
  expect(f.transport).toHaveBeenCalledTimes(2);expect(JSON.stringify(payload)).toBe(before);
  expect(db.upsert).not.toHaveBeenCalled();expect(db.propose).not.toHaveBeenCalled();expect(db.confirm).not.toHaveBeenCalled();
});
