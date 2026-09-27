/** Standalone frozen suite runner. The model receives only runtime context + user message. */
import { PrismaClient } from '@prisma/client';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createPaidModel, type Model } from '../src';
import { SalonSecretary } from '../../../src/lib/salon-secretary';
import { prisma } from '../../../src/lib/prisma';
import { backupPhaseALocalDatabase, comparePhaseAJournal, snapshotPhaseACase, type OperationalSnapshot } from './hard-conversations-phase-a-db';
import { assertFreeUseDatabase } from './free-use-database';
import type { SyntheticFixture } from './hard-conversations-fixtures';
import { parseFreeUseSuite, type CaseStatus, type FixtureIdentity, type FreeUseSuite } from './free-use-contract';
import { fixtureIdentity, seedFreeUseFixture, verifyFreeUseFixture } from './free-use-fixture';
import { goldenSuite } from './free-use-golden';
import { FreeUseBudget, digest, FREE_USE_MISSION_CAP_MICRO_USD, FREE_USE_MISSION, FREE_USE_PRICING, FREE_USE_PRICING_SHA256 } from './free-use-budget';
import { canSendTurn, emptyMetrics, observeView, scoreMissingQuestion, scoreTurn, type TurnObservation, type TurnScore } from './free-use-score';
import { withFreeUseClock } from './free-use-clock';
const require = createRequire(import.meta.url);
const { observeProvider } = require('../../../scripts/secretary-passive-observer.cjs') as {
  observeProvider(original: typeof fetch, record: (data: Record<string,unknown>) => unknown): typeof fetch & {flushObservations():Promise<void>};
};
const evidenceWrite = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data,null,2)+'\n', {flag:'wx',mode:0o600});
const code = (error: unknown) => error instanceof Error && /^[A-Z0-9_:.-]{1,160}$/.test(error.message) ? error.message : 'FREE_USE_FAILURE_REDACTED';
export function assertFreeUseEnvironment() {
  if (process.env.APP_ENV !== 'test' || process.env.VERCEL_ENV === 'production' || process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== 'false' ||
    process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED !== 'false' || process.env.SALON_SECRETARY_MODEL !== 'gpt-6-luna') throw Error('FREE_USE_ENVIRONMENT');
  for (const [name,role] of [['DATABASE_URL','mvp_service_runtime'],['DIRECT_URL','mvp_test_admin']] as const) {
    const url = new URL(process.env[name] ?? 'invalid:');
    if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '55441' ||
      url.pathname !== '/everflair_service_mvp' || decodeURIComponent(url.username) !== role) throw Error('FREE_USE_DATABASE_TARGET');
  }
  if (process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED !== 'true') throw Error('FREE_USE_V2_REQUIRED');
}
export function implementationHashes(root = process.cwd()) {
  const paths: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(join(root,directory), {withFileTypes:true})) {
      const path = join(directory,entry.name);
      if (entry.isDirectory()) { if (!['__tests__','test','fixtures','results','node_modules'].includes(entry.name)) walk(path); }
      else if (/\.(?:ts|tsx|cjs|json)$/.test(entry.name)) paths.push(path);
    }
  };
  for (const directory of ['src/lib','src/app/(admin)/servicos/secretaria','packages/salon-secretary/src']) walk(directory);
  for (const directory of ['scripts','packages/salon-secretary/evaluation']) for (const name of readdirSync(join(root,directory)))
    if (/^(?:run-secretary-free-use\.|free-use-|secretary-passive-observer\.cjs)/.test(name) && statSync(join(root,directory,name)).isFile()) paths.push(join(directory,name));
  paths.push('package-lock.json','prisma/schema.prisma');
  return Object.fromEntries([...new Set(paths)].sort().map(path=>[path.replaceAll('\\','/'),digest(readFileSync(join(root,path)))]));
}
const captureSnapshot = (admin: PrismaClient, identity: FixtureIdentity) => snapshotPhaseACase(admin,{tenant:identity.tenant} as SyntheticFixture);
type CasePreparation = { id:string;status:'PREPARED'|'BLOCKED';reason?:string;identity:FixtureIdentity;baseline?:OperationalSnapshot;preflight?:unknown };
export type PreparedSuite = { schemaVersion:1;suite:FreeUseSuite;namespace:string;identity:unknown;sourceHashes:Record<string,string>;
  flags:{overlap:boolean};budget:{maxRequests:number;outputCap:number;mission:string;missionMaxUsd:number;pricing:typeof FREE_USE_PRICING;pricingSha256:string};
  cases:CasePreparation[];backup:unknown;preparedAt:string;confirm:false;execute:false;network:false };
