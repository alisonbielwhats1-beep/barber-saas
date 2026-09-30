/** Standalone frozen suite runner. The model receives only runtime context + user message. */
import { PrismaClient } from '@prisma/client';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createPaidModel, secretaryContractVersion, type Model } from '../src';
import { SalonSecretary } from '../../../src/lib/salon-secretary';
import { backendPresentationDigest } from '../../../src/lib/secretary-presentation-contract';
import { prisma } from '../../../src/lib/prisma';
import { backupPhaseALocalDatabase, comparePhaseAJournal, snapshotPhaseACase, type OperationalSnapshot } from './hard-conversations-phase-a-db';
import { assertFreeUseDatabase } from './free-use-database';
import type { SyntheticFixture } from './hard-conversations-fixtures';
import { parseFreeUseSuite, type CaseStatus, type FixtureIdentity, type FreeUseSuite } from './free-use-contract';
import { fixtureIdentity, seedFreeUseFixture, verifyFreeUseFixture } from './free-use-fixture';
import { goldenSuite } from './free-use-golden';
import { FreeUseBudget, digest, FREE_USE_PRICING, FREE_USE_PRICING_SHA256, freeUseMissionJournal, freeUseMissionReservedMicroUsd, selectFreeUseMission } from './free-use-budget';
import { aggregatePassK, attemptCaseLabel, attemptDirectory, attemptNamespace, freeUseRepeat, freeUseRequestLimit } from './free-use-repeat';
import { assertFreeUseFlags, freeUseFlags } from './free-use-options';
import { canSendTurn, emptyMetrics, observeView, scoreMissingQuestion, scoreTurn, valueAt, type TurnObservation, type TurnScore } from './free-use-score';
import type { EntityBindings, TurnExpectation } from './free-use-contract';
import { withFreeUseClock } from './free-use-clock';
import { assertProgramHeadroom, guardPaidFetch, isProgramSpendError, programSpendLabel, programSpendLedgerPath, programSpendSummary, programSpendTotals } from './program-spend';
import { rawWriteVerdict, technicalWriteTables } from './free-use-technical-writes';
import { persistedSessionStore } from '../../../src/lib/secretary-session-store';
import { secretaryErrorMessage } from '../../../src/lib/secretary-error-copy';
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
    if (/^(?:run-secretary-free-use\.|free-use-|program-spend\.|secretary-passive-observer\.cjs|local-db-identity\.cjs)/.test(name) && statSync(join(root,directory,name)).isFile()) paths.push(join(directory,name));
  paths.push('package-lock.json','prisma/schema.prisma');
  return Object.fromEntries([...new Set(paths)].sort().map(path=>[path.replaceAll('\\','/'),digest(readFileSync(join(root,path)))]));
}
const captureSnapshot = (admin: PrismaClient, identity: FixtureIdentity) => snapshotPhaseACase(admin,{tenant:identity.tenant} as SyntheticFixture);
type CasePreparation = { id:string;status:'PREPARED'|'BLOCKED';reason?:string;identity:FixtureIdentity;baseline?:OperationalSnapshot;preflight?:unknown };
type AttemptPreparation = { attempt:number;namespace:string;cases:CasePreparation[] };
export type PreparedSuite = { schemaVersion:2;suite:FreeUseSuite;namespace:string;repeat:number;identity:unknown;sourceHashes:Record<string,string>;
  flags:Record<string,string>;budget:{maxRequests:number;maxRequestsPerAttempt:number;outputCap:number;mission:string;missionMaxUsd:number;pricing:typeof FREE_USE_PRICING;pricingSha256:string};
  attempts:AttemptPreparation[];backup:unknown;preparedAt:string;confirm:false;execute:false;network:false };
