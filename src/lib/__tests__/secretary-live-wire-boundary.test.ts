import {afterEach,describe,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import * as api from '@everflair/salon-secretary';
import * as registry from '../../../packages/salon-secretary/src/skill-registry';
import {createRecordedServicesModel,createRecordedCursorServicesModel,appendRecordedServicesFrames} from '../../../packages/salon-secretary/src/recorded-services-model';
import {expandedWire,turnWire} from '../../test/secretary-wire-schema';
import {call} from '../../test/scripted-services-model';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import historical from '../../test/fixtures/secretary-real-wire-golden3.json';
const {RunContext,Runner}=createRequire(resolve('packages/salon-secretary/package.json'))('@openai/agents');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
const stub=(raw:unknown):api.Model=>({getResponse:vi.fn(async()=>({usage:new api.Usage(),output:call('upsert_action_draft',raw),providerData:{status:'completed',model:'fake-services',recorded:true}})),async *getStreamedResponse(){throw Error('NO_STREAM');}});
const modelArgs={SALON_SECRETARY_ALLOW_PAID_CALLS:'true',SALON_SECRETARY_MODEL:'gpt-6-luna',SALON_SECRETARY_OPENAI_API_KEY:'synthetic-offline-not-a-key',SALON_SECRETARY_OPENAI_PROJECT:'proj_offline'};
const inScope=<T>(v2:boolean,fn:()=>Promise<T>)=>v2?api.withConversationRouting(fn,{}):fn();
async function shaped(v2:boolean,skill:'scheduling'|'inventory'='scheduling'){
  return inScope(v2,async()=>{
    const tool=api.createServicesAgent(stub({}),()=>{},skill,v2).tools[0];if(tool.type!=='function')throw Error('TOOL');
    const wire=expandedWire(tool.parameters),shape=v2?turnWire(wire,'CURRENT').properties!.fields.properties!:wire.properties!;
    const fields={...Object.fromEntries(Object.keys(shape).map(key=>[key,null])),operation:skill==='scheduling'?'appointment.list':'stock.movement'};
    return {fields,raw:(values:object)=>v2?{turn:{mode:'CURRENT',fields:{...fields,...values}}}:{...fields,...values}};
  });
}
describe('live validation is selected by published contract, never payload/model labels',()=>{
  it.each([false,true])('rejects unmarked V2=%s legacy scalars before handler, including direct Agent invocation',async v2=>{
    const shape=await shaped(v2),raw=shape.raw({weekday:2,period:'morning'}),model=stub(raw),receive=vi.fn(),before=JSON.stringify(raw);
    await inScope(v2,async()=>{
      await expect(api.runServicesTurn(model,'terça de manhã',{}, {},'scheduling')).rejects.toThrow();
      const tool=api.createServicesAgent(model,receive,'scheduling',v2).tools[0];if(tool.type!=='function')throw Error('TOOL');
      await expect(tool.invoke(new RunContext(),JSON.stringify(raw))).rejects.toThrow();
    });
    expect(receive).not.toHaveBeenCalled();expect(model.getResponse).toHaveBeenCalledOnce();expect(JSON.stringify(raw)).toBe(before);
  });
  it.each([false,true])('accepts exactly paired live V2=%s values without changing raw',async v2=>{
    const shape=await shaped(v2),raw=shape.raw({weekday:{value:2,literal:'terça'},period:'morning'}),before=JSON.stringify(raw);
    const result=await inScope(v2,()=>api.runServicesTurn(stub(raw),'terça de manhã',{}, {},'scheduling'));
    expect(result).toMatchObject({weekday:2,period:'morning',temporal_evidence:[{field:'date',text:'terça'}]});expect(JSON.stringify(raw)).toBe(before);
  });
  it.each([false,true].flatMap(v2=>['original','replace','clone'].map(kind=>({v2,kind}))))('public Agent $kind V2=$v2 cannot carry recorded parser authority',async({v2,kind})=>{
    const shape=await shaped(v2),raw=shape.raw({weekday:2}),recorded=createRecordedServicesModel([call('upsert_action_draft',raw)]),receive=vi.fn();
    await inScope(v2,async()=>{
      const original=api.createServicesAgent(recorded,receive,'scheduling',v2),agent=kind==='clone'?original.clone({model:stub(raw)}):original;
      if(kind==='replace')agent.model=stub(raw);
      await expect(new Runner({tracingDisabled:true}).run(agent,'terça',{maxTurns:1})).rejects.toThrow();
      expect(receive).not.toHaveBeenCalled();
    });
  });
  it.each(['replace','clone'])('public Agent %s still accepts its exact live contract',async kind=>{
    const shape=await shaped(true),raw=shape.raw({weekday:{value:2,literal:'terça'}}),receive=vi.fn();
    await inScope(true,async()=>{
      const original=api.createServicesAgent(createRecordedServicesModel([]),receive,'scheduling',true),agent=kind==='clone'?original.clone({model:stub(raw)}):original;
      if(kind==='replace')agent.model=stub(raw);
      await new Runner({tracingDisabled:true}).run(agent,'terça',{maxTurns:1});
    });
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({operation:'appointment.list',weekday:2,temporal_evidence:[{field:'date',text:'terça'}]}));
  });
  it('rejects missing turn even for names/providerData/env that resemble a recorded model',async()=>{
    vi.stubEnv('SECRETARY_FRONT_E2E_SCRIPT','synthetic.json');vi.stubEnv('APP_ENV','test');
    const model=stub({operation:'appointment.list',weekday:2});
    await api.withConversationRouting(async()=>{await expect(api.runServicesTurn(model,'terça',{}, {},'scheduling')).rejects.toThrow();});
    expect(model.getResponse).toHaveBeenCalledOnce();
  });
  it.each([false,true])('paid SDK V2=%s stays live through both transparent wrappers',async v2=>{
    const shape=await shaped(v2),raw=shape.raw({weekday:2});
    const fetch=vi.fn(async()=>new Response(JSON.stringify({id:'resp_offline',object:'response',created_at:0,status:'completed',model:'gpt-6-luna',
      output:[{id:'fc_offline',call_id:'call_offline',type:'function_call',name:'upsert_action_draft',arguments:JSON.stringify(raw),status:'completed'}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetch);const paid=await api.createPaidModel(modelArgs),measured=api.instrumentServicesModel(api.measureServicesModel(paid,'fake-services',()=>{}),'fake-services',async()=>{});
    await inScope(v2,async()=>{await expect(api.runServicesTurn(measured,'terça',{}, {},'scheduling')).rejects.toThrow();});expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([false,true])('quantity scalar cannot bypass paired V2=%s schema either',async v2=>{
    const shape=await shaped(v2,'inventory');await inScope(v2,async()=>{await expect(api.runServicesTurn(stub(shape.raw({product_name:'Produto',mode:'IN',quantity:2})),'duas caixas',{}, {},'inventory')).rejects.toThrow();});
  });
  it('rejects omitted required neutral keys and extra keys instead of injecting defaults',async()=>{
    await api.withConversationRouting(async()=>{
      for(const fields of [{operation:'appointment.list',weekday:{value:2,literal:'terça'}},{...(await shaped(true)).fields,weekday:{value:2,literal:'terça'},extra:null}]){
        await expect(api.runServicesTurn(stub({turn:{mode:'CURRENT',fields}}),'terça',{}, {},'scheduling')).rejects.toThrow();
      }
    });
  });
  it('schema compilation failure propagates before any dispatch; no reduced-schema fallback',()=>{
    const compile=vi.spyOn(registry,'compactSecretaryWire').mockReturnValue({type:'object',properties:{},required:[],additionalProperties:false,not:{type:'null'}});
    const model=stub({});expect(()=>api.createServicesAgent(model,()=>{},'scheduling')).toThrow('not is not supported');expect(model.getResponse).not.toHaveBeenCalled();compile.mockRestore();
  });
  it.each(historical.rows.filter(row=>['GF01','GF02','GF03','GF27'].includes(row.caseId)))('old real $caseId cannot enter the live V2 handler',async row=>{
    const model=stub({});const receive=vi.fn();await api.withConversationRouting(async()=>{
      const tool=api.createServicesAgent(model,receive,'discovery',true).tools[0];if(tool.type!=='function')throw Error('TOOL');
      await expect(tool.invoke(new RunContext(),row.arguments)).rejects.toThrow();
    });expect(receive).not.toHaveBeenCalled();expect(model.getResponse).not.toHaveBeenCalled();
  });
});

describe('explicit offline identity is static, private and cannot be grafted onto a live model',()=>{
  it('has a frozen own closure, no public registration and no mutable/prototype replacement',()=>{
    const model=createRecordedServicesModel([call('upsert_action_draft',{weekday:2})]);
    expect(Object.isFrozen(model)).toBe(true);expect(Object.hasOwn(model,'getResponse')).toBe(true);
    expect(()=>Object.defineProperty(model,'getResponse',{value:stub({}).getResponse})).toThrow();
    expect(()=>Object.setPrototypeOf(model,stub({}))).toThrow();
    for(const key of ['createRecordedServicesModel','isRecordedServicesModel','inheritRecordedServicesIdentity','uninstrumentedServicesModel'])expect(api).not.toHaveProperty(key);
  });
  it.each(['proxy','copy','prototype'] as const)('a %s of recorded model is live and cannot inherit its private identity',async kind=>{
    const original=createRecordedServicesModel([call('upsert_action_draft',{operation:'appointment.list',weekday:2})]);
    const forged:api.Model=kind==='proxy'?new Proxy(original,{}):kind==='copy'?{...original}:Object.create(original);
    await api.withConversationRouting(async()=>{await expect(api.runServicesTurn(forged,'terça',{}, {},'scheduling')).rejects.toThrow();});
  });
  it('preserves recorded bytes through legitimate timing/usage wrappers only',async()=>{
    const raw={operation:'appointment.list',weekday:2},frames=[call('upsert_action_draft',raw)],original=JSON.stringify(frames);
    const model=createRecordedServicesModel(frames),events:api.ModelCallUsage[]=[];
    const wrapped=api.instrumentServicesModel(api.measureServicesModel(model,'recorded',()=>{}),'recorded',async event=>{events.push(event);});
    const result=await api.withConversationRouting(()=>api.runServicesTurn(wrapped,'terça',{}, {},'scheduling'));
    expect(result).toMatchObject(raw);expect(JSON.stringify(frames)).toBe(original);expect(events.map(event=>event.status)).toEqual(['STARTED','SUCCEEDED']);
    expect(Object.isFrozen(wrapped)).toBe(true);expect(()=>Object.defineProperty(wrapped,'getResponse',{value:stub({}).getResponse})).toThrow();
  });
  it('clones frames before callers can mutate them, never accepts a provider instead of data',async()=>{
    const frames=[call('upsert_action_draft',{weekday:2})],model=createRecordedServicesModel(frames);
    const original=JSON.stringify(frames[0]);frames[0]=call('upsert_action_draft',{weekday:6});
    const response=await model.getResponse({} as api.ModelRequest);expect(JSON.stringify(response.output)).toBe(original);
    expect(()=>createRecordedServicesModel(stub({}) as unknown as api.ModelResponse['output'][])).toThrow();
  });
  it('explicit append accepts only cloned JSON frames on its original recorded identity',async()=>{
    const model=createRecordedServicesModel([]),frames=[call('upsert_action_draft',{weekday:2})],before=JSON.stringify(frames[0]);
    appendRecordedServicesFrames(model,frames);frames[0]=call('upsert_action_draft',{weekday:6});
    expect(JSON.stringify((await model.getResponse({} as api.ModelRequest)).output)).toBe(before);expect(Object.isFrozen(model)).toBe(true);
    expect(()=>appendRecordedServicesFrames({...model},frames)).toThrow('RECORDED_MODEL_REQUIRED');
    expect(()=>appendRecordedServicesFrames(model,[[{type:'function_call',get arguments(){throw Error('GETTER_EXECUTED');}}]] as unknown as api.ModelResponse['output'][])).toThrow('RECORDED_JSON_ONLY');
    expect(()=>appendRecordedServicesFrames(model,[[(()=>{})]] as unknown as api.ModelResponse['output'][])).toThrow('RECORDED_JSON_ONLY');
  });
  it('rejects accessors and non-JSON data before evaluating frames or optional metadata',()=>{
    const getter=vi.fn(()=>[]),frames:api.ModelResponse['output'][]=[];Object.defineProperty(frames,0,{get:getter});
    expect(()=>createRecordedServicesModel(frames)).toThrow('RECORDED_JSON_ONLY');
    const usage={};Object.defineProperty(usage,'input_tokens',{get:getter});expect(()=>createRecordedServicesModel([],usage)).toThrow('RECORDED_JSON_ONLY');
    const fault={name:'Error',message:'offline'};Object.defineProperty(fault,'request_id',{get:getter});expect(()=>createRecordedServicesModel([],undefined,fault)).toThrow('RECORDED_JSON_ONLY');
    expect(getter).not.toHaveBeenCalled();
    const cyclic:unknown[]=[];cyclic.push(cyclic);expect(()=>createRecordedServicesModel(cyclic as api.ModelResponse['output'][])).toThrow('RECORDED_JSON_ONLY');
    const symbol=Object.assign([],{[Symbol('callback')]:()=>{}});expect(()=>createRecordedServicesModel(symbol)).toThrow('RECORDED_JSON_ONLY');
  });
  it.each(['sync','async'])('timing ignores %s observer failure and returns the exact original response',async kind=>{
    const response={usage:new api.Usage(),output:call('upsert_action_draft',{}),rawUsage:{input_tokens:17}},source:api.Model={getResponse:async()=>response,async *getStreamedResponse(){throw Error('NO_STREAM');}};
    const measured=api.measureServicesModel(source,'live',kind==='sync'?()=>{throw Error('OBSERVER_FAILED');}:async()=>{throw Error('OBSERVER_FAILED');});
    await expect(measured.getResponse({} as api.ModelRequest)).resolves.toBe(response);await Promise.resolve();
  });
  it('timing observer failure cannot replace an original source error',async()=>{
    const failure=Error('SOURCE_FAILED'),source:api.Model={getResponse:async()=>{throw failure;},async *getStreamedResponse(){throw Error('NO_STREAM');}};
    const measured=api.measureServicesModel(source,'live',()=>{throw Error('OBSERVER_FAILED');});
    await expect(measured.getResponse({} as api.ModelRequest)).rejects.toBe(failure);
  });
  it.each(['STARTED','SUCCEEDED'])('durable usage failure on %s remains fail-closed before business handling',async stage=>{
    const shape=await shaped(false),source=stub(shape.raw({weekday:{value:2,literal:'terça'}}));
    const measured=api.instrumentServicesModel(source,'live',async event=>{if(event.status===stage)throw Error('DURABLE_WRITE_FAILED');});
    await expect(api.runServicesTurn(measured,'terça',{}, {},'scheduling')).rejects.toThrow('DURABLE_WRITE_FAILED');
    expect(source.getResponse).toHaveBeenCalledTimes(stage==='STARTED'?0:1);
  });
  it('timing observes metrics without replacing the exact source response',async()=>{
    const response={usage:new api.Usage(),output:call('upsert_action_draft',{})},source:api.Model={getResponse:async()=>response,async *getStreamedResponse(){throw Error('NO_STREAM');}};
    const measured=api.measureServicesModel(source,'live',()=>({output:[]}));expect(await measured.getResponse({} as api.ModelRequest)).toBe(response);
  });
});

it('durable recorded front cursor advances only on dispatch, keeps lock/path binding and logs exact frames',async()=>{
  const root=resolve('packages/salon-secretary/evaluation/results/front-voice');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'boundary-offline-'));
  const file=join(dir,'frames.json'),cursor=join(dir,'model-cursor.json'),lock=cursor+'.lock',journal=join(dir,'model-calls.jsonl');
  const frames=[call('upsert_action_draft',{weekday:2}),call('upsert_action_draft',{weekday:3})];writeFileSync(file,JSON.stringify(frames));
  try{
    const first=createRecordedCursorServicesModel(frames,{evidenceFile:file});expect(existsSync(cursor)).toBe(false);expect(Object.isFrozen(first)).toBe(true);
    expect(()=>appendRecordedServicesFrames(first,frames)).toThrow('RECORDED_MODEL_REQUIRED');
    writeFileSync(lock,'held');await expect(first.getResponse({} as api.ModelRequest)).rejects.toThrow();expect(existsSync(cursor)).toBe(false);rmSync(lock);
    expect((await first.getResponse({} as api.ModelRequest)).output).toEqual(frames[0]);expect(readFileSync(cursor,'utf8')).toBe('1');
    const resumed=createRecordedCursorServicesModel(frames,{evidenceFile:file});expect((await resumed.getResponse({} as api.ModelRequest)).output).toEqual(frames[1]);expect(readFileSync(cursor,'utf8')).toBe('2');
    await expect(resumed.getResponse({} as api.ModelRequest)).rejects.toThrow('FAKE_SCRIPT_EXHAUSTED');expect(readFileSync(cursor,'utf8')).toBe('2');expect(existsSync(lock)).toBe(false);
    expect(readFileSync(journal,'utf8').trim().split('\n').map(line=>JSON.parse(line).output)).toEqual(frames);
    expect(()=>createRecordedCursorServicesModel(frames,{evidenceFile:resolve('.demo/outside.json')})).toThrow('SCRIPT_OUTSIDE_EVIDENCE');
  }finally{if(!resolve(dir).startsWith(root+sep))throw Error('UNSAFE_TEST_CLEANUP');rmSync(dir,{recursive:true,force:true});}
});
