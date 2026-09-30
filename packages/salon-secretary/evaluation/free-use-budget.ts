/** Active, durable cost admission. Completely separate from passive observation/manual-20. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { assertSecretaryResponsesPayload } from '../src/openai-cost-guard';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const FREE_USE_MISSION = 'secretary-final-stabilization-20260926';
// Explicitly authorized by Alison on 2026-09-27: total USD 5, same cumulative journal.
export const FREE_USE_MISSION_CAP_MICRO_USD = 5_000_000;
// Reliability program (27/09/2026): separate journal and USD 5 ceiling; the legacy journal stays closed but readable.
// A ceiling is not an authorization: every run still needs its approved manifest SHA and FREE_USE_REAL_LUNA_APPROVED.
export const FREE_USE_RELIABILITY_MISSION = 'secretary-reliability-20260927';
export const FREE_USE_RELIABILITY_MISSION_CAP_MICRO_USD = 5_000_000;
export const FREE_USE_PRICING = Object.freeze({
  source:'https://developers.openai.com/api/docs/models/gpt-6-luna', checkedAt:'2026-09-26',
  model:'gpt-6-luna', tier:'standard', inputUsdPerMillion:.10, cacheWriteUsdPerMillion:.125, outputUsdPerMillion:.50,
  maxInputTokensUpper:64_000, outputCap:8192, protocolOverheadTokens:8192,
  bound:'UTF8 bytes of entire text-only JSON request plus 8192 framing tokens; reject above 64000. No region, fast tier, media, server state or hosted tools.',
});
export const FREE_USE_PRICING_SHA256 = digest(JSON.stringify(FREE_USE_PRICING));
// Fixed allowlist. A mission owns exactly one repository-relative journal; no CLI/env path, reset or reuse across missions.
export const FREE_USE_MISSIONS = Object.freeze({
  [FREE_USE_MISSION]:Object.freeze({capMicroUsd:FREE_USE_MISSION_CAP_MICRO_USD,journal:'packages/salon-secretary/evaluation/results/free-use/mission-20260926-admission.jsonl'}),
  [FREE_USE_RELIABILITY_MISSION]:Object.freeze({capMicroUsd:FREE_USE_RELIABILITY_MISSION_CAP_MICRO_USD,journal:'packages/salon-secretary/evaluation/results/free-use/mission-20260927-reliability-admission.jsonl'}),
});
export type FreeUseMissionId = keyof typeof FREE_USE_MISSIONS;
export const FREE_USE_DEFAULT_MISSION:FreeUseMissionId = FREE_USE_RELIABILITY_MISSION;
export function freeUseMission(id:unknown){
  if(typeof id!=='string'||!Object.hasOwn(FREE_USE_MISSIONS,id))throw Error('FREE_USE_MISSION_UNKNOWN');
  return {id:id as FreeUseMissionId,...FREE_USE_MISSIONS[id as FreeUseMissionId]};
}
// Requests one approved binding may admit. The legacy mission keeps its sealed 500; the reliability mission admits one
// binding of up to 8 attempts (release pass^8: Golden 8x88, holdouts 8x112). The mission USD cap stays the hard stop.
export const FREE_USE_BINDING_MAX_REQUESTS:Readonly<Record<FreeUseMissionId,number>> = Object.freeze({[FREE_USE_MISSION]:500,[FREE_USE_RELIABILITY_MISSION]:1000});
export const freeUseBindingMaxRequests=(id:unknown)=>FREE_USE_BINDING_MAX_REQUESTS[freeUseMission(id).id];
/** CLI `--mission` or env FREE_USE_MISSION_ID (both only as allowlisted ids; disagreement fails closed). */
export function selectFreeUseMission(cli?:string,env=process.env.FREE_USE_MISSION_ID){
  const chosen=[cli,env].filter((value):value is string=>value!==undefined&&value!=='');
  if(new Set(chosen).size>1)throw Error('FREE_USE_MISSION_CONFLICT');
  return freeUseMission(chosen[0]??FREE_USE_DEFAULT_MISSION);
}
export const freeUseMissionJournal=(id:FreeUseMissionId)=>resolve(process.cwd(),freeUseMission(id).journal);
type Reservation = {mission:string;binding:string;id:string;status:'STARTED';caseId:string;turn:number;attempt:number;maxRequests:number;
  bodySha256:string;bodyBytes:number;model:string;maxOutputTokens:number;inputTokensUpper:number;reservedMicroUsd:number;pricingSha256:string;previousHash:string;rowHash:string};
