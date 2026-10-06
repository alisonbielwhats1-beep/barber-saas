import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createServicesAgent, createPaidModel, runServicesTurn, withConversationRouting, withSalonDirectory, SecretaryNewRequest, decodeTemporalEvidencePayload,
  temporalComponentInstructions, componentsTemporalInstructions, type SecretarySkill, type Model } from '@everflair/salon-secretary';
import { invalidSourceLiterals } from '../../../packages/salon-secretary/src/source-literal-repair';
import { ScriptedServicesModel, call } from '../../test/scripted-services-model';
import { FREE_USE_PRICING } from '../../../packages/salon-secretary/evaluation/free-use-budget';
import { expandedWire, operationWire, turnWire, suspendedWirePlan } from '../../test/secretary-wire-schema';

/** C1 wire: components are published only behind SALON_SECRETARY_TEMPORAL_COMPONENTS. */
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const flag=(on:boolean)=>vi.stubEnv('SALON_SECRETARY_TEMPORAL_COMPONENTS',on?'true':'false');
function tool(skill:SecretarySkill|'discovery'='discovery'){
  const agent=createServicesAgent(new ScriptedServicesModel([]),()=>{},skill,true),t=agent.tools[0];
  if(t.type!=='function'||typeof agent.instructions!=='string')throw Error('tool');return {wire:t.parameters,instructions:agent.instructions};
}
const stressActions=['service.create','service.change','customer.create','customer.change','appointment.create','appointment.change','appointment.cancel','stock.movement','financial.report','customer.message'].map((operation,i)=>({item_key:'item_'+i,operation,status:'NEEDS_INPUT',depends_on:[],fields:{},clarification:{missing_fields:[],requested_field:null,previous_response:'Questão sintética'}}));
const stressContext={active_plan:{plan_ref:'10000000-0000-4000-8000-000000000001',actions:stressActions},suspended_plans:Array.from({length:5},(_,i)=>({plan_ref:'20000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),actions:stressActions.map(action=>({...action,item_key:action.item_key+'_p'+i}))}))};

describe('flag off: historical wire and instructions',()=>{
  it('publishes no components container and no components instructions',async()=>{
    flag(false);
    await withConversationRouting(async()=>{
      const {wire,instructions}=tool();
      expect(JSON.stringify(wire)).not.toContain('"components"');expect(instructions).not.toContain(temporalComponentInstructions);
      for(const operation of ['appointment.create','appointment.change','schedule.block'])expect(operationWire(expandedWire(wire),operation)).not.toHaveProperty('components');
    },{suspended_plans:[suspendedWirePlan]});
  });
});

describe('flag on: typed components beside the discouraged legacy selectors',()=>{
  it('publishes a strict nullable container keyed by the existing roles, each a {value,literal} pair',async()=>{
    flag(true);
    await withConversationRouting(async()=>{
      const {wire,instructions}=tool();
      // C6: components mode states the temporal contract once, without the selectors it does not publish (day_offset/weekday).
      expect(instructions.split(temporalComponentInstructions)).toHaveLength(2);expect(instructions.split(componentsTemporalInstructions)).toHaveLength(2);
      const expanded=expandedWire(wire);
      for(const mode of ['NEW','RESUME']){
        const selected=turnWire(expanded,mode),branch=mode==='RESUME'?selected.properties!.patches.anyOf!.find(value=>value.properties)!:selected;
        for(const operation of mode==='NEW'?['appointment.create','appointment.change','schedule.block','appointment.list']:['appointment.change']){
          const fields=operationWire(branch,operation),container=fields.components.anyOf!.find(value=>value.type==='object')!;
          expect(fields.components.anyOf!.map(value=>value.type)).toEqual(['object','null']);
          expect(container.required).toEqual(['date','source_date','end_date','time','source_time','end_time']);expect(container.additionalProperties).toBe(false);
          for(const role of container.required!){
            const pair=container.properties![role].anyOf!.find(value=>value.type==='object')!;
            expect(pair.required).toEqual(['value','literal']);expect(pair.additionalProperties).toBe(false);
            expect(pair.properties!.literal).toEqual({type:'string',minLength:1,maxLength:600,pattern:'\\S'});
            expect(pair.properties!.value.required).toEqual(role.endsWith('date')?['kind','offset','weekday','week','day','month','year','days']:['hour','minute','daypart']);
          }
          // Phase 3a review (64k budget): date/time selectors stay published for published candidate answers;
          // relative-day and weekday selectors, which components state, are not published beside them.
          for(const legacy of ['date','time','source_date','source_time','end_time','end_date'])expect(fields).toHaveProperty(legacy);
          for(const selector of ['day_offset','weekday','source_day_offset','source_weekday'])expect(fields).not.toHaveProperty(selector);
          expect(Object.keys(fields).indexOf('components')).toBeLessThan(Object.keys(fields).indexOf('date'));
        }
      }
      expect(()=>operationWire(expanded,'customer.create').components).not.toThrow();
      expect(operationWire(expanded,'customer.create')).not.toHaveProperty('components');
    },{suspended_plans:[suspendedWirePlan]});
  });
  it('the live strict wire accepts components and rejects them when the flag is off',async()=>{
    const op={operation:'schedule.block',item_key:'a',depends_on:null,released_slot_of:null,source_scope:null,customer_name:null,service_name:null,professional_name:'Rodrigo',
      date:null,day_offset:null,weekday:null,time:null,period:null,source_date:null,source_day_offset:null,source_weekday:null,source_time:null,end_time:null,end_date:null,reason:null};
    const components={date:{value:{kind:'DAY_OF_MONTH',offset:null,weekday:null,week:null,day:28,month:null,year:null,days:null},literal:'dia vinte e oito'},source_date:null,end_date:null,
      time:{value:{hour:10,minute:0,daypart:'UNSPECIFIED'},literal:'das dez as onze'},source_time:null,
      end_time:{value:{hour:11,minute:0,daypart:'UNSPECIFIED'},literal:'das dez as onze'}};
    flag(true);
    const {day_offset:_d,weekday:_w,source_day_offset:_sd,source_weekday:_sw,...published}=op;void _d;void _w;void _sd;void _sw;
    await withConversationRouting(async()=>{
      const validate=new Ajv({allErrors:true}).compile(tool().wire);
      expect(validate({turn:{mode:'NEW',operations:[{...published,components}]}}),JSON.stringify(validate.errors)).toBe(true);
      expect(validate({turn:{mode:'NEW',operations:[{...published,components:null}]}})).toBe(true);
      expect(validate({turn:{mode:'NEW',operations:[{...op,components}]}})).toBe(false);
    });
    flag(false);
    await withConversationRouting(async()=>{
      const validate=new Ajv().compile(tool().wire);
      expect(validate({turn:{mode:'NEW',operations:[{...op,components}]}})).toBe(false);
      expect(validate({turn:{mode:'NEW',operations:[op]}})).toBe(true);
    });
  });
});

describe('decoding components into per-role evidence',()=>{
  const day={kind:'RELATIVE_DAY',offset:1,weekday:null,week:null,day:null,month:null,year:null,days:null};
  const clock={hour:10,minute:0,daypart:'UNSPECIFIED'};
  const empty={date:null,source_date:null,end_date:null,time:null,source_time:null,end_time:null};
  it('keeps the literal as the role quote, carries the typed component and removes the container key',()=>{
    const decoded=decodeTemporalEvidencePayload({operation:'appointment.change',time:null,components:{...empty,date:{value:day,literal:'amanha'},time:{value:clock,literal:'10hs'}}},true) as Record<string,unknown>;
    expect(decoded).not.toHaveProperty('components');expect(decoded.time).toBeNull();
    expect(decoded.temporal_evidence).toEqual([{field:'date',text:'amanha',component:day},{field:'time',text:'10hs',component:clock}]);
  });
  it('a null container and a recorded legacy envelope decode exactly as before',()=>{
    const legacy={operation:'appointment.list',weekday:{value:2,literal:'terça'}};
    expect(decodeTemporalEvidencePayload(legacy,true)).toEqual({operation:'appointment.list',weekday:2,temporal_evidence:[{field:'date',text:'terça'}]});
    expect(decodeTemporalEvidencePayload({...legacy,components:null},true)).toEqual({operation:'appointment.list',weekday:2,temporal_evidence:[{field:'date',text:'terça'}]});
  });
  it('a component restating the legacy quote of its role attaches to it; a different quote is a selector conflict',()=>{
    const same=decodeTemporalEvidencePayload({day_offset:{value:1,literal:'amanhã'},components:{...empty,date:{value:day,literal:'Amanha'}}},true) as Record<string,unknown>;
    expect(same.temporal_evidence).toEqual([{field:'date',text:'amanhã',component:day}]);
    expect(()=>decodeTemporalEvidencePayload({day_offset:{value:1,literal:'amanhã'},components:{...empty,date:{value:day,literal:'sexta'}}},true)).toThrow('TEMPORAL_SELECTOR_CONFLICT');
  });
  it('a malformed container is rejected structurally',()=>{
    for(const bad of [{...empty,date:{value:day}},{...empty,time:{value:{hour:10},literal:'10'}},{...empty,extra:null},{...empty,date:{value:clock,literal:'10'}}])
      expect(()=>decodeTemporalEvidencePayload({components:bad},true)).toThrow();
  });
  it('the literal-repair registry covers component quotes with folding tolerance',()=>{
    const raw={turn:{mode:'NEW',operations:[{components:{...empty,date:{value:day,literal:'Amanhã'},time:{value:clock,literal:'às onze'}}}]}};
    expect(invalidSourceLiterals(raw,'passa pra amanha as 10hs')).toEqual([['turn','operations',0,'components','time','literal']]);
    expect(invalidSourceLiterals(raw,'passa pra amanha às onze')).toEqual([]);
  });
});

describe('request budget with the flag on',()=>{
  // Phase 3a review: measured with the salon directory lines production always sends (a realistic 8 + 24 names).
  const salon={professionals:Array.from({length:8},(_,i)=>`Profissional Sintética ${i}`),services:Array.from({length:24},(_,i)=>`Serviço Sintético Completo ${i}`),today:{date:'2026-09-28',weekday:'segunda-feira',timezone:'America/Sao_Paulo'}};
  it.each(['discovery','scheduling','scheduling-batch'] as const)('keeps %s below 64k with 10 active + 50 suspended actions, the directory and output8192',async skill=>{
    flag(true);vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS','8192');vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED','true');
    const args={turn:{mode:'PATCH',operations:[{item_key:'item_0',fields:{operation:null,source_scope:null,target_name:null,name:null,priceCents:5000,durationMin:null}}]}};
    let bytes=0;
    const transport=vi.fn(async(_input:unknown,init?:RequestInit)=>{
      const request=JSON.parse(String(init?.body));
      expect(request.tools[0].strict).toBe(true);expect(JSON.stringify(request.tools[0].parameters)).toContain('"components"');
      expect(new Ajv().compile(request.tools[0].parameters)(args)).toBe(true);
      bytes=Buffer.byteLength(String(init?.body),'utf8');
      return new Response(JSON.stringify({id:'resp_offline',object:'response',created_at:0,status:'completed',model:'gpt-6-luna',
        output:[{id:'fc_offline',call_id:'call_offline',type:'function_call',name:skill==='discovery'?'select_capabilities':'upsert_action_draft',arguments:JSON.stringify(args),status:'completed'}],
        usage:{input_tokens:20,output_tokens:10,total_tokens:30}}),{status:200,headers:{'content-type':'application/json'}});
    });
    vi.stubGlobal('fetch',transport);
    const model=await createPaidModel({SALON_SECRETARY_ALLOW_PAID_CALLS:'true',SALON_SECRETARY_MODEL:'gpt-6-luna',SALON_SECRETARY_OPENAI_API_KEY:'synthetic-test-key',SALON_SECRETARY_OPENAI_PROJECT:'proj_synthetic'});
    await expect(withSalonDirectory(salon,()=>withConversationRouting(()=>(runServicesTurn as (model:Model,message:string,fields:object,requirements:object,skill:SecretarySkill|'discovery',v2:boolean)=>Promise<unknown>)(model,'Pedido sintético offline',{},{},skill,true),stressContext))).rejects.toBeInstanceOf(SecretaryNewRequest);
    console.info(JSON.stringify({offlineComponentsWire:skill,requestBytes:bytes,inputUpper:bytes+8192}));
    expect(bytes+8192).toBeLessThanOrEqual(64000);
  });
});
describe('free-use residual cap with the flag on (largest required scenarios of secretary-residual-wire-budget)',()=>{
  const action=(index:number,prefix='item')=>({item_key:prefix+'_'+index,operation:'appointment.change',status:'NEEDS_INPUT',depends_on:[]});
  it.each([1,3])('10 active / %i calendar conflicts per action / 50 metadata retained stays within the free-use cap',async calendarRoles=>{
    flag(true);vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS','8192');vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED','true');
    const activeActions=Array.from({length:10},(_,index)=>({...action(index),fields:{customer_name:'Pessoa Sintética '+index,service_name:'Tratamento Sintético',professional_name:'Profissional Sintética',time:'16:00',source_time:'14:00'},
      pending_calendar_conflicts:['date','source_date','end_date'].slice(0,calendarRoles).map(field=>({field,kind:'WEEKDAY_DATE_CONFLICT',expression:'terça, dia 14 de abril de 2027',calendar_date:'2027-04-14',stated_weekday:2,actual_weekday:3})),
      clarification:{missing_fields:['date'],requested_component:'calendar_reference',requested_field:'date',previous_response:'Você informou terça-feira, mas 14/04/2027 cai em quarta-feira. Para a data desejada, vale terça-feira ou 14/04/2027?'}}));
    const context={active_plan:{plan_ref:'10000000-0000-4000-8000-000000000001',actions:activeActions},
      suspended_plans:Array.from({length:5},(_,index)=>({plan_ref:'20000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),actions:Array.from({length:10},(_,i)=>action(i,'saved_'+index))}))};
    const wireFields={operation:null,source_scope:null,customer_name:null,service_name:null,professional_name:null,components:null,date:null,time:{value:'16:00',literal:'Da tarde'},period:null,source_date:null,source_time:null,end_time:null,end_date:null,reason:null};
    const output={turn:{mode:'PATCH',operations:[{item_key:'item_0',fields:wireFields}]}};
    let upper=0;
    vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{
      upper=Buffer.byteLength(String(init?.body),'utf8')+FREE_USE_PRICING.protocolOverheadTokens;
      const request=JSON.parse(String(init?.body)),validate=new Ajv().compile(request.tools[0].parameters);expect(validate(output),JSON.stringify(validate.errors)).toBe(true);
      return new Response(JSON.stringify({id:'resp_offline',object:'response',created_at:0,status:'completed',model:'gpt-6-luna',output:[{id:'fc_offline',call_id:'call_offline',type:'function_call',name:'select_capabilities',arguments:JSON.stringify(output),status:'completed'}],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}),{status:200,headers:{'content-type':'application/json'}});
    }));
    const model=await createPaidModel({SALON_SECRETARY_ALLOW_PAID_CALLS:'true',SALON_SECRETARY_MODEL:'gpt-6-luna',SALON_SECRETARY_OPENAI_API_KEY:'synthetic-offline-not-a-key',SALON_SECRETARY_OPENAI_PROJECT:'proj_offline'});
    await expect(withConversationRouting(()=>(runServicesTurn as (m:Model,msg:string,fields:object,req:object,skill:SecretarySkill|'discovery',v2:boolean)=>Promise<unknown>)(model,'Da tarde.',{}, {},'discovery',true),context)).rejects.toBeInstanceOf(SecretaryNewRequest);
    console.info(JSON.stringify({offlineComponentsResidual:calendarRoles,inputUpper:upper,cap:FREE_USE_PRICING.maxInputTokensUpper}));
    expect(upper).toBeLessThanOrEqual(FREE_USE_PRICING.maxInputTokensUpper);
  });
});
void call;
