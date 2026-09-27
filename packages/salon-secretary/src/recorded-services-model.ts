import { Usage, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { readFileSync, appendFileSync, existsSync, openSync, writeFileSync, fsyncSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// Package-private identities, never a JSON/property/name/environment switch.
// This module is deliberately absent from the package's public entry point.
const recorded = new WeakSet<Model>();
const appendableFrames=new WeakMap<Model,ModelResponse['output'][]>();
export const isRecordedServicesModel = (model:Model) => recorded.has(model);
function assertRecordedJson(value:unknown,seen=new WeakSet<object>()):void {
  if(value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))return;
  if(typeof value!=='object'||value===null||seen.has(value))throw Error('RECORDED_JSON_ONLY');
  if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('RECORDED_JSON_ONLY');
  seen.add(value);
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string')throw Error('RECORDED_JSON_ONLY');
    if(Array.isArray(value)&&key==='length')continue;
    const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
    if(!Object.hasOwn(descriptor,'value'))throw Error('RECORDED_JSON_ONLY');
    assertRecordedJson(descriptor.value,seen);
  }
  seen.delete(value);
}
function immutableFrames(outputs:readonly ModelResponse['output'][]):ModelResponse['output'][] {
  assertRecordedJson(outputs);
  if(!Array.isArray(outputs)||!outputs.every(Array.isArray))throw Error('RECORDED_FRAMES_REQUIRED');
  const clone=structuredClone(outputs);
  const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}};
  clone.forEach(freeze);return [...clone];
}
/** Test-only append of static JSON frames. No mutation/replacement of prior frames,
 * no arbitrary model registration, and durable cursor scripts are not appendable. */
export function appendRecordedServicesFrames(model:RecordedServicesModel,outputs:readonly ModelResponse['output'][]):void {
  const queue=appendableFrames.get(model);if(!queue)throw Error('RECORDED_MODEL_REQUIRED');
  queue.push(...immutableFrames(outputs));
}
export type RecordedServicesModel = Model & {readonly requests:ModelRequest[]};
/** Explicit offline replay seam. Accepts static frames, never a Model/provider/fetch.
 * Arguments remain byte-exact. These replays do NOT verify the live wire contract. */
export type RecordedFailure={name:string;message:string;request_id?:string};
export function createRecordedServicesModel(outputs:readonly ModelResponse['output'][],rawUsage?:Record<string,unknown>,failure?:RecordedFailure):RecordedServicesModel {
  if(rawUsage!==undefined)assertRecordedJson(rawUsage);if(failure!==undefined)assertRecordedJson(failure);
  const frames=immutableFrames(outputs),usage=rawUsage?structuredClone(rawUsage):undefined,fault=failure?structuredClone(failure):undefined,requests:ModelRequest[]=[];
  let cursor=0;
  const model:RecordedServicesModel={requests,
    async getResponse(request){
      requests.push(request);if(fault)throw Object.assign(new Error(fault.message),fault);
      const output=frames[cursor++];if(!output)throw Error('FAKE_SCRIPT_EXHAUSTED');
      return {usage:new Usage(),output:structuredClone(output),rawUsage:usage?structuredClone(usage):undefined,requestId:`req_fake_${requests.length}`,responseId:`resp_fake_${requests.length}`,providerData:{model:'fake-services',status:'completed'}};
    },
    async *getStreamedResponse():AsyncGenerator<never>{throw Error('STREAM_NOT_IMPLEMENTED');},
  };
  recorded.add(model);appendableFrames.set(model,frames);return Object.freeze(model);
}

/** Dedicated local front replay. Static frames and declarative evidence binding;
 * the durable cursor advances only on dispatch, under the original exclusive lock. */
export function createRecordedCursorServicesModel(outputs:readonly ModelResponse['output'][],options:{evidenceFile:string}):RecordedServicesModel {
  const file=resolve(options.evidenceFile),root=resolve('packages/salon-secretary/evaluation/results/front-voice');
  if(!file.startsWith(root+'/')&&!file.startsWith(root+'\\'))throw Error('SCRIPT_OUTSIDE_EVIDENCE');
  const frames=immutableFrames(outputs),requests:ModelRequest[]=[];
  const cursorFile=resolve(dirname(file),'model-cursor.json'),lockFile=cursorFile+'.lock',journalFile=resolve(dirname(file),'model-calls.jsonl');
  const model:RecordedServicesModel={requests,
    async getResponse(request){
      const lock=openSync(lockFile,'wx');
      try{
        const cursor=existsSync(cursorFile)?Number(readFileSync(cursorFile,'utf8')):0;
        if(!Number.isSafeInteger(cursor)||cursor<0||!frames[cursor])throw Error('FAKE_SCRIPT_EXHAUSTED');
        const fd=openSync(cursorFile,'w');try{writeFileSync(fd,String(cursor+1));fsyncSync(fd);}finally{closeSync(fd);}
        requests.push(request);
        const response:ModelResponse={usage:new Usage(),output:structuredClone(frames[cursor]),requestId:'req_fake_1',responseId:'resp_fake_1',providerData:{model:'fake-services',status:'completed'}};
        appendFileSync(journalFile,JSON.stringify({at:new Date().toISOString(),index:cursor,output:response.output,paid:false})+'\n');
        return response;
      }finally{closeSync(lock);unlinkSync(lockFile);}
    },
    async *getStreamedResponse():AsyncGenerator<never>{throw Error('STREAM_NOT_IMPLEMENTED');},
  };
  recorded.add(model);return Object.freeze(model);
}