function readJournal(file:string,mission:FreeUseMissionId=FREE_USE_MISSION): Reservation[] {
  const cap=freeUseMission(mission).capMicroUsd;
  if(!existsSync(file))return [];
  const bytes=readFileSync(file,'utf8');if(bytes&&!bytes.endsWith('\n'))throw Error('FREE_USE_BUDGET_JOURNAL');
  let prior='GENESIS';let total=0;const ids=new Set<string>(),rows:Reservation[]=[];
  for(const line of bytes.split('\n').filter(Boolean)){
    let row:Reservation;try{row=JSON.parse(line);}catch{throw Error('FREE_USE_BUDGET_JOURNAL');}
    const {rowHash,...body}=row;
    const computed=Math.ceil(row.inputTokensUpper*.125+row.maxOutputTokens*.50);
    if(row.mission!==mission||row.status!=='STARTED'||row.previousHash!==prior||rowHash!==digest(JSON.stringify(body))||
      row.pricingSha256!==FREE_USE_PRICING_SHA256||row.model!=='gpt-6-luna'||!row.binding||!row.id||ids.has(row.id)||
      !Number.isInteger(row.bodyBytes)||row.bodyBytes<1||row.inputTokensUpper!==row.bodyBytes+8192||
      !Number.isInteger(row.inputTokensUpper)||row.inputTokensUpper<8192||row.inputTokensUpper>64_000||
      !Number.isInteger(row.maxOutputTokens)||row.maxOutputTokens<1||row.maxOutputTokens>8192||row.reservedMicroUsd!==computed||
      row.attempt!==rows.filter(r=>r.binding===row.binding).length+1||!Number.isInteger(row.maxRequests)||row.maxRequests<1||row.maxRequests>freeUseBindingMaxRequests(mission)||row.attempt>row.maxRequests||
      rows.some(r=>r.binding===row.binding&&r.maxRequests!==row.maxRequests))throw Error('FREE_USE_BUDGET_JOURNAL');
    total+=row.reservedMicroUsd;if(total>cap)throw Error('FREE_USE_BUDGET_JOURNAL');
    rows.push(row);ids.add(row.id);prior=rowHash;
  }
  return rows;
}
/** Read-only total of one mission journal (validates the whole hash chain). */
export const freeUseMissionReservedMicroUsd=(file:string,mission:FreeUseMissionId)=>readJournal(file,mission).reduce((sum,row)=>sum+row.reservedMicroUsd,0);
export class FreeUseBudget {
  // Default mission keeps the legacy semantics of existing direct callers; runners always pass the selected mission.
  constructor(private readonly missionFile:string,private readonly binding:string,readonly maxRequests:number,readonly outputCap=8192,
    readonly pricingSha256=FREE_USE_PRICING_SHA256,readonly mission:FreeUseMissionId=FREE_USE_MISSION){
    freeUseMission(mission);
    // A known mission journal can only ever receive rows of its own mission.
    for(const [id,entry] of Object.entries(FREE_USE_MISSIONS))if(basename(missionFile)===basename(entry.journal)&&id!==mission)throw Error('FREE_USE_BUDGET_CONFIG');
    if(!binding||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>freeUseBindingMaxRequests(mission)||!Number.isInteger(outputCap)||outputCap<1200||outputCap>8192||
      pricingSha256!==FREE_USE_PRICING_SHA256)throw Error('FREE_USE_BUDGET_CONFIG');
    const rows=readJournal(missionFile,mission);
    if(rows.some(row=>row.binding===binding&&row.maxRequests!==maxRequests))throw Error('FREE_USE_BUDGET_CONFIG');
  }
  get requests(){return readJournal(this.missionFile,this.mission).filter(row=>row.binding===this.binding).length;}
  get reservedUsd(){return readJournal(this.missionFile,this.mission).filter(row=>row.binding===this.binding).reduce((sum,row)=>sum+row.reservedMicroUsd,0)/1_000_000;}
  get missionReservedUsd(){return freeUseMissionReservedMicroUsd(this.missionFile,this.mission)/1_000_000;}
  get missionMaxUsd(){return freeUseMission(this.mission).capMicroUsd/1_000_000;}
  reserve(caseId:string,turn:number,input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
    // Admission may inspect the existing string, but never consumes Request streams or alters payloads.
    if(typeof input!=='string'||input!=='https://api.openai.com/v1/responses'||init?.method?.toUpperCase()!=='POST'||typeof init.body!=='string')throw Error('FREE_USE_WIRE_REQUEST');
    const bodyBytes=Buffer.byteLength(init.body,'utf8'),inputTokensUpper=bodyBytes+FREE_USE_PRICING.protocolOverheadTokens;
    if(inputTokensUpper>FREE_USE_PRICING.maxInputTokensUpper)throw Error('FREE_USE_INPUT_CAP');
    const payload=JSON.parse(init.body);assertSecretaryResponsesPayload(payload,'gpt-6-luna');
    if(payload.max_output_tokens>this.outputCap||payload.max_output_tokens<1)throw Error('FREE_USE_OUTPUT_CAP');
    // Byte-level tokenization cannot exceed one token per UTF8 byte of text. The complete wire JSON
    // also counts names, schemas and escaping; extra framing is conservatively reserved separately.
    const reservedMicroUsd=Math.ceil(inputTokensUpper*FREE_USE_PRICING.cacheWriteUsdPerMillion+payload.max_output_tokens*FREE_USE_PRICING.outputUsdPerMillion);
    const lock=this.missionFile+'.lock',fd=openSync(lock,'wx',0o600);
    try{
      const rows=readJournal(this.missionFile,this.mission),own=rows.filter(row=>row.binding===this.binding);
      if(own.some(row=>row.maxRequests!==this.maxRequests))throw Error('FREE_USE_BUDGET_CONFIG');
      if(own.length>=this.maxRequests||rows.reduce((sum,row)=>sum+row.reservedMicroUsd,0)+reservedMicroUsd>freeUseMission(this.mission).capMicroUsd)throw Error('FREE_USE_BUDGET_EXHAUSTED');
      const body={mission:this.mission,binding:this.binding,id:randomUUID(),status:'STARTED' as const,caseId,turn,attempt:own.length+1,maxRequests:this.maxRequests,
        bodySha256:digest(init.body),bodyBytes,model:payload.model,maxOutputTokens:payload.max_output_tokens,inputTokensUpper,reservedMicroUsd,
        pricingSha256:this.pricingSha256,previousHash:rows.at(-1)?.rowHash??'GENESIS'};
      const row={...body,rowHash:digest(JSON.stringify(body))},journal=openSync(this.missionFile,'a',0o600);
      try{writeSync(journal,JSON.stringify(row)+'\n');fsyncSync(journal);}finally{closeSync(journal);}
      // STARTED is durably charged before transport. Never refund on timeout, unknown usage or retry.
      return {id:row.id,caseId,turn,attempt:row.attempt,reservedMicroUsd,inputTokensUpper};
    }finally{closeSync(fd);unlinkSync(lock);}
  }
}