export async function prepareFreeUse(casesPath:string|undefined,out:string,maxRequests?:number,options:{repeat?:number;mission?:string}={}) {
  assertFreeUseEnvironment();
  const suite = parseFreeUseSuite(casesPath ? JSON.parse(await readFile(casesPath,'utf8')) : goldenSuite());
  const repeat = freeUseRepeat(options.repeat ?? 1), mission = selectFreeUseMission(options.mission);
  const namespace = suite.suiteId+'-'+randomUUID().slice(0,8);
  const perAttempt = maxRequests ?? suite.cases.reduce((sum,c)=>sum+c.turns.length*2,0), requestLimit = freeUseRequestLimit(perAttempt,repeat,mission.id);
  const flags = freeUseFlags();
  // Read-only: validates the selected mission's whole hash chain before any database access.
  const missionReservedMicroUsd = freeUseMissionReservedMicroUsd(freeUseMissionJournal(mission.id),mission.id);
  mkdirSync(out,{recursive:true});
  if (existsSync(join(out,'manifest.json'))) throw Error('FREE_USE_ALREADY_PREPARED');
  const admin = new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}}});
  try {
    const identity = await assertFreeUseDatabase(admin,prisma);
    const backup = backupPhaseALocalDatabase(new URL(process.env.DIRECT_URL!));
    const attempts:AttemptPreparation[] = [];
    // One identity set per attempt: AuditLog rows of one attempt never move another attempt's baseline.
    for (let attempt=1;attempt<=repeat;attempt++) {
      const scope = attemptNamespace(namespace,attempt), cases:CasePreparation[] = [];
      for (const c of suite.cases) {
        const fixture = c.fixture ?? suite.fixture, ids = fixtureIdentity(scope,c.id,fixture);
        if (c.requireOverlap && process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED !== 'true') {
          cases.push({id:c.id,status:'BLOCKED',reason:'OVERLAP_FLAG_OFF',identity:ids}); continue;
        }
        try {
          await seedFreeUseFixture(admin,scope,c.id,fixture,suite.timezone);
          const preflight = await verifyFreeUseFixture(admin,prisma,ids,fixture);
          cases.push({id:c.id,status:'PREPARED',identity:ids,preflight,baseline:await captureSnapshot(admin,ids)});
        } catch (error) { cases.push({id:c.id,status:'BLOCKED',reason:code(error),identity:ids}); }
      }
      attempts.push({attempt,namespace:scope,cases});
    }
    const manifest:PreparedSuite = {schemaVersion:2,suite,namespace,repeat,identity,sourceHashes:implementationHashes(),flags,
      budget:{maxRequests:requestLimit,maxRequestsPerAttempt:perAttempt,outputCap:8192,mission:mission.id,missionMaxUsd:mission.capMicroUsd/1_000_000,pricing:FREE_USE_PRICING,pricingSha256:FREE_USE_PRICING_SHA256},
      attempts,backup,preparedAt:new Date().toISOString(),confirm:false,execute:false,network:false};
    evidenceWrite(join(out,'manifest.json'),manifest);
    const sha256=digest(readFileSync(join(out,'manifest.json'))),all=attempts.flatMap(a=>a.cases.map(c=>({...c,attempt:a.attempt})));
    const prepared=all.filter(c=>c.status==='PREPARED').length,blocked=all.filter(c=>c.status==='BLOCKED').map(c=>({attempt:c.attempt,id:c.id,reason:c.reason}));
    const missionHeadroom={missionReservedUsd:missionReservedMicroUsd/1_000_000,missionRemainingUsd:(mission.capMicroUsd-missionReservedMicroUsd)/1_000_000};
    evidenceWrite(join(out,'seal.json'),{sha256,suite:suite.suiteId,repeat,cases:suite.cases.length,turns:suite.cases.reduce((n,c)=>n+c.turns.length,0),
      prepared,blocked,budget:manifest.budget,...missionHeadroom,status:'PREPARED_NOT_EXECUTED',network:false});
    return {out,sha256,repeat,prepared,blocked:blocked.length,budget:manifest.budget,...missionHeadroom};
  } finally {await admin.$disconnect();await prisma.$disconnect();}
}
/** Review (request budget): present only on a turn whose interpretation request did not fit the cap as configured. */
export type TurnRequestBudget = {steps:string[];rejected:number;contractVersion:string|null};
export type TurnRecord = {attempt?:number;caseId:string;turn:number;message:string;status:CaseStatus;reason?:string;latencyMs?:number;observation?:TurnObservation;score?:TurnScore;effects?:unknown;requestBudget?:TurnRequestBudget;
  /** Report-only annotations (A4); never read by the scorer: status, pass and safety stay exactly as scored. */ annotations?:string[];
  /** ERR-COPY (review D-P9): the pt-BR copy the owner would read for a turn whose call threw (codes only; never scored). */ reply?:string};
