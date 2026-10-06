import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { goldenSuite } from '../../../packages/salon-secretary/evaluation/free-use-golden';
import { caseSchema, turnExpectationSchema } from '../../../packages/salon-secretary/evaluation/free-use-contract';
import { canSendTurn, observeView, scoreTurn } from '../../../packages/salon-secretary/evaluation/free-use-score';
import { withFreeUseClock } from '../../../packages/salon-secretary/evaluation/free-use-clock';
import { FreeUseBudget, FREE_USE_MISSION_CAP_MICRO_USD, FREE_USE_PRICING_SHA256 } from '../../../packages/salon-secretary/evaluation/free-use-budget';
const url='https://api.openai.com/v1/responses';
function payload(){return {model:'gpt-6-luna',instructions:'synthetic instructions',input:[{role:'user',content:'synthetic message'}],tools:[{type:'function',name:'upsert_action_draft',parameters:{type:'object'}}],tool_choice:{type:'function',name:'upsert_action_draft'},parallel_tool_calls:false,max_output_tokens:1200,store:false,stream:false,include:[]};}
function view(price=6400,status='READY_FOR_CONFIRMATION'){
  return {sessionId:'session',message:'Confira a proposta',action_plan:{plan_ref:'plan',revision:1,actions:[{key:'a',operation:'service.create',mutation:true,status,
    fields:{name:'Brilho',priceCents:price,durationMin:40},missing_fields:[],assessment:{proposal_token:'proposal'}}],confirmation_groups:[{status:'READY_FOR_CONFIRMATION'}]},
    operations:[{operation_ref:'child',action_keys:['a'],state:{draft:{draft_ref:'draft',draft_revision:1,fields:{name:'Brilho',priceCents:price,durationMin:40},missing_fields:[]},proposal:{proposal_ref:'proposal',fields:{name:'Brilho',priceCents:price,durationMin:40}}}}]};
}
describe('free-use frozen runner primitives, offline',()=>{
  it('materializes all 30 original conversations without editing messages or criteria',()=>{
    const suite=goldenSuite(),source=readFileSync('docs/SECRETARY_GOLDEN_FREE_USE_30.md','utf8');
    expect(suite.cases).toHaveLength(30);
    for(const c of suite.cases){const line=source.split(/\r?\n/).find(line=>line.startsWith('| '+c.id+' '))!;const cells=line.split('|').map(cell=>cell.trim());
      expect(c.turns.map(t=>t.message)).toEqual([...cells[2].matchAll(/“([^”]+)”/g)].map(match=>match[1]));expect(c.criterion).toBe(cells[3]);}
    expect(suite.cases.find(c=>c.id==='GF13')!.fixture!.appointments.filter(a=>a.customerKey==='lara')).toHaveLength(2);
    expect(suite.cases.find(c=>c.id==='GF26')!.clock).toBe('2027-04-13T01:30:00Z');
  });
  it('never answers a missing field that the runtime did not ask for',()=>{
    const turn=caseSchema.parse({id:'test1',family:'short reply',criterion:'expected question',turns:[{message:'50 minutos',when:{missingAny:['durationMin']},expect:{}}]}).turns[0];
    const previous=observeView(view());previous.missing=['durationMin','priceCents'];previous.requested=['priceCents'];previous.actions[0].requested=['priceCents'];
    expect(canSendTurn(turn,previous)).toBe(false);
    previous.requested=['durationMin'];previous.actions[0].requested=['durationMin'];
    expect(canSendTurn(turn,previous)).toBe(true);
  });
  it('marks a wrong confirmed amount unsafe instead of counting test volume as readiness',()=>{
    const expected=turnExpectationSchema.parse({actionCount:1,confirmable:true,actions:[{operation:'service.create',effective:{priceCents:6400}}]});
    const score=scoreTurn(expected,observeView(view(1600)),{});
    expect(score.pass).toBe(false);expect(score.metrics.wrongPriceQuantity).toBe(1);expect(score.safety.length).toBe(1);
  });
  it('does not award PASS to unsupported that fakes a plan or confirmation',()=>{
    const observed=observeView({...view(),capability_status:'UNSUPPORTED'});
    const score=scoreTurn(turnExpectationSchema.parse({capabilityStatus:'UNSUPPORTED',actionCount:0,confirmable:false}),observed,{});
    expect(score.pass).toBe(false);expect(score.safety).toContain('NON_OPERATIONAL_PLAN');expect(score.metrics.unsupportedCorrect).toBe(0);
  });
  it('detects stale proposal fields and lost accepted values',()=>{
    const before=observeView(view()),after=observeView(view());delete after.actions[0].effective.priceCents;
    const expected=turnExpectationSchema.parse({actions:[{operation:'service.create',effective:{priceCents:6400},sameDraft:true,preserve:['priceCents'],changedApproval:true}]});
    const score=scoreTurn(expected,after,{},before);expect(score.pass).toBe(false);expect(score.failures).toContain('APPROVAL_NOT_INVALIDATED');expect(score.metrics.validInformationLost).toBeGreaterThan(0);
  });
  it('resolves oracle references only in the scorer',()=>{
    const observed=observeView(view());observed.actions[0].effective.customer_ref='tenant-local-customer';
    expect(scoreTurn(turnExpectationSchema.parse({actions:[{operation:'service.create',effective:{customer_ref:'$ref:customer:a'}}]}),observed,{'customer:a':'tenant-local-customer'}).pass).toBe(true);
    expect(()=>scoreTurn(turnExpectationSchema.parse({actions:[{operation:'service.create',effective:{customer_ref:'$ref:customer:unknown'}}]}),observed,{})).toThrow('FREE_USE_ORACLE_BINDING_UNKNOWN');
  });
  it('restores the clock after success and failure without changing explicit dates',async()=>{
    const original=Date,clock='2027-04-13T01:30:00Z';
    await withFreeUseClock(clock,async()=>{expect(new Date().toISOString()).toBe(clock.replace('Z','.000Z'));expect(new Date('2026-01-01').getUTCFullYear()).toBe(2026);});
    expect(Date).toBe(original);await expect(withFreeUseClock(clock,async()=>{throw Error('stop');})).rejects.toThrow('stop');expect(Date).toBe(original);
  });
  it('reserves durably before transport and keeps limits after recreation',()=>{
    const directory=mkdtempSync(join(tmpdir(),'free-use-budget-')),file=join(directory,'admission.jsonl');
    try{const budget=new FreeUseBudget(file,'binding',1,8192);const input={method:'POST',body:JSON.stringify(payload())};
      budget.reserve('case',1,url,input);expect(readFileSync(file,'utf8')).toContain('STARTED');
      expect(()=>new FreeUseBudget(file,'binding',1,8192).reserve('case',2,url,input)).toThrow('FREE_USE_BUDGET_EXHAUSTED');
      expect(readFileSync(file,'utf8')).not.toContain('synthetic message');
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
  it('rejects a corrupt journal, unsupported endpoint and hosted capability before network',()=>{
    const directory=mkdtempSync(join(tmpdir(),'free-use-budget-')),file=join(directory,'admission.jsonl');
    try{const budget=new FreeUseBudget(file,'binding',2,8192),network=vi.fn();
      expect(()=>budget.reserve('case',1,'https://api.openai.com/v1/other',{method:'POST',body:JSON.stringify(payload())})).toThrow('FREE_USE_WIRE_REQUEST');
      expect(()=>budget.reserve('case',1,url,{method:'POST',body:JSON.stringify({...payload(),tools:[{type:'web_search'}]})})).toThrow();
      expect(network).not.toHaveBeenCalled();writeFileSync(file,'not JSON');expect(()=>new FreeUseBudget(file,'binding',1,8192)).toThrow();
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});

it('binds two same-name customers separately and isolates every case/tenant without reseeding', async () => {
  const { fixtureIdentity, validateFreeUseFixture, seedFreeUseFixture } = await import('../../../packages/salon-secretary/evaluation/free-use-fixture');
  const suite=goldenSuite(),first=fixtureIdentity('run-a','GF13',suite.fixture),second=fixtureIdentity('run-a','GF14',suite.fixture);
  expect(first.tenant).not.toBe(second.tenant);expect(first.actor).not.toBe(first.foreignActor);
  expect(first.bindings['customer:marina_a']).not.toBe(first.bindings['customer:marina_b']);
  expect(first.bindings['service:escova']).toMatch(/^[a-f0-9-]{36}$/);
  expect(validateFreeUseFixture(suite.fixture)).toEqual([]);
  expect(validateFreeUseFixture({...suite.fixture,services:[{...suite.fixture.services[0],professionalKeys:['unknown']}]})).toContain('SERVICE_ELIGIBILITY');
  const transaction=vi.fn(),admin={salon:{count:vi.fn(async()=>1)},$transaction:transaction};
  await expect(seedFreeUseFixture(admin as unknown as import('@prisma/client').PrismaClient,'run-a','GF13',suite.fixture,suite.timezone)).rejects.toThrow('FREE_USE_FIXTURE_ALREADY_EXISTS');
  expect(transaction).not.toHaveBeenCalled();
});

describe('free-use evaluator reviewer regressions',()=>{
  it('rejects GF11 that loses known dates and asks an unrelated field',()=>{
    const expected=goldenSuite().cases.find(c=>c.id==='GF11')!.turns[0].expect;
    const observed=observeView(view());observed.confirmable=false;observed.requested=['date'];observed.missing=['date'];
    observed.actions=[{...observed.actions[0],operation:'appointment.change',fields:{},effective:{},status:'NEEDS_INPUT',approval:undefined,proposal:null,missing:['date'],requested:['date']}];
    const score=scoreTurn(expected,observed,{'appointment:lara_terca':'synthetic-source'});expect(score.pass).toBe(false);expect(score.metrics.unnecessaryQuestions).toBe(1);
    expect(score.failures).toContain('EFFECTIVE:appointment.change:source_date');expect(score.failures).toContain('EFFECTIVE:appointment.change:date');
  });
  it('accepts GF11 period clarification only while known dates and customer survive',()=>{
    const expected=goldenSuite().cases.find(c=>c.id==='GF11')!.turns[0].expect,observed=observeView(view());
    observed.confirmable=false;observed.requested=['time'];observed.missing=['time'];
    observed.actions=[{...observed.actions[0],operation:'appointment.change',fields:{customer_name:'Lara Matos'},effective:{date:'2027-04-14',source_date:'2027-04-13',source_time:'14:00'},status:'NEEDS_INPUT',approval:undefined,proposal:null,missing:['time'],requested:['time']}];
    expect(scoreTurn(expected,observed,{}).pass).toBe(true);
  });
  it('never passes a failed availability read without data',()=>{
    const expected=goldenSuite().cases.find(c=>c.id==='GF21')!.turns[0].expect,observed=observeView(view());observed.confirmable=false;
    observed.actions=[{...observed.actions[0],operation:'availability.get',mutation:false,status:'FAILED_SAFE',approval:undefined,proposal:null,result:undefined,
      effective:{date:'2027-04-14',period:'afternoon',service_ref:'service',professional_ref:'professional'}}];
    const score=scoreTurn(expected,observed,{'service:escova':'service','professional:nina':'professional'});
    expect(score.pass).toBe(false);expect(score.failures).toContain('READ_RESULT_MISSING');expect(score.failures).toContain('ACTION_STATUS:availability.get');
  });
  it('checks availability duration, period, identity and occupied interval independently',()=>{
    const expected=goldenSuite().cases.find(c=>c.id==='GF21')!.turns[0].expect,observed=observeView(view());observed.confirmable=false;
    observed.actions=[{...observed.actions[0],operation:'availability.get',mutation:false,status:'DONE',approval:undefined,proposal:null,
      effective:{date:'2027-04-14',period:'afternoon',service_ref:'service',professional_ref:'professional'},result:[{startLocal:'2027-04-14T14:30',endLocal:'2027-04-14T15:15',professional_ref:'professional'}]}];
    expect(scoreTurn(expected,observed,{'service:escova':'service','professional:nina':'professional'}).failures).toContain('AVAILABILITY_INVALID_INTERVAL');
    observed.actions[0].result=[{startLocal:'2027-04-14T13:00',endLocal:'2027-04-14T13:45',professional_ref:'professional'}];
    expect(scoreTurn(expected,observed,{'service:escova':'service','professional:nina':'professional'}).pass).toBe(true);
  });
  it('distinguishes a preserved task during casual conversation from a new invented action',()=>{
    const prior=observeView(view()),casual=observeView({...view(),capability_status:'CONVERSATION',message:'Bom dia!'});
    const expected=turnExpectationSchema.parse({capabilityStatus:'CONVERSATION',confirmable:false,actionCount:0});
    expect(casual.confirmable).toBe(false);expect(scoreTurn(expected,casual,{},prior).pass).toBe(true);
    casual.actions[0].effective.priceCents=100;expect(scoreTurn(expected,casual,{},prior).safety).toContain('NON_OPERATIONAL_PLAN');
  });
  it('projects batch fields and missing fields per item and cancel fields inside communication',()=>{
    const base=view(),action=base.action_plan.actions[0];
    const actions=[{...action,key:'cancel',operation:'appointment.cancel',assessment:{},missing_fields:['reason'],status:'NEEDS_INPUT'},
      {...action,key:'create',operation:'appointment.create',assessment:{},missing_fields:['customer_ref'],status:'NEEDS_INPUT'}];
    const batch={message:'Informe o motivo',draft:{draft_ref:'shared',plan:{items:[{key:'cancel',fields:{appointment_ref:'old'}},{key:'create',fields:{date:'2027-04-14'}}]},missing_fields:['cancel.reason','create.customer_ref']}};
    const observed=observeView({...base,action_plan:{...base.action_plan,actions},operations:[{operation_ref:'child',action_keys:['cancel','create'],state:{message:'Informe o motivo',batch}}]});
    expect(observed.actions[0].effective).toEqual({appointment_ref:'old'});expect(observed.actions[0].missing).toEqual(['reason']);
    expect(observed.actions[1].effective).toEqual({date:'2027-04-14'});expect(observed.actions[1].missing).toEqual(['customer_ref']);
    const communication={fields:{content:'Mensagem'},cancel:{fields:{appointment_ref:'cancel-target'},draft:{draft_ref:'cancel-draft',fields:{appointment_ref:'cancel-target'},missing_fields:[]}}};
    const cancel=observeView({...base,action_plan:{...base.action_plan,actions:[{...action,operation:'appointment.cancel'}]},operations:[{operation_ref:'child',action_keys:['a'],state:{message:'Confira',communication}}]});
    expect(cancel.actions[0].effective).toEqual({appointment_ref:'cancel-target'});expect(cancel.actions[0].draftRef).toBe('cancel-draft');
  });
  it('reserves across distinct runs under one mission cap and blocks uncertain pricing or oversized input',()=>{
    const directory=mkdtempSync(join(tmpdir(),'free-use-mission-')),file=join(directory,'mission.jsonl');
    try{
      const full={...payload(),max_output_tokens:8192,instructions:'x'.repeat(50_000)},wire={method:'POST',body:JSON.stringify(full)};
      const first=new FreeUseBudget(file,'golden',100),second=new FreeUseBudget(file,'holdout',500);
      for(let i=0;i<100;i++)first.reserve('case',i,url,wire);
      let stopped=false;for(let i=0;i<500;i++){try{second.reserve('case',i,url,wire);}catch(error){expect((error as Error).message).toBe('FREE_USE_BUDGET_EXHAUSTED');stopped=true;break;}}
      expect(stopped).toBe(true);expect(FREE_USE_MISSION_CAP_MICRO_USD).toBe(5_000_000);expect(second.missionReservedUsd).toBeLessThanOrEqual(5);expect(second.missionReservedUsd).toBeGreaterThan(4.98);
      expect(()=>new FreeUseBudget(file,'other',1,8192,'unverified')).toThrow('FREE_USE_BUDGET_CONFIG');
      expect(FREE_USE_PRICING_SHA256).toMatch(/^[a-f0-9]{64}$/);
      expect(()=>second.reserve('case',600,url,{method:'POST',body:JSON.stringify({...payload(),instructions:'x'.repeat(64_000)})})).toThrow('FREE_USE_INPUT_CAP');
      const tampered=readFileSync(file,'utf8').replace('"reservedMicroUsd":','"reservedMicroUsd":1,"ignored":');writeFileSync(file,tampered);
      expect(()=>new FreeUseBudget(file,'other',1)).toThrow('FREE_USE_BUDGET_JOURNAL');
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});

it('tracks the effective pending service context and a resumed prior plan independently of the last turn',()=>{
  const base=view(),pending=observeView({...base,operations:[{operation_ref:'child',action_keys:['a'],state:{message:'Qual serviço?',service_context:{fields:{priceCents:6500},target_name:'Corte'}}}]});
  expect(pending.actions[0].effective).toEqual({priceCents:6500});
  const first=observeView(base),other=observeView({...view(),action_plan:{...base.action_plan,plan_ref:'other-plan'}});
  const expected=turnExpectationSchema.parse({planSameAsTurn:1,actions:[{operation:'service.create',referenceTurn:1,sameDraft:true,preserve:['priceCents']}]});
  expect(scoreTurn(expected,observeView(base),{},other,undefined,'',[first,other]).pass).toBe(true);
  expect(scoreTurn(expected,other,{},other,undefined,'',[first,other]).failures).toContain('PLAN_CONTEXT_LOST');
});

it('verifies the same disposable directory when Windows emits CP1252 bytes instead of UTF8',async()=>{
 const {disposableDirectoryFromHex}=await import('../../../packages/salon-secretary/evaluation/free-use-database');
 const path='C:/Users/Usuário/Temp/everflair-service-mvp-test/data';
 expect(disposableDirectoryFromHex(Buffer.from(path,'latin1').toString('hex'))).toBe(path);
 expect(disposableDirectoryFromHex(Buffer.from(path,'utf8').toString('hex'))).toMatch(/\/everflair-service-mvp-test\/data$/);
 expect(()=>disposableDirectoryFromHex(Buffer.from('C:/production/data').toString('hex'))).toThrow('FREE_USE_DATABASE_DIRECTORY');
 expect(()=>disposableDirectoryFromHex('not hex')).toThrow('FREE_USE_DATABASE_DIRECTORY');
});

describe('typed conditional gates without linguistic inference',()=>{
 const turn=(when:object)=>caseSchema.parse({id:'gate1',family:'conditional',criterion:'typed snapshot only',turns:[{message:'Resposta sintética independente.',when,expect:{}}]}).turns[0];
 it('requires a real conflict review and never infers it from the displayed words',()=>{
  const previous=observeView(view()),gate=turn({operation:'appointment.create',reviewStatusAny:['CONFLICT_OVERRIDABLE'],confirmable:false,proposal:false});
  previous.message='Conflito elegível para encaixe.';previous.confirmable=false;
  previous.actions[0]={...previous.actions[0],operation:'appointment.create',proposal:null,approval:undefined,review:{}};
  expect(canSendTurn(gate,previous)).toBe(false);
  previous.actions[0].review={status:'CONFLICT_HARD_BLOCK'};expect(canSendTurn(gate,previous)).toBe(false);
  previous.actions[0].review={status:'CONFLICT_OVERRIDABLE'};expect(canSendTurn(gate,previous)).toBe(true);
  previous.actions[0].proposal={proposal_ref:'unexpected'};expect(canSendTurn(gate,previous)).toBe(false);
 });
 it('requires requested role, temporal rejection and no executable proposal on the same action',()=>{
  const previous=observeView(view()),gate=turn({operation:'appointment.change',missingAny:['source_time'],temporalMissingAny:['source_time'],confirmable:false,proposal:false});
  previous.confirmable=false;previous.actions[0]={...previous.actions[0],operation:'appointment.change',proposal:null,approval:undefined,requested:['source_time'],temporalMissing:[]};
  expect(canSendTurn(gate,previous)).toBe(false);previous.actions[0].temporalMissing=['time'];expect(canSendTurn(gate,previous)).toBe(false);
  previous.actions[0].temporalMissing=['source_time'];expect(canSendTurn(gate,previous)).toBe(true);
  previous.confirmable=true;expect(canSendTurn(gate,previous)).toBe(false);previous.confirmable=false;
  previous.actions.push({...previous.actions[0],key:'other',temporalMissing:[],requested:['source_time']});previous.actions[0].requested=[];
  expect(canSendTurn(turn({missingAny:['source_time'],temporalMissingAny:['source_time']}),previous)).toBe(false);
 });
 it('projects temporal_missing per batch item and rejects empty or invented predicate names',()=>{
  const base=view(),action=base.action_plan.actions[0];
  const projected=observeView({...base,action_plan:{...base.action_plan,actions:[{...action,operation:'appointment.change'}]},
    operations:[{operation_ref:'child',action_keys:['a'],state:{message:'Confirme a origem',scheduling:{fields:{},draft:{fields:{},temporal_missing:['source_time'],missing_fields:['source_time']}}}}]});
  expect(projected.actions[0].temporalMissing).toEqual(['source_time']);
  const batch=observeView({...base,action_plan:{...base.action_plan,actions:[{...action,key:'old',operation:'appointment.cancel'},{...action,key:'new',operation:'appointment.create'}]},operations:[{operation_ref:'child',action_keys:['old','new'],state:{message:'Revise',batch:{draft:{plan:{items:[{key:'old',fields:{},temporal_missing:['source_time']},{key:'new',fields:{},temporal_missing:['time']}]},missing_fields:[]}}}}]});
  expect(batch.actions[0].temporalMissing).toEqual(['source_time']);expect(batch.actions[1].temporalMissing).toEqual(['time']);
  expect(()=>turn({operation:'appointment.change'})).toThrow();expect(()=>turn({sourceMismatch:true})).toThrow();
 });
});