export async function prepareFreeUse(casesPath:string|undefined,out:string,maxRequests?:number) {
  assertFreeUseEnvironment();
  const suite = parseFreeUseSuite(casesPath ? JSON.parse(await readFile(casesPath,'utf8')) : goldenSuite());
  const namespace = suite.suiteId+'-'+randomUUID().slice(0,8);
  const requestLimit = maxRequests ?? suite.cases.reduce((sum,c)=>sum+c.turns.length*2,0);
  if (!Number.isInteger(requestLimit) || requestLimit<1 || requestLimit>500) throw Error('FREE_USE_BUDGET_CONFIG');
  mkdirSync(out,{recursive:true});
  if (existsSync(join(out,'manifest.json'))) throw Error('FREE_USE_ALREADY_PREPARED');
  const admin = new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}}});
  try {
    const identity = await assertFreeUseDatabase(admin,prisma);
    const backup = backupPhaseALocalDatabase(new URL(process.env.DIRECT_URL!));
    const cases:CasePreparation[] = [];
    for (const c of suite.cases) {
      const fixture = c.fixture ?? suite.fixture, ids = fixtureIdentity(namespace,c.id,fixture);
      if (c.requireOverlap && process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED !== 'true') {
        cases.push({id:c.id,status:'BLOCKED',reason:'OVERLAP_FLAG_OFF',identity:ids}); continue;
      }
      try {
        await seedFreeUseFixture(admin,namespace,c.id,fixture,suite.timezone);
        const preflight = await verifyFreeUseFixture(admin,prisma,ids,fixture);
        cases.push({id:c.id,status:'PREPARED',identity:ids,preflight,baseline:await captureSnapshot(admin,ids)});
      } catch (error) { cases.push({id:c.id,status:'BLOCKED',reason:code(error),identity:ids}); }
    }
    const manifest:PreparedSuite = {schemaVersion:1,suite,namespace,identity,sourceHashes:implementationHashes(),
      flags:{overlap:process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED==='true'},
      budget:{maxRequests:requestLimit,outputCap:8192,mission:FREE_USE_MISSION,missionMaxUsd:FREE_USE_MISSION_CAP_MICRO_USD/1_000_000,pricing:FREE_USE_PRICING,pricingSha256:FREE_USE_PRICING_SHA256},
      cases,backup,preparedAt:new Date().toISOString(),confirm:false,execute:false,network:false};
    evidenceWrite(join(out,'manifest.json'),manifest);
    const sha256=digest(readFileSync(join(out,'manifest.json')));
    evidenceWrite(join(out,'seal.json'),{sha256,suite:suite.suiteId,cases:suite.cases.length,turns:suite.cases.reduce((n,c)=>n+c.turns.length,0),
      prepared:cases.filter(c=>c.status==='PREPARED').length,blocked:cases.filter(c=>c.status==='BLOCKED').map(c=>({id:c.id,reason:c.reason})),budget:manifest.budget,
      status:'PREPARED_NOT_EXECUTED',network:false});
    return {out,sha256,prepared:cases.filter(c=>c.status==='PREPARED').length,blocked:cases.filter(c=>c.status==='BLOCKED').length,budget:manifest.budget};
  } finally {await admin.$disconnect();await prisma.$disconnect();}
}
export type TurnRecord = {caseId:string;turn:number;message:string;status:CaseStatus;reason?:string;latencyMs?:number;observation?:TurnObservation;score?:TurnScore;effects?:unknown};
export type CaseRecord = {id:string;family:string;status:CaseStatus;reason?:string;completed:boolean;turns:TurnRecord[]};
export function summarizeFreeUse(cases:CaseRecord[],plannedTurns?:number) {
  const metrics=emptyMetrics();
  for(const c of cases)for(const row of c.turns)if(row.score)for(const key of Object.keys(metrics) as (keyof typeof metrics)[])metrics[key]+=row.score.metrics[key];
  const pass=cases.filter(c=>c.status==='PASS').length,executed=cases.filter(c=>c.turns.some(t=>t.observation)).length;
  return {pass,total:cases.length,executed,fail:cases.filter(c=>c.status==='FAIL').length,blocked:cases.filter(c=>c.status==='BLOCKED').length,
    notExecuted:cases.filter(c=>c.status==='NOT_EXECUTED').length,taskCompletion:executed?cases.filter(c=>c.completed).length/executed:null,
    conversationsCompleted:cases.filter(c=>c.completed).length,metrics,
    safetyFailureConversations:cases.filter(c=>c.turns.some(t=>t.score?.safety.length)).length,
    metricCoverage:{plannedTurns:plannedTurns??null,scoredTurns:cases.reduce((n,c)=>n+c.turns.filter(t=>t.score).length,0),observedTurns:cases.reduce((n,c)=>n+c.turns.filter(t=>t.observation).length,0),scope:"Structured invariants and backend snapshots; unobserved turns and unconstrained free-text semantics are UNKNOWN, never inferred zero."},
    families:Object.fromEntries([...new Set(cases.map(c=>c.family))].map(family=>[family,{pass:cases.filter(c=>c.family===family&&c.status==='PASS').length,
      fail:cases.filter(c=>c.family===family&&c.status==='FAIL').length,blocked:cases.filter(c=>c.family===family&&c.status==='BLOCKED').length}]))};
}
export async function runFreeUse(out:string) {
  assertFreeUseEnvironment();
  const bytes=readFileSync(join(out,'manifest.json')),binding=digest(bytes),manifest=JSON.parse(bytes.toString()) as PreparedSuite;
  const suite=parseFreeUseSuite(manifest.suite);
  if(process.env.FREE_USE_APPROVED_MANIFEST!==binding||process.env.FREE_USE_REAL_LUNA_APPROVED!=='true')throw Error('FREE_USE_NETWORK_NOT_AUTHORIZED');
  if(!process.env.SALON_SECRETARY_OPENAI_API_KEY||process.env.SALON_SECRETARY_OPENAI_PROJECT!=='proj_IcNUaSBqgYGrPkSBtF9dZ0CF')throw Error('FREE_USE_PROVIDER_PROJECT');
  if(manifest.confirm!==false||manifest.execute!==false||JSON.stringify(manifest.sourceHashes)!==JSON.stringify(implementationHashes())||
    manifest.flags.overlap!==(process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED==='true'))throw Error('FREE_USE_MANIFEST_DRIFT');
  if(suite.source&&digest(readFileSync(suite.source.path))!==suite.source.sha256)throw Error('FREE_USE_CASE_SOURCE_DRIFT');
  if(existsSync(join(out,'results.json'))||existsSync(join(out,'turns.jsonl')))throw Error('FREE_USE_ALREADY_STARTED');
  if(manifest.budget.mission!==FREE_USE_MISSION||manifest.budget.missionMaxUsd!==FREE_USE_MISSION_CAP_MICRO_USD/1_000_000||manifest.budget.pricingSha256!==FREE_USE_PRICING_SHA256||JSON.stringify(manifest.budget.pricing)!==JSON.stringify(FREE_USE_PRICING))throw Error('FREE_USE_BUDGET_CONFIG');
  // Fixed across suites, retries and output directories. No CLI/env override or reset mechanism.
  const missionJournal=resolve(process.cwd(),'packages/salon-secretary/evaluation/results/free-use/mission-20260926-admission.jsonl');
  const budget=new FreeUseBudget(missionJournal,binding,manifest.budget.maxRequests,manifest.budget.outputCap,manifest.budget.pricingSha256);
  if(budget.requests)throw Error('FREE_USE_ALREADY_STARTED');
  const lock=join(out,'run.lock'),fd=openSync(lock,'wx',0o600),admin=new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}}});
  const network=globalThis.fetch,observations:(typeof fetch & {flushObservations():Promise<void>})[]=[];
  const originalOutputCap=process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS;
  let active:{caseId:string;turn:number}|null=null,attemptedWrites=0,stopped:string|null=null,admissionFailure:string|null=null;
  const cases:CaseRecord[]=[];const observedEffects=new Map<string,{confirmations:number;operationalWrites:number;externalMessages:number}>();
  // Read-only runtime guard is deliberate admission, separate from passive capture.
  prisma.$use(async(params,next)=>{
    if(['create','createMany','update','updateMany','upsert','delete','deleteMany'].includes(params.action)&&params.model!=='AuditLog'){
      attemptedWrites++;throw Error('FREE_USE_OPERATIONAL_WRITE_FORBIDDEN');
    }
    return next(params);
  });
  globalThis.fetch=async(input,init)=>{
    if(!active)throw Error('FREE_USE_UNEXPECTED_NETWORK');
    let request:ReturnType<FreeUseBudget['reserve']>;
    try { request=budget.reserve(active.caseId,active.turn,input,init); } catch (error) { admissionFailure=code(error); throw error; }
    const tapped=observeProvider(network,data=>appendFile(join(out,'provider-observations.jsonl'),JSON.stringify({...request,...data})+'\n',{mode:0o600}));
    observations.push(tapped);
    return tapped(input,init);
  };
  try{
    await assertFreeUseDatabase(admin,prisma);
    for(const c of suite.cases){
      const prepared=manifest.cases.find(x=>x.id===c.id);
      const result:CaseRecord={id:c.id,family:c.family,status:'NOT_EXECUTED',completed:false,turns:[]};cases.push(result);
      if(stopped){result.reason=stopped;continue;}
      if(!prepared||prepared.status==='BLOCKED'||!prepared.baseline){result.status='BLOCKED';result.reason=prepared?.reason??'FIXTURE_NOT_PREPARED';continue;}
      const fixture=c.fixture??suite.fixture;
      try{
        await verifyFreeUseFixture(admin,prisma,prepared.identity,fixture);
        const before=await captureSnapshot(admin,prepared.identity);
        if(JSON.stringify(before.hashes)!==JSON.stringify(prepared.baseline.hashes)||before.technical_audit_hash!==prepared.baseline.technical_audit_hash)throw Error('FREE_USE_BASELINE_DRIFT');
      }catch(error){result.status='BLOCKED';result.reason=code(error);continue;}
      const actor={salonId:prepared.identity.tenant,userId:prepared.identity.actor};
      try{
        await withFreeUseClock(c.clock??suite.clock,async()=>{
          const factory=async():Promise<Model>=>createPaidModel(process.env);
          const secretary=new SalonSecretary(factory,()=> 'gpt-6-luna',undefined,{enabled:()=>false},{enabled:()=>true});
          const session=await secretary.start(actor,'auto');let previous:TurnObservation|undefined;const history:TurnObservation[]=[];
          for(let index=0;index<c.turns.length;index++){
            const turn=c.turns[index];
            if(!canSendTurn(turn,previous)){
              const score=scoreMissingQuestion(turn,previous);
              const row:TurnRecord={caseId:c.id,turn:index+1,message:turn.message,status:'FAIL',reason:score.failures[0],score};
              result.turns.push(row);await appendFile(join(out,'turns.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});break;
            }
            active={caseId:c.id,turn:index+1};process.env.SALON_SECRETARY_ALLOW_PAID_CALLS='true';
            process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS=String(manifest.budget.outputCap);
            const started=performance.now();let view:unknown,errorCode:string|undefined;
            try{view=await secretary.send(actor,{sessionId:session.sessionId,message:turn.message});}
            catch(error){errorCode=code(error);}
            finally{active=null;process.env.SALON_SECRETARY_ALLOW_PAID_CALLS='false';}
            const after=await captureSnapshot(admin,prepared.identity),delta=comparePhaseAJournal(prepared.baseline!,after);
            const effects={confirmations:delta.counters.confirmations,operationalWrites:delta.changed_tables.length+attemptedWrites,externalMessages:delta.counters.outbox_creations};
            observedEffects.set(c.id,effects);
            if(admissionFailure&&!Object.values(effects).some(value=>value!==0)){
              const row:TurnRecord={caseId:c.id,turn:index+1,message:turn.message,status:'BLOCKED',reason:admissionFailure,latencyMs:performance.now()-started,effects:delta};
              result.turns.push(row);await appendFile(join(out,'turns.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});stopped=admissionFailure;break;
            }
            const observation=observeView(view),score=scoreTurn(turn.expect,observation,prepared.identity.bindings,previous,effects,turn.message,history);
            if(errorCode){score.pass=false;score.failures.push(errorCode);}
            const row:TurnRecord={caseId:c.id,turn:index+1,message:turn.message,status:score.pass?'PASS':'FAIL',...(errorCode?{reason:errorCode}:{}),latencyMs:performance.now()-started,observation,score,effects:delta};
            result.turns.push(row);await appendFile(join(out,'turns.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});previous=observation;history.push(observation);
            if(score.safety.length||attemptedWrites){stopped='SAFETY_FAILURE';break;}
            if(admissionFailure){stopped=admissionFailure;break;}
          }
        });
        result.status=result.turns.some(t=>t.status==='BLOCKED')?'BLOCKED':result.turns.length===c.turns.length&&result.turns.every(t=>t.status==='PASS')?'PASS':'FAIL';
        const final=result.turns.at(-1)?.observation;
        result.completed=result.status==='PASS'&&Boolean(final&&(final.confirmable||!final.missing.length||['CONVERSATION','UNSUPPORTED'].includes(String(final.capabilityStatus))));
      }catch(error){result.status=result.turns.some(t=>t.observation)?'FAIL':'BLOCKED';result.reason=code(error);if(attemptedWrites)stopped='SAFETY_FAILURE';}
      finally{active=null;process.env.SALON_SECRETARY_ALLOW_PAID_CALLS='false';}
    }
  }finally{
    globalThis.fetch=network;process.env.SALON_SECRETARY_ALLOW_PAID_CALLS='false';if(originalOutputCap===undefined)delete process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS;else process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS=originalOutputCap;
    await Promise.all(observations.map(observer=>observer.flushObservations()));
    await admin.$disconnect();await prisma.$disconnect();closeSync(fd);unlinkSync(lock);
  }
  let capturedResponses:number|null=null;
  try { capturedResponses=readFileSync(join(out,'provider-observations.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).length; } catch { /* Missing optional diagnostics remain UNKNOWN. */ }
  const report={binding,suite:suite.suiteId,stopped,providerEvidence:{requests:budget.requests,capturedResponses,complete:capturedResponses===budget.requests},summary:summarizeFreeUse(cases,suite.cases.reduce((n,c)=>n+c.turns.length,0)),requests:budget.requests,reservedUsd:budget.reservedUsd,
    missionReservedUsd:budget.missionReservedUsd,missionMaxUsd:FREE_USE_MISSION_CAP_MICRO_USD/1_000_000,priceNote:'Conservative durable reservation, not invoice',cases,
    intendedConfirmations:0,observedEffects:{measuredCases:observedEffects.size,unknownCases:cases.filter(c=>!observedEffects.has(c.id)).map(c=>c.id),confirmations:[...observedEffects.values()].reduce((n,e)=>n+e.confirmations,0),operationalWrites:[...observedEffects.values()].reduce((n,e)=>n+e.operationalWrites,0),externalMessages:[...observedEffects.values()].reduce((n,e)=>n+e.externalMessages,0)},flagsFinal:{paid:false},model:'gpt-6-luna'};
  evidenceWrite(join(out,'results.json'),report);
  return {out,stopped,...report.summary,requests:budget.requests,reservedUsd:budget.reservedUsd,missionReservedUsd:budget.missionReservedUsd};
}
export function safeOutputDirectory(path:string) {
  const root=resolve(process.cwd(),'packages/salon-secretary/evaluation/results/free-use'),target=resolve(path);
  const within=relative(root,target);if(!within||within.startsWith('..')||within.includes(':'))throw Error('FREE_USE_OUTPUT_DIRECTORY');return target;
}