/** A4 (report layer only; free-use-score.ts and the Golden oracle stay frozen): an unsafe EFFECTIVE:appointment.change:source_*
 * failure is annotated SAFETY_PROJECTION_ONLY when the only thing missing is the projection of the origin the approved proposal
 * already pins: `found` is null, the approved action_snapshot is of this operation with the expected appointment_ref, and its
 * before_start equals every expected source coordinate. Conservative: nothing is annotated when ANY safety code of the turn does
 * not qualify (a wrong non-null value, a HARD_BLOCK bypass, an unrequested operation, another effect). Pass/fail, the safety
 * list and every count are unchanged; the annotation should go dead for GF13 once A3-ORIGIN-FROM-REF lands. */
export const SAFETY_PROJECTION_ONLY='SAFETY_PROJECTION_ONLY';
const SOURCE_PART:Record<string,(beforeStart:string)=>string>={source_date:b=>b.slice(0,10),source_time:b=>b.slice(11,16)};
export function safetyProjectionAnnotations(expectation:TurnExpectation,observed:TurnObservation,score:TurnScore,bindings:EntityBindings):string[]{
  if(!score.safety.length)return [];
  const bound=(v:unknown)=>typeof v==='string'&&v.startsWith('$ref:')?bindings[v.slice(5)]:v;
  const qualified=new Set<string>();
  for(const expected of expectation.actions){
    if(expected.operation!=='appointment.change')continue;
    const action=observed.actions.filter(a=>a.operation===expected.operation)[expected.index];
    const effective=(expected.effective??{}) as Record<string,unknown>,ref=bound(effective.appointment_ref);
    const snapshot=(action?.proposal?.action_snapshot??null) as Record<string,unknown>|null,before=typeof snapshot?.before_start==='string'?snapshot.before_start:'';
    if(!action||!action.approval||!snapshot||snapshot.kind!==expected.operation||typeof ref!=='string'||!ref||snapshot.appointment_ref!==ref||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(before))continue;
    // Every expected origin coordinate must equal the approved record's own (a moved appointment or another clock: none).
    const coordinates=Object.keys(SOURCE_PART).filter(path=>effective[path]!==undefined);
    if(!coordinates.length||coordinates.some(path=>SOURCE_PART[path](before)!==effective[path]))continue;
    for(const path of coordinates)if(valueAt(action.effective,path)==null)qualified.add(`EFFECTIVE:${expected.operation}:${path}`);
  }
  return score.safety.every(code=>qualified.has(code))?score.safety.map(code=>`${SAFETY_PROJECTION_ONLY}:${code}`):[];
}
/** Counts of annotated turns and conversations (every safety code of every safety turn annotated); never subtracted anywhere. */
export function annotationSummary(cases:CaseRecord[]){
  const annotated=(t:TurnRecord)=>Boolean(t.annotations?.length)&&(t.score?.safety.length??0)>0;
  return {[SAFETY_PROJECTION_ONLY]:{turns:cases.reduce((n,c)=>n+c.turns.filter(annotated).length,0),
    conversations:cases.filter(c=>c.turns.some(t=>t.score?.safety.length)&&c.turns.filter(t=>t.score?.safety.length).every(annotated)).length,
    note:'Report-only: still FAIL and still counted in safetyFailureConversations.'}};
}
/** The request budget of the turn just sent, from its codes-only SECRETARY_ROUTER row: the degradation steps, how many
 * requests were refused and the contract version that message ran under (a rewritten turn names its own). Undefined when
 * every request fit as configured (the record keeps its historical shape) or the row is not there. Read-only. */
