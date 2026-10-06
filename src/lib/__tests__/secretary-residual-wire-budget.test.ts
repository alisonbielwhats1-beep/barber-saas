import { afterEach, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createPaidModel, runServicesTurn, withConversationRouting, SecretaryNewRequest, type Model, type SecretarySkill } from '@everflair/salon-secretary';
import { FREE_USE_PRICING } from '../../../packages/salon-secretary/evaluation/free-use-budget';

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const ambiguity={field:'time',kind:'CLOCK_DAYPART',expression:'quarta às quatro',candidates:['04:00','16:00']};
const action=(index:number,rich:boolean,prefix='item')=>({item_key:prefix+'_'+index,operation:'appointment.change',status:'NEEDS_INPUT',depends_on:[],
  ...(rich?{fields:{customer_name:'Pessoa Sintética '+index,service_name:'Tratamento Sintético',professional_name:'Profissional Sintética',source_date:'2027-04-13',source_time:'14:00',date:'2027-04-14'},
    pending_temporal_ambiguities:[ambiguity],clarification:{missing_fields:['time'],requested_field:'time',requested_component:'daypart',previous_response:'No horário de destino, quarta às quatro significa 4h ou16h?'}}:{}),
});
const scenarios=[...([1,2,5,10] as const).map(active=>({name:active+' active residual / no retained',active,suspended:0,rich:false,required:true,calendarRoles:0})),
  {name:'10 active residual / 10 rich retained',active:10,suspended:10,rich:true,required:false,calendarRoles:0},
  {name:'10 active residual / 50 metadata retained',active:10,suspended:50,rich:false,required:false,calendarRoles:0},
  ...[1,3].map(calendarRoles=>({name:'10 active / '+calendarRoles+' calendar conflicts per action / 50 metadata retained',active:10,suspended:50,rich:false,required:true,calendarRoles}))];

it.each(scenarios.flatMap(scenario=>(['discovery','scheduling'] as const).map(skill=>({...scenario,skill}))))('measures real SDK $skill: $name',async scenario=>{
  vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS','8192');vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED','true');
  const activeActions=Array.from({length:scenario.active},(_,index)=>{
    const current=action(index,true);if(!scenario.calendarRoles)return current;
    const {pending_temporal_ambiguities:oldClock,fields:oldFields,...rest}=current;void oldClock;void oldFields;
    return {...rest,fields:{customer_name:'Pessoa Sintética '+index,service_name:'Tratamento Sintético',professional_name:'Profissional Sintética',time:'16:00',source_time:'14:00'},
      pending_calendar_conflicts:['date','source_date','end_date'].slice(0,scenario.calendarRoles).map(field=>({field,kind:'WEEKDAY_DATE_CONFLICT',expression:'terça, dia 14 de abril de 2027',calendar_date:'2027-04-14',stated_weekday:2,actual_weekday:3})),
      clarification:{missing_fields:['date'],requested_component:'calendar_reference',requested_field:'date',previous_response:'Você informou terça-feira, mas 14/04/2027 cai em quarta-feira. Para a data desejada, vale terça-feira ou 14/04/2027?'}};
  });
  const context={active_plan:{plan_ref:'10000000-0000-4000-8000-000000000001',actions:activeActions},
    suspended_plans:Array.from({length:Math.ceil(scenario.suspended/10)},(_,index)=>({plan_ref:'20000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),actions:Array.from({length:Math.min(10,scenario.suspended-index*10)},(_,i)=>action(i,scenario.rich,'saved_'+index))}))};
  const frozen=JSON.stringify(context);
  const wireFields={operation:null,source_scope:null,customer_name:null,service_name:null,professional_name:null,date:null,day_offset:null,weekday:null,time:{value:'16:00',literal:'Da tarde'},period:null,source_date:null,source_day_offset:null,source_weekday:null,source_time:null,end_time:null,end_date:null,reason:null};
  const output={turn:{mode:'PATCH',operations:[{item_key:'item_0',fields:wireFields}]}};
  let bytes=0,upper=0,exceeded=false;
  const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    bytes=Buffer.byteLength(String(init?.body),'utf8');upper=bytes+FREE_USE_PRICING.protocolOverheadTokens;exceeded=upper>FREE_USE_PRICING.maxInputTokensUpper;
    const request=JSON.parse(String(init?.body));expect(new Ajv().compile(request.tools[0].parameters)(output)).toBe(true);
    // Measurement only: reproduce the evaluation guard before any simulated provider response.
    if(exceeded)throw Error('FREE_USE_INPUT_CAP');
    return new Response(JSON.stringify({id:'resp_offline',object:'response',created_at:0,status:'completed',model:'gpt-6-luna',output:[{id:'fc_offline',call_id:'call_offline',type:'function_call',name:scenario.skill==='discovery'?'select_capabilities':'upsert_action_draft',arguments:JSON.stringify(output),status:'completed'}],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}),{status:200,headers:{'content-type':'application/json'}});
  });
  vi.stubGlobal('fetch',transport);
  const model=await createPaidModel({SALON_SECRETARY_ALLOW_PAID_CALLS:'true',SALON_SECRETARY_MODEL:'gpt-6-luna',SALON_SECRETARY_OPENAI_API_KEY:'synthetic-offline-not-a-key',SALON_SECRETARY_OPENAI_PROJECT:'proj_offline'});
  let error:unknown;
  try{await withConversationRouting(()=>(runServicesTurn as (m:Model,msg:string,fields:object,req:object,skill:SecretarySkill|'discovery',v2:boolean)=>Promise<unknown>)(model,'Da tarde.',{}, {},scenario.skill,true),context);}catch(caught){error=caught;}
  expect(transport).toHaveBeenCalledOnce();expect(JSON.stringify(context)).toBe(frozen);
  if(scenario.required){expect(exceeded).toBe(false);expect(error).toBeInstanceOf(SecretaryNewRequest);}
  else if(!exceeded)expect(error).toBeInstanceOf(SecretaryNewRequest);else expect(error).toBeDefined();
  console.info(JSON.stringify({offlineResidualWire:scenario.skill,scenario:scenario.name,active:scenario.active,retained:scenario.suspended,retainedRich:scenario.rich,calendarConflictsPerAction:scenario.calendarRoles,bodyBytes:bytes,inputUpper:upper,cap:FREE_USE_PRICING.maxInputTokensUpper,withinCap:!exceeded,providerNetworkCalls:0}));
});