export function turnRequestBudget(metadata:unknown):TurnRequestBudget|undefined{
  const outcome=(metadata as {outcome?:{request_budget?:{steps?:unknown;rejected?:unknown};contract_version?:unknown}|null}|null)?.outcome,budget=outcome?.request_budget;
  if(!budget)return undefined;
  const steps=Array.isArray(budget.steps)?budget.steps.filter((step):step is string=>typeof step==='string'&&/^[A-Z][A-Z_]{1,39}$/.test(step)):[];
  const version=outcome?.contract_version;
  return {steps,rejected:Number.isSafeInteger(budget.rejected)?budget.rejected as number:0,contractVersion:typeof version==='string'&&/^[0-9a-f]{64}$/.test(version)?version:null};
}
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
export async function runFreeUse(out:string,missionId?:string) {
  assertFreeUseEnvironment();
  const bytes=readFileSync(join(out,'manifest.json')),binding=digest(bytes),manifest=JSON.parse(bytes.toString()) as PreparedSuite;
  if(manifest.schemaVersion!==2)throw Error('FREE_USE_MANIFEST_SCHEMA');
  const suite=parseFreeUseSuite(manifest.suite);
  if(process.env.FREE_USE_APPROVED_MANIFEST!==binding||process.env.FREE_USE_REAL_LUNA_APPROVED!=='true')throw Error('FREE_USE_NETWORK_NOT_AUTHORIZED');
  if(!process.env.SALON_SECRETARY_OPENAI_API_KEY||process.env.SALON_SECRETARY_OPENAI_PROJECT!=='proj_IcNUaSBqgYGrPkSBtF9dZ0CF')throw Error('FREE_USE_PROVIDER_PROJECT');
  if(manifest.confirm!==false||manifest.execute!==false||JSON.stringify(manifest.sourceHashes)!==JSON.stringify(implementationHashes()))throw Error('FREE_USE_MANIFEST_DRIFT');
  // Every SALON_SECRETARY_* flag snapshotted at prepare (overlap included) must be identical now.
  assertFreeUseFlags(manifest.flags);
  if(suite.source&&digest(readFileSync(suite.source.path))!==suite.source.sha256)throw Error('FREE_USE_CASE_SOURCE_DRIFT');
  const repeat=freeUseRepeat(manifest.repeat);
  if(!Array.isArray(manifest.attempts)||manifest.attempts.length!==repeat||manifest.attempts.some((a,index)=>a.attempt!==index+1||
    a.namespace!==attemptNamespace(manifest.namespace,index+1)||!Array.isArray(a.cases)))throw Error('FREE_USE_REPEAT');
  if(existsSync(join(out,'results.json'))||existsSync(join(out,'turns.jsonl'))||manifest.attempts.some(a=>existsSync(join(out,attemptDirectory(a.attempt)))))throw Error('FREE_USE_ALREADY_STARTED');
  const mission=selectFreeUseMission(missionId);
  if(manifest.budget.mission!==mission.id)throw Error('FREE_USE_MISSION_MISMATCH');
  if(manifest.budget.missionMaxUsd!==mission.capMicroUsd/1_000_000||manifest.budget.pricingSha256!==FREE_USE_PRICING_SHA256||JSON.stringify(manifest.budget.pricing)!==JSON.stringify(FREE_USE_PRICING)||
    manifest.budget.maxRequests!==freeUseRequestLimit(manifest.budget.maxRequestsPerAttempt,repeat,mission.id))throw Error('FREE_USE_BUDGET_CONFIG');
  // Fixed journal of the allowlisted mission, across suites, attempts, retries and output directories. No path override or reset.
  const missionJournal=freeUseMissionJournal(mission.id);
  const budget=new FreeUseBudget(missionJournal,binding,manifest.budget.maxRequests,manifest.budget.outputCap,manifest.budget.pricingSha256,mission.id);
  if(budget.requests)throw Error('FREE_USE_ALREADY_STARTED');
  // Program-wide real-spend ledger (shared with practice/transcription), validated before any database access.
  const programLedger=programSpendLedgerPath(),programRun=programSpendLabel(`golden:${suite.suiteId}:${binding.slice(0,12)}`);
  programSpendTotals(programLedger);
  const lock=join(out,'run.lock'),fd=openSync(lock,'wx',0o600),admin=new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}}});
  const network=globalThis.fetch,observations:(typeof fetch & {flushObservations():Promise<void>})[]=[];
  const originalOutputCap=process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS;
  let active:{caseId:string;turn:number;attempt:number}|null=null,attemptedWrites=0,technicalStateWrites=0,stopped:string|null=null,admissionFailure:string|null=null;
  type Effects={confirmations:number;operationalWrites:number;externalMessages:number};
  const runs=manifest.attempts.map(a=>({attempt:a.attempt,requests:0,cases:[] as CaseRecord[],observedEffects:new Map<string,Effects>()}));
  // Read-only runtime guard is deliberate admission, separate from passive capture.
  // D1 (documented allowlist, free-use-technical-writes.ts): with SALON_SECRETARY_PERSISTED_STATE on, raw SQL is inspected
  // too and may write ONLY the conversation-state tables (counted apart); with the flag off raw SQL is not inspected.
  const technicalTables=technicalWriteTables();
  prisma.$use(async(params,next)=>{
    if(['create','createMany','update','updateMany','upsert','delete','deleteMany'].includes(params.action)&&params.model!=='AuditLog'){
      attemptedWrites++;throw Error('FREE_USE_OPERATIONAL_WRITE_FORBIDDEN');
    }
    if(technicalTables.length&&(params.action==='queryRaw'||params.action==='executeRaw')){
      const verdict=rawWriteVerdict(params.args,technicalTables);
      if(verdict==='FORBIDDEN'){attemptedWrites++;throw Error('FREE_USE_OPERATIONAL_WRITE_FORBIDDEN');}
      if(verdict==='TECHNICAL')technicalStateWrites++;
    }
    return next(params);
  });
  globalThis.fetch=async(input,init)=>{
    const current=active;if(!current)throw Error('FREE_USE_UNEXPECTED_NETWORK');
    const run=runs[current.attempt-1];let request:ReturnType<FreeUseBudget['reserve']>;
    try {
      // Each attempt keeps its own share of the single binding; exceeding it is an admission failure.
      if(run.requests>=manifest.budget.maxRequestsPerAttempt)throw Error('FREE_USE_ATTEMPT_REQUESTS_EXHAUSTED');
      // Program real-spend cap first: a refused call consumes neither a mission reservation nor transport.
      await assertProgramHeadroom(input,init,{ledger:programLedger});
      request=budget.reserve(attemptCaseLabel(current.caseId,current.attempt),current.turn,input,init);run.requests++;
    } catch (error) { admissionFailure=code(error); throw error; }
    const paid=guardPaidFetch('golden',network,{ledger:programLedger,run:programRun,item:programSpendLabel(`${attemptCaseLabel(current.caseId,current.attempt)}:t${current.turn}`)});
    const tapped=observeProvider(paid,data=>appendFile(join(out,attemptDirectory(current.attempt),'provider-observations.jsonl'),
      JSON.stringify({...request,caseId:current.caseId,repeatAttempt:current.attempt,...data})+'\n',{mode:0o600}));
    observations.push(tapped);
    // A program ledger failure around transport (cap race, lock, settle) stops the run like any admission failure.
    try { return await tapped(input,init); } catch (error) { if(isProgramSpendError(error))admissionFailure??=code(error); throw error; }
  };
  try{
    await assertFreeUseDatabase(admin,prisma);
    for(const plan of manifest.attempts){
      const run=runs[plan.attempt-1],dir=join(out,attemptDirectory(plan.attempt));mkdirSync(dir,{recursive:true});
      for(const c of suite.cases){
        const prepared=plan.cases.find(x=>x.id===c.id);
        const result:CaseRecord={id:c.id,family:c.family,status:'NOT_EXECUTED',completed:false,turns:[]};run.cases.push(result);
        // SAFETY_FAILURE or an admission failure stops every remaining case of every attempt: NOT_EXECUTED, never PASS.
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
            const secretary=new SalonSecretary(factory,()=> 'gpt-6-luna',undefined,{enabled:()=>false},{enabled:()=>true},persistedSessionStore);
            const session=await secretary.start(actor,'auto');let previous:TurnObservation|undefined;const history:TurnObservation[]=[];const routerSeen=new Set<string>();
            for(let index=0;index<c.turns.length;index++){
              const turn=c.turns[index];
              if(!canSendTurn(turn,previous)){
                const score=scoreMissingQuestion(turn,previous);
                const row:TurnRecord={attempt:plan.attempt,caseId:c.id,turn:index+1,message:turn.message,status:'FAIL',reason:score.failures[0],score};
                result.turns.push(row);await appendFile(join(dir,'turns.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});break;
              }
              active={caseId:c.id,turn:index+1,attempt:plan.attempt};process.env.SALON_SECRETARY_ALLOW_PAID_CALLS='true';
              process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS=String(manifest.budget.outputCap);
              const started=performance.now();let view:unknown,errorCode:string|undefined;
              try{view=await secretary.send(actor,{sessionId:session.sessionId,message:turn.message});}
              catch(error){errorCode=code(error);}
              finally{active=null;process.env.SALON_SECRETARY_ALLOW_PAID_CALLS='false';}
              const after=await captureSnapshot(admin,prepared.identity),delta=comparePhaseAJournal(prepared.baseline!,after);
              const effects={confirmations:delta.counters.confirmations,operationalWrites:delta.changed_tables.length+attemptedWrites,externalMessages:delta.counters.outbox_creations};
              run.observedEffects.set(c.id,effects);
              if(admissionFailure&&!Object.values(effects).some(value=>value!==0)){
                const row:TurnRecord={attempt:plan.attempt,caseId:c.id,turn:index+1,message:turn.message,status:'BLOCKED',reason:admissionFailure,latencyMs:performance.now()-started,effects:delta};
                result.turns.push(row);await appendFile(join(dir,'turns.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});stopped=admissionFailure;break;
              }
              const observation=observeView(view),score=scoreTurn(turn.expect,observation,prepared.identity.bindings,previous,effects,turn.message,history);
              if(errorCode){score.pass=false;score.failures.push(errorCode);}
              // Review: a turn the request budget rewrote (or refused) is told apart from the configured one (diagnostic only; never scored).
              let requestBudget:TurnRequestBudget|undefined;
              try{const router=await admin.auditLog.findFirst({where:{salonId:actor.salonId,entityType:'SECRETARY_ROUTER'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,metadata:true}});
                if(router&&!routerSeen.has(router.id)){routerSeen.add(router.id);requestBudget=turnRequestBudget(router.metadata);}}catch{requestBudget=undefined;}
              // A4: report-only annotation, computed after scoring and never fed back (status/pass/safety as scored).
              const annotations=safetyProjectionAnnotations(turn.expect,observation,score,prepared.identity.bindings);
              const row:TurnRecord={attempt:plan.attempt,caseId:c.id,turn:index+1,message:turn.message,status:score.pass?'PASS':'FAIL',...(errorCode?{reason:errorCode,reply:secretaryErrorMessage(errorCode).text}:{}),latencyMs:performance.now()-started,observation,score,effects:delta,...(requestBudget?{requestBudget}:{}),...(annotations.length?{annotations}:{})};
              result.turns.push(row);await appendFile(join(dir,'turns.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});previous=observation;history.push(observation);
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
    }
  }finally{
    globalThis.fetch=network;process.env.SALON_SECRETARY_ALLOW_PAID_CALLS='false';if(originalOutputCap===undefined)delete process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS;else process.env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS=originalOutputCap;
    await Promise.all(observations.map(observer=>observer.flushObservations()));
    await admin.$disconnect();await prisma.$disconnect();closeSync(fd);unlinkSync(lock);
  }
  // C6 (rec 19): the model contract (prompt templates, wire, model, limits, contract flags) this run used.
  const contractVersion=secretaryContractVersion({modelId:'gpt-6-luna',presentation:backendPresentationDigest()});
  const plannedTurns=suite.cases.reduce((n,c)=>n+c.turns.length,0),sum=(values:number[])=>values.reduce((n,value)=>n+value,0);
  const effectsOf=(run:typeof runs[number])=>({measuredCases:run.observedEffects.size,unknownCases:run.cases.filter(c=>!run.observedEffects.has(c.id)).map(c=>c.id),
    confirmations:sum([...run.observedEffects.values()].map(e=>e.confirmations)),operationalWrites:sum([...run.observedEffects.values()].map(e=>e.operationalWrites)),
    externalMessages:sum([...run.observedEffects.values()].map(e=>e.externalMessages))});
  const attempts=runs.map(run=>{
    const dir=join(out,attemptDirectory(run.attempt));mkdirSync(dir,{recursive:true});
    let capturedResponses:number|null=run.requests?null:0;
    try { capturedResponses=readFileSync(join(dir,'provider-observations.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).length; } catch { /* Missing optional diagnostics remain UNKNOWN. */ }
    const summary=summarizeFreeUse(run.cases,plannedTurns),observedEffects=effectsOf(run),providerEvidence={requests:run.requests,capturedResponses,complete:capturedResponses===run.requests};
    evidenceWrite(join(dir,'results.json'),{binding,suite:suite.suiteId,mission:mission.id,repeat,attempt:run.attempt,namespace:manifest.attempts[run.attempt-1].namespace,stopped,
      providerEvidence,summary,annotations:annotationSummary(run.cases),cases:run.cases,intendedConfirmations:0,observedEffects,flagsFinal:{paid:false},model:'gpt-6-luna',contractVersion});
    return {attempt:run.attempt,dir:attemptDirectory(run.attempt),stopped,providerEvidence,summary,observedEffects};
  });
  const summary=summarizeFreeUse(runs.flatMap(run=>run.cases),plannedTurns*repeat),passK=aggregatePassK(runs,repeat);
  const captured=attempts.every(a=>a.providerEvidence.capturedResponses!==null)?sum(attempts.map(a=>a.providerEvidence.capturedResponses??0)):null;
  const releaseBlocked=stopped==='SAFETY_FAILURE'||attemptedWrites>0||summary.safetyFailureConversations>0;
  let programSpend:ReturnType<typeof programSpendSummary>|{error:string};
  try{programSpend=programSpendSummary(programSpendTotals(programLedger),programRun);}catch(error){programSpend={error:code(error)};}
  const report={binding,suite:suite.suiteId,mission:mission.id,repeat,stopped,releaseBlocked,providerEvidence:{requests:budget.requests,capturedResponses:captured,complete:captured===budget.requests},
    summary,annotations:annotationSummary(runs.flatMap(run=>run.cases)),passK,attempts,requests:budget.requests,reservedUsd:budget.reservedUsd,missionReservedUsd:budget.missionReservedUsd,missionMaxUsd:budget.missionMaxUsd,priceNote:'Conservative durable reservation, not invoice',
    programSpend,technicalStateWrites,
    intendedConfirmations:0,observedEffects:{measuredCases:sum(attempts.map(a=>a.observedEffects.measuredCases)),unknownCases:attempts.flatMap(a=>a.observedEffects.unknownCases.map(id=>attemptCaseLabel(id,a.attempt))),
      confirmations:sum(attempts.map(a=>a.observedEffects.confirmations)),operationalWrites:sum(attempts.map(a=>a.observedEffects.operationalWrites)),externalMessages:sum(attempts.map(a=>a.observedEffects.externalMessages))},
    flagsFinal:{paid:false},model:'gpt-6-luna',contractVersion};
  evidenceWrite(join(out,'results.json'),report);
  return {out,stopped,repeat,releaseBlocked,...summary,passK:passK.passK,passKComplete:passK.complete,requests:budget.requests,reservedUsd:budget.reservedUsd,missionReservedUsd:budget.missionReservedUsd,programSpend};
}
export function safeOutputDirectory(path:string) {
  const root=resolve(process.cwd(),'packages/salon-secretary/evaluation/results/free-use'),target=resolve(path);
  const within=relative(root,target);if(!within||within.startsWith('..')||within.includes(':'))throw Error('FREE_USE_OUTPUT_DIRECTORY');return target;
}
