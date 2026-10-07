import { z } from "zod";
import { FOLD_FROM, FOLD_TO, foldName, foldedIds, foldedLikePattern, withoutArticle, withoutHonorific } from "./name-search";
import { formatClock } from "./secretary-datetime-format";
import { performance } from "node:perf_hooks";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { assertCustomerAccess, getCustomer } from "./customer-catalog";
import { loadVisitDay, findVisitPlan, visitQuote } from "./visit-scheduling";
import { addCalendarDays, dateKeyInTimeZone, endExclusiveOfDateInTimeZone, isDateKey, localDateTimeToUtc, startOfDateInTimeZone, toLocalDateTime, wallClockMinutesInTimeZone, weekdayOfDateKey } from "./time";
import { subtractIntervals } from "./intervals";
import { multiServiceEnabled } from "../../packages/salon-secretary/src/multi-service";
import { assertSchedulingTemporalConsistency, matchesSchedulingPeriod } from "./scheduling-temporal";
import { inspectAppointmentAvailability } from "./appointment-service";
import { canOverbookRole, canOverrideSlot, validOverbookReason } from "./appointment-overlap-policy";
import { schedulingOverlapEnabled, schedulingReviewSchema, type SchedulingReview } from "./scheduling-conflict-contract";
import { isFirstPersonReference } from "./secretary-first-person";
import { NAME_TOKEN_SCAN, nameTokenQuery, nameTokensEnabled, tokenMatchedIds } from "./secretary-name-tokens";
import { canGrantException, collectExceptionCauses, exceptionLabel, exceptionQuestion, hasScheduleCause, scheduleExceptionsEnabled } from "./schedule-exception-policy";

export const assertSchedulingAccess = assertCustomerAccess;
export type SchedulingMetrics = Partial<Record<"interpretation"|"parsing"|"appointments"|"customers"|"services"|"professional"|"availability"|"proposal"|"message"|"confirmation",number>>;
export async function timed<T>(metrics: SchedulingMetrics, key: keyof SchedulingMetrics, run: ()=>Promise<T>) {
  const t=performance.now(); try{return await run();}finally{metrics[key]=(metrics[key]??0)+performance.now()-t;}
}
const query=z.string().trim().min(2).max(200);
const ref=z.string().min(1).max(100);
/** T03: shared real catalog, explicit minimal projection; no service mutation permission implied. */
export async function listSchedulingServices(tx: Tx, actor: ServiceActor, input: unknown) {
  await assertSchedulingAccess(tx,actor);const q=query.parse(input);
  const rows=await searchSchedulingServices(tx,actor,q);
  return rows.length===1&&servicePickGuardEnabled()?guardSoleService(tx,actor,q,rows[0]):rows;
}
async function searchSchedulingServices(tx: Tx, actor: ServiceActor, q: string) {
  // Case- and accent-insensitive ("coloracao" finds "Coloração"); ambiguity still asks.
  const folded=foldedIds(await tx.$queryRaw`SELECT id FROM "Service" WHERE "salonId"=${actor.salonId} AND active AND lower(translate(name, ${FOLD_FROM}, ${FOLD_TO})) LIKE lower(translate(${foldedLikePattern(q)}, ${FOLD_FROM}, ${FOLD_TO})) ESCAPE '\\' ORDER BY name, id LIMIT 21`);
  const rows=await tx.service.findMany({where:{salonId:actor.salonId,active:true,...(folded.length?{OR:[{name:{contains:q,mode:"insensitive"}},{id:{in:folded}}]}:{name:{contains:q,mode:"insensitive"}})},
    select:serviceSelect,orderBy:[{name:"asc"},{id:"asc"}],take:21});
  const multi=multiServiceEnabled(),abbreviations=serviceAbbreviationsEnabled();
  if(rows.length||(!multi&&!abbreviations))return rows;
  const key=serviceNameKey(q);
  if(!key)return [];
  const all=abbreviations?await tx.service.findMany({where:{salonId:actor.salonId,active:true},select:{...serviceSelect,category:true},orderBy:[{name:"asc"},{id:"asc"}],take:1000}):
    await tx.service.findMany({where:{salonId:actor.salonId,active:true},select:serviceSelect,orderBy:[{name:"asc"},{id:"asc"}],take:1000});
  const bounded=(list:typeof all)=>list.slice(0,21).map(row=>({id:row.id,name:row.name,durationMin:row.durationMin,priceCents:row.priceCents,priceType:row.priceType}));
  // C4 (flag SALON_SECRETARY_MULTI_SERVICE): nothing holds the words as said: the services whose name is the same word for word
  // apart from "de" and its contractions (every such service; several still ask).
  const same=multi?all.filter(row=>serviceNameKey(row.name)===key):[];
  if(same.length||!abbreviations)return bounded(same);
  // Owner 07/10 (flag SALON_SECRETARY_SERVICE_ABBREVIATIONS): still nothing: the words said in a row of the name, a word the
  // catalog abbreviates counting as said ("combo masculino" finds "Combo Masc: Corte + barba"), and the services of a category
  // of the same words (Combo Masculino holds "Corte Masculino + Sobrancelha" too). Several still ask.
  return bounded(all.filter(row=>serviceWordsMatch(q,row.name)||("category" in row&&typeof row.category==="string"&&serviceWordsMatch(q,row.category,true))));
}
const serviceSelect={id:true,name:true,durationMin:true,priceCents:true,priceType:true} as const;
export const serviceAbbreviationsEnabled=(env: Record<string, string | undefined> = process.env)=>env.SALON_SECRETARY_SERVICE_ABBREVIATIONS==="true";
export const servicePickGuardEnabled=(env: Record<string, string | undefined> = process.env)=>env.SALON_SECRETARY_SERVICE_PICK_GUARD==="true";
/** Owner 07/10 (flag SALON_SECRETARY_SERVICE_PICK_GUARD): the one service a search found is taken alone only when it is the name
 * said, or when the words said name what the service is (its first word) and no other service holds them all. Otherwise:
 * - every other service holding all the words said (same word or its plural, any order) joins it in a card ("corte masculino"
 *   found only "Corte Masculino + Sobrancelha na Navalha"; "Corte de cabelo masculino" is asked beside it);
 * - a name said only by a detail of the service ("mão" in "Spa das mãos") finds nothing here: the suggestions ask. */
async function guardSoleService(tx: Tx, actor: ServiceActor, q: string, row: Awaited<ReturnType<typeof searchSchedulingServices>>[number]) {
  const key=serviceNameKey(q);
  if(!key||serviceNameKey(row.name)===key)return [row];
  const words=key.split(" ");
  const all=await tx.service.findMany({where:{salonId:actor.salonId,active:true},select:serviceSelect,orderBy:[{name:"asc"},{id:"asc"}],take:1000});
  const holds=(name:string)=>{const held=serviceNameKey(name).split(" ");return words.every(word=>held.some(other=>sameOrPlural(word,other)));};
  const card=all.filter(other=>other.id===row.id||holds(other.name));
  if(card.length>1)return card.slice(0,21);
  const head=serviceNameKey(row.name).split(" ")[0];
  return head&&words.some(word=>sameServiceWord(word,head))?[row]:[];
}
const sameOrPlural=(a:string,b:string)=>a===b||[`${a}s`,`${a}es`].includes(b)||[`${b}s`,`${b}es`].includes(a);
/** Owner 07/10: one word said and one registered are the same word when equal, or when one starts the other and the shorter has
 * 3+ letters: an abbreviation ("masc" for "masculino", "hidrat" for "hidratação", "progr" for "progressiva") or a plural ("unhas").
 * Never another word ("e" is not "com"); 2 letters abbreviate nothing ("pe" is not "pedicure"). */
const sameServiceWord=(said:string,held:string)=>said===held||(Math.min([...said].length,[...held].length)>=3&&(said.startsWith(held)||held.startsWith(said)));
/** Owner 07/10: the words said, in order and in a row, inside the words of a name (the same words as serviceNameKey: case,
 * accents, punctuation, a leading article and "de" aside), each one the same word as its registered one; `whole`: all of them. */
export function serviceWordsMatch(said:string,name:string,whole=false){
  const words=serviceNameKey(said).split(" ").filter(Boolean),held=serviceNameKey(name).split(" ").filter(Boolean);
  if(!words.length||words.length>held.length||(whole&&words.length!==held.length))return false;
  for(let start=0;start+words.length<=held.length;start++)if(words.every((word,i)=>sameServiceWord(word,held[start+i])))return true;
  return false;
}
/** C4: a service name compared word by word, in order (case, accents and punctuation aside; a leading article is not part of
 * it), without the connective "de" and its contractions "da", "do", "das", "dos" ("manutenção da fibra" is "Manutenção de
 * fibra", "coloração de raiz" is "Coloração raiz"). No other word is dropped or equated ("e" included: "corte barba" is never
 * "Corte e barba", "design e henna" is never "Design com henna"). */
const DE_WORDS=new Set(["de","da","do","das","dos"]);
export const serviceNameKey=(name:string)=>foldName(withoutArticle(name.trim())).split(/[^\p{L}\p{N}]+/u).filter(word=>word&&!DE_WORDS.has(word)).join(" ");
/** Names only (no ids, prices or customers), bounded, for Luna's role disambiguation. */
export async function secretaryDirectory(tx: Tx, actor: ServiceActor) {
  await assertSchedulingAccess(tx,actor);
  const [professionals,services]=await Promise.all([
    tx.professional.findMany({where:{salonId:actor.salonId,active:true},select:{user:{select:{name:true}}},orderBy:{id:"asc"},take:40}),
    tx.service.findMany({where:{salonId:actor.salonId,active:true},select:{name:true},orderBy:[{name:"asc"},{id:"asc"}],take:80}),
  ]);
  const {timezone}=await tx.salon.findUniqueOrThrow({where:{id:actor.salonId},select:{timezone:true}});
  const now=new Date(),date=now.toLocaleDateString("sv-SE",{timeZone:timezone});
  const weekday=now.toLocaleDateString("pt-BR",{timeZone:timezone,weekday:"long"});
  return {professionals:[...new Set(professionals.map(p=>p.user.name).filter((n):n is string=>!!n))],services:[...new Set(services.map(s=>s.name))],today:{date,weekday,timezone}};
}
/** T04: all returned options are active, linked and tenant scoped. No automatic arbitrary assignment.
 * C7: a leading article is not part of the name; an honorific is dropped only when nothing matches with it. */
export async function listSchedulingProfessionals(tx: Tx, actor: ServiceActor, input: unknown) {
  await assertSchedulingAccess(tx,actor);
  // P2a: `service_refs`: only professionals linked to EVERY one of these active services (an altered appointment's new list).
  const p=z.object({service_ref:ref.optional(),service_refs:z.array(ref).min(1).max(10).optional(),query:query.optional()}).strict().parse(input);
  // E2 (V2): the owner's first person is their own active registration in THIS salon, or nobody: never a name search.
  if(p.query!==undefined&&isFirstPersonReference(p.query))return selfProfessional(tx,actor,p.service_ref,p.service_refs);
  const named=p.query?withoutArticle(p.query):undefined,rows=await professionalRows(tx,actor,p.service_ref,named,p.service_refs),bare=named&&!rows.length?withoutHonorific(named):undefined;
  return bare?professionalRows(tx,actor,p.service_ref,bare,p.service_refs):rows;
}
/** E2 (V2): the actor's own active registration here (for listing it first in a card; never a choice by itself). */
export async function schedulingSelfProfessional(tx: Tx, actor: ServiceActor) {
  await assertSchedulingAccess(tx,actor);return (await selfProfessional(tx,actor))[0];
}
/** E2: the actor's own active Professional row in the actor's salon (userId is unique), with the same service filters. */
async function selfProfessional(tx: Tx, actor: ServiceActor, serviceRef?: string, serviceRefs?: readonly string[]) {
  const row=await tx.professional.findFirst({where:{salonId:actor.salonId,userId:actor.userId,active:true,
    ...(serviceRef?{services:{some:{serviceId:serviceRef,service:{salonId:actor.salonId,active:true}}}}:{}),
    ...(serviceRefs?.length?{AND:serviceRefs.map(serviceId=>({services:{some:{serviceId,service:{salonId:actor.salonId,active:true}}}}))}:{})},
    select:{id:true,user:{select:{name:true}}}});
  return row?[{id:row.id,name:row.user.name}]:[];
}
async function professionalRows(tx: Tx, actor: ServiceActor, serviceRef: string|undefined, name: string|undefined, serviceRefs?: readonly string[]) {
  const p={service_ref:serviceRef,query:name};
  // Sentence punctuation can be retained in a name extracted from a transcript.
  // Keep internal name characters; return all matches so ambiguity still requires selection.
  const professionalQuery=p.query?.replace(/[.!?]+$/u, "").trim();
  if(p.query&&(!professionalQuery||professionalQuery.length<2))return [];
  // C5 (flag SALON_SECRETARY_WHOLE_NAME_MATCH): a name matches by whole tokens only ("Ana" never finds "Mariana"); same scope, order and
  // bound. Past the scan (undefined) the historical search below answers.
  const tokenIds=professionalQuery&&nameTokensEnabled()?await professionalTokenIds(tx,actor,professionalQuery):undefined;
  if(tokenIds&&!tokenIds.length)return [];
  // Case- and accent-insensitive ("fabio" finds "Fábio"); ambiguity still returns every match.
  const folded=professionalQuery&&!tokenIds?foldedIds(await tx.$queryRaw`SELECT p.id FROM "Professional" p JOIN "User" u ON u.id=p."userId" WHERE p."salonId"=${actor.salonId} AND p.active AND lower(translate(u.name, ${FOLD_FROM}, ${FOLD_TO})) LIKE lower(translate(${foldedLikePattern(professionalQuery)}, ${FOLD_FROM}, ${FOLD_TO})) ESCAPE '\\' ORDER BY p.id LIMIT 21`):[];
  const byName=professionalQuery&&!tokenIds?{user:{name:{contains:professionalQuery,mode:"insensitive" as const}}}:undefined;
  const rows=await tx.professional.findMany({where:{salonId:actor.salonId,active:true,
    ...(p.service_ref?{services:{some:{serviceId:p.service_ref,service:{salonId:actor.salonId,active:true}}}}:{}),
    ...(serviceRefs?.length?{AND:serviceRefs.map(serviceId=>({services:{some:{serviceId,service:{salonId:actor.salonId,active:true}}}}))}:{}),
    ...(tokenIds?{id:{in:tokenIds}}:byName?folded.length?{OR:[byName,{id:{in:folded}}]}:byName:{})},
    select:{id:true,user:{select:{name:true}}},orderBy:{id:"asc"},take:21});
  return rows.map(r=>({id:r.id,name:r.user.name}));
}
/** C5: ids of this salon's active professionals whose name holds every token of `name` (secretary-name-tokens); the SQL only
 * prefilters by each written token as a folded substring. Undefined past the scan. */
async function professionalTokenIds(tx: Tx, actor: ServiceActor, name: string) {
  const {tokens,patterns}=nameTokenQuery(name);
  return tokens.length?tokenMatchedIds(tokens,await tx.$queryRaw`SELECT p.id, u.name FROM "Professional" p JOIN "User" u ON u.id=p."userId" WHERE p."salonId"=${actor.salonId} AND p.active AND NOT EXISTS (SELECT 1 FROM unnest(${patterns}::text[]) AS t(pattern) WHERE lower(translate(u.name, ${FOLD_FROM}, ${FOLD_TO})) NOT LIKE lower(translate(t.pattern, ${FOLD_FROM}, ${FOLD_TO})) ESCAPE '\\') ORDER BY p.id LIMIT ${NAME_TOKEN_SCAN+1}::int`):[];
}
export async function schedulingTimezone(tx: Tx,actor: ServiceActor) {
  await assertSchedulingAccess(tx,actor);
  return (await tx.salon.findUniqueOrThrow({where:{id:actor.salonId},select:{timezone:true}})).timezone;
}
export const slotInput=z.object({service_ref:ref,service_refs:z.array(ref).min(2).max(10).optional(),professional_ref:ref,date:z.string().refine(isDateKey),time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),period:z.enum(["morning","afternoon","evening"]).optional(),override_requested:z.boolean().optional(),override_reason:z.string().max(200).optional()}).strict();
/** T07: same visit engine as the application. One day, one chosen professional, bounded alternatives.
 * `excluded` (C4): local clocks ("HH:mm") the owner excluded; never offered as an alternative.
 * `service_refs` (P2b, flag SALON_SECRETARY_MULTI_SERVICE): every service of ONE appointment, in order (its first is
 * service_ref, no repeats): the chosen professional must perform all of them and the domain plans them back to back with that
 * professional (the summed duration the visit engine computes; one appointment when created).
 * `limit` (P3b, flag SALON_SECRETARY_READS_V2, availability reads only): how many alternatives to look for (one more than are
 * shown tells the read that more free times exist); every other caller keeps the historical 5. */
export async function getSchedulingAvailability(tx: Tx,actor: ServiceActor,input: unknown,now=new Date(),projection?: {releasedAppointmentId:string},excluded?: ReadonlySet<string>,limit=5,exceptions=false) {
  await assertSchedulingAccess(tx,actor);const p=slotInput.parse(input);
  assertSchedulingTemporalConsistency(p);
  const ids=p.service_refs??[p.service_ref];
  if(p.service_refs&&(p.service_refs[0]!==p.service_ref||new Set(p.service_refs).size!==p.service_refs.length))throw Error("SERVICE_INVALID");
  const eligible=await tx.professional.findFirst({where:{id:p.professional_ref,salonId:actor.salonId,active:true,...(p.service_refs?{AND:ids.map(serviceId=>({services:{some:{serviceId,service:{salonId:actor.salonId,active:true}}}}))}:
    {services:{some:{serviceId:p.service_ref,service:{salonId:actor.salonId,active:true}}}})},select:{id:true}});
  if(!eligible)throw new Error("PRO_SERVICE_MISMATCH");
  for(const id of ids){
    const service=await tx.service.findFirstOrThrow({where:{id,salonId:actor.salonId,active:true},select:{physicalResourceId:true}});
    if(service.physicalResourceId&&!await tx.physicalResource.findFirst({where:{id:service.physicalResourceId,salonId:actor.salonId,active:true},select:{id:true}}))throw Error("RESOURCE_UNAVAILABLE");
  }
  const choices=ids.map(serviceId=>({serviceId,professionalId:p.professional_ref}));
  const day=await loadVisitDay(tx,actor.salonId,p.date,choices,now,projection);
  const at=(minute:number)=>`${p.date}T${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;
  const planAt=(minute:number)=>localDateTimeToUtc(at(minute),day.salon.timezone)>now ? findVisitPlan(day,choices,minute,{manual:true}):null;
  const requested=p.time?Number(p.time.slice(0,2))*60+Number(p.time.slice(3)):undefined;
  let plan=requested!==undefined?planAt(requested):null;
  const alternatives=[];
  for(let minute=0;minute<1440 && alternatives.length<limit;minute+=15){
    if(requested!==undefined && minute<=requested)continue;
    if(!matchesSchedulingPeriod(at(minute).slice(11),p.period)||excluded?.has(at(minute).slice(11)))continue;
    const option=planAt(minute);if(option)alternatives.push({startLocal:option.startLocal,endLocal:option.endLocal,professional_ref:p.professional_ref});
  }
  let review: SchedulingReview | undefined;
  if (schedulingOverlapEnabled() && requested !== undefined) {
    const inspected=await inspectAppointmentAvailability(tx,{salonId:actor.salonId,professionalId:p.professional_ref,serviceIds:ids,
      startLocal:at(requested),enforceBookingWindow:false,now,excludeAppointmentId:projection?.releasedAppointmentId});
    const membership=await tx.membership.findFirstOrThrow({where:{salonId:actor.salonId,userId:actor.userId},select:{role:true}});
    const future=inspected.startAt>now;
    // 05/10 (flag SALON_SECRETARY_SCHEDULE_EXCEPTIONS, opt-in per caller): a schedule exception — outside hours, a block, the break,
    // finishing after hours, an overlap beside them — asks once for every cause; the reason is optional. A plain overlap keeps
    // the encaixe flow below verbatim. Closures, past times, resources and waitlist offers stay hard blocks.
    const exception=exceptions&&scheduleExceptionsEnabled()?await collectExceptionCauses(
      skips=>inspectAppointmentAvailability(tx,{salonId:actor.salonId,professionalId:p.professional_ref,serviceIds:ids,startLocal:at(requested),enforceBookingWindow:false,now,excludeAppointmentId:projection?.releasedAppointmentId,...skips}),
      async()=>!!await tx.timeOff.findFirst({where:{professionalId:p.professional_ref,professional:{salonId:actor.salonId},startAt:{lt:inspected.endAt},endAt:{gt:inspected.startAt}},select:{id:true}})):undefined;
    if(exception&&hasScheduleCause(exception.causes)){
      const closed=day.closures.some(c=>c.startAt<inspected.endAt&&c.endAt>inspected.startAt);
      const allowed=future&&!closed&&!exception.hard.length&&canGrantException(membership.role,exception.causes);
      const startLocal=toLocalDateTime(inspected.startAt,inspected.timezone),endLocal=toLocalDateTime(inspected.endAt,inspected.timezone);
      const conflicts=(exception.final?.conflicts??[]).flatMap(c=>c.startAt&&c.endAt?[{startLocal:toLocalDateTime(c.startAt,inspected.timezone),endLocal:toLocalDateTime(c.endAt,inspected.timezone),
        overlapMinutes:Math.max(0,(Math.min(inspected.endAt.getTime(),c.endAt.getTime())-Math.max(inspected.startAt.getTime(),c.startAt.getTime()))/60000)}]:[]);
      const causes=[...new Set([...exception.causes,...exception.hard,...(closed?["SALON_CLOSED"]:[]),...(!future?["PAST_START"]:[])])];
      const consented=allowed&&p.override_requested===true;
      const missing=!allowed||p.override_requested===false?["destination_mode"]:consented?[]:["override_requested"];
      if(consented)plan=findVisitPlan(day,choices,requested,{manual:true,overrideSchedule:true,allowAppointmentOverlap:exception.causes.includes("SLOT_TAKEN")});
      if(!allowed||missing.length)plan=null;
      const pro=await tx.professional.findFirst({where:{id:p.professional_ref,salonId:actor.salonId},select:{user:{select:{name:true}}}});
      const clock=(local:string)=>formatClock(local.slice(11,16));
      const options=alternatives.length?`Tenho ${alternatives.map(a=>clock(a.startLocal)).join(", ")}. Qual horário você prefere?`:"Não encontrei outra opção nesta data. Qual outra data ou horário você prefere consultar?";
      const hardCause=closed?" O salão está fechado nesse horário.":!future?" Esse horário já passou.":exception.hard.includes("RESOURCE")?" A sala ou equipamento está reservado.":
        exception.hard.includes("WAITLIST")?" O horário está reservado por uma oferta da fila.":exception.hard.length?" Há uma restrição de agenda.":" Seu acesso não permite abrir essa exceção.";
      const message=!allowed?`Esse horário está indisponível.${hardCause} ${options}`:missing[0]==="destination_mode"?options:missing.length?
        exceptionQuestion("appointment.create",exception.causes,pro?.user.name,endLocal,conflicts.map(c=>c.startLocal),alternatives.map(a=>a.startLocal)):
        `Exceção autorizada (${exceptionLabel(exception.causes)}) para ${clock(startLocal)}–${clock(endLocal)}. Aguarda confirmação.`;
      review=schedulingReviewSchema.parse({status:allowed?"CONFLICT_OVERRIDABLE":"CONFLICT_HARD_BLOCK",startLocal,endLocal,durationMin:(inspected.endAt.getTime()-inspected.startAt.getTime())/60000,
        causes,conflicts,override_allowed:allowed,missing_fields:missing,message,alternatives});
    } else {
      // Domain validation returns the first violation. Preserve independent
      // closure facts already loaded in this tenant's day even if working hours
      // failed first; both causes remain true and closure always blocks override.
      const closed=day.closures.some(c=>c.startAt<inspected.endAt&&c.endAt>inspected.startAt);
      const allowed=future && !closed && canOverrideSlot(inspected.violation,inspected.conflicts,canOverbookRole(membership.role));
      const status=!future||closed ? "CONFLICT_HARD_BLOCK" : !inspected.violation ? "AVAILABLE" : allowed ? "CONFLICT_OVERRIDABLE" : "CONFLICT_HARD_BLOCK";
      const startLocal=toLocalDateTime(inspected.startAt,inspected.timezone),endLocal=toLocalDateTime(inspected.endAt,inspected.timezone);
      const conflicts=inspected.conflicts.flatMap(c=>c.startAt&&c.endAt?[{startLocal:toLocalDateTime(c.startAt,inspected.timezone),endLocal:toLocalDateTime(c.endAt,inspected.timezone),
        overlapMinutes:Math.max(0,(Math.min(inspected.endAt.getTime(),c.endAt.getTime())-Math.max(inspected.startAt.getTime(),c.startAt.getTime()))/60000)}]:[]);
      const causes=[...new Set([...(inspected.violation?[inspected.violation]:[]),...inspected.conflicts.map(c=>c.kind),...(closed?["SALON_CLOSED"]:[]),...(!future?["PAST_START"]:[])])];
      const missing=status==="CONFLICT_OVERRIDABLE" ? p.override_requested===false?["destination_mode"]:p.override_requested!==true?["override_requested"]:!validOverbookReason(p.override_reason)?["override_reason"]:[] : status==="CONFLICT_HARD_BLOCK"?["destination_mode"]:[];
      if (allowed && p.override_requested && validOverbookReason(p.override_reason))
        plan=findVisitPlan(day,choices,requested,{manual:true,allowAppointmentOverlap:true});
      if(status==="CONFLICT_HARD_BLOCK" || missing.length)plan=null;
      const clock=(local:string)=>formatClock(local.slice(11,16));
      const options=alternatives.length?`Tenho ${alternatives.map(a=>clock(a.startLocal)).join(", ")}. Qual horário você prefere?`:"Não encontrei outra opção nesta data. Qual outra data ou horário você prefere consultar?";
      // Explain the backend's own cause; only mention "encaixe" when it was requested.
      const blockCause=causes.includes("SALON_CLOSED")?" O salão está fechado nesse horário.":causes.includes("PAST_START")?" Esse horário já passou.":
        causes.includes("RESOURCE")?" A sala ou equipamento está reservado.":causes.includes("WAITLIST")?" O horário está reservado por uma oferta da fila.":
        causes.some(c=>["OUTSIDE_WORKING_HOURS","AFTER_WORKING_HOURS","WORKING_HOURS_BREAK"].includes(c))?" Fica fora do expediente do profissional.":
        causes.includes("PROFESSIONAL_UNAVAILABLE")?" O profissional está indisponível (folga ou bloqueio).":
        causes.includes("SLOT_TAKEN")?" Já existe outro atendimento nesse horário.":" Há uma restrição de agenda ou permissão.";
      const message=status==="AVAILABLE"?"Horário disponível.":status==="CONFLICT_HARD_BLOCK"?
        `${p.override_requested===true?"Não posso fazer encaixe nesse horário.":"Esse horário está indisponível."}${blockCause} ${options}`:
        missing[0]==="destination_mode"?options:missing[0]==="override_reason"?"Qual o motivo do encaixe?":missing.length?
          `${inspected.services.map(s=>s.name).join(", ")} vai até ${clock(endLocal)}${conflicts[0]?` e há outro atendimento às ${clock(conflicts[0].startLocal)}`:" e há conflito na agenda"}. Quer fazer o encaixe ou escolher outro horário?${alternatives.length?` Livres: ${alternatives.map(a=>clock(a.startLocal)).join(", ")}.`:""}`:
          `Encaixe solicitado para ${clock(startLocal)}–${clock(endLocal)}, com motivo registrado. Aguarda confirmação.`;
      review=schedulingReviewSchema.parse({status,startLocal,endLocal,durationMin:(inspected.endAt.getTime()-inspected.startAt.getTime())/60000,causes,conflicts,override_allowed:allowed,missing_fields:missing,message,alternatives});
    }
  }
  return {timezone:day.salon.timezone,plan,quote:plan?visitQuote(plan):null,alternatives,as_of:now.toISOString(),...(review?{review}:{})};
}
const appointmentSelect={id:true,clientId:true,professionalId:true,serviceId:true,startAt:true,endAt:true,status:true,version:true,timezone:true,priceCents:true,
  client:{select:{name:true}},professional:{select:{user:{select:{name:true}}}},serviceItems:{orderBy:{position:"asc" as const},select:{serviceName:true,durationMin:true,priceCents:true,priceType:true}}} as const;
async function listAppointments(tx:Tx,actor:ServiceActor,where: Parameters<Tx["appointment"]["findMany"]>[0]) {
  const rows=await tx.appointment.findMany({...where,select:appointmentSelect});
  return rows.map(r=>({appointment_ref:r.id,customer_ref:r.clientId,customer_name:r.client.name,professional_ref:r.professionalId,
    professional_name:r.professional.user.name,service_ref:r.serviceId,services:r.serviceItems,start_at:r.startAt.toISOString(),end_at:r.endAt.toISOString(),start_local:toLocalDateTime(r.startAt,r.timezone),end_local:toLocalDateTime(r.endAt,r.timezone),
    status:r.status,revision:r.version,timezone:r.timezone,priceCents:r.priceCents}));
}
/** P3b (flag SALON_SECRETARY_READS_V2): `time`/`period`, the start filter of a day read, applied by the query itself (before its
 * row limit). Without them the query is the historical one. */
const dayInput=z.object({date:z.string().refine(isDateKey),customer_ref:ref.optional(),professional_ref:ref.optional(),service_ref:ref.optional(),
  time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),period:z.enum(["morning","afternoon","evening"]).optional()}).strict();
/** The tenant-scoped where of a day read (its refs checked in the tenant first). A clock is that start minute; a period uses the
 * boundaries of matchesSchedulingPeriod (morning < 12h <= afternoon < 18h <= evening), in the salon's timezone. */
async function dayWhere(tx:Tx,actor:ServiceActor,input:unknown) {
  const p=dayInput.parse(input);
  const timezone=await schedulingTimezone(tx,actor);
  if(p.customer_ref)await getCustomer(tx,actor,p.customer_ref);
  if(p.professional_ref && !await tx.professional.findFirst({where:{id:p.professional_ref,salonId:actor.salonId},select:{id:true}}))throw Error("PROFESSIONAL_NOT_FOUND");
  if(p.service_ref&&!await tx.service.findFirst({where:{id:p.service_ref,salonId:actor.salonId},select:{id:true}}))throw Error("SERVICE_NOT_FOUND");
  const local=(clock:string)=>localDateTimeToUtc(`${p.date}T${clock}`,timezone);
  const from=p.time?local(p.time):p.period==="afternoon"?local("12:00"):p.period==="evening"?local("18:00"):startOfDateInTimeZone(p.date,timezone);
  const to=p.time?new Date(from.getTime()+60_000):p.period==="morning"?local("12:00"):p.period==="afternoon"?local("18:00"):endExclusiveOfDateInTimeZone(p.date,timezone);
  return {salonId:actor.salonId,startAt:{gte:from,lt:to},
    ...(p.customer_ref?{clientId:p.customer_ref}:{}),...(p.professional_ref?{professionalId:p.professional_ref}:{}),...(p.service_ref?{OR:[{serviceId:p.service_ref},{serviceItems:{some:{serviceId:p.service_ref}}}]}:{})};
}
/** T05: bounded day query. No raw ClientProfile/User or financial data. */
export async function listSchedulingAppointments(tx:Tx,actor:ServiceActor,input:unknown) {
  return listAppointments(tx,actor,{where:await dayWhere(tx,actor,input),orderBy:[{startAt:"asc"},{id:"asc"}],take:51});
}
/** Owner 07/10 ("verifica a agenda da Beatriz para essa semana"): the PENDING/CONFIRMED appointments starting on the local days
 * [from, to] (a week read), with the same tenant-checked filters as a day read; bounded like it (51 rows: one more says "há mais"). */
const rangeInput=z.object({from:z.string().refine(isDateKey),to:z.string().refine(isDateKey),customer_ref:ref.optional(),professional_ref:ref.optional(),service_ref:ref.optional()}).strict();
export async function listSchedulingAppointmentsRange(tx:Tx,actor:ServiceActor,input:unknown) {
  const p=rangeInput.parse(input);
  if(p.to<p.from||addCalendarDays(p.from,13)<p.to)throw Error("RANGE_INVALID");
  const where=await dayWhere(tx,actor,{date:p.from,...(p.customer_ref?{customer_ref:p.customer_ref}:{}),...(p.professional_ref?{professional_ref:p.professional_ref}:{}),...(p.service_ref?{service_ref:p.service_ref}:{})});
  const timezone=await schedulingTimezone(tx,actor);
  return listAppointments(tx,actor,{where:{...where,status:{in:["PENDING","CONFIRMED"]},startAt:{gte:startOfDateInTimeZone(p.from,timezone),lt:endExclusiveOfDateInTimeZone(p.to,timezone)}},
    orderBy:[{startAt:"asc"},{id:"asc"}],take:51});
}
/** P3b (flag SALON_SECRETARY_READS_V2): the same day query counted, never listed, when it holds more rows than a read shows: per
 * professional (count, first and last start, in start order) and per period; cancellations are counted apart. Names only (no
 * customer), tenant scoped, bounded (`more`: over 1000 rows). */
export async function summarizeSchedulingAppointments(tx:Tx,actor:ServiceActor,input:unknown) {
  const rows=await tx.appointment.findMany({where:await dayWhere(tx,actor,input),select:{startAt:true,timezone:true,status:true,professionalId:true,professional:{select:{user:{select:{name:true}}}}},
    orderBy:[{startAt:"asc"},{id:"asc"}],take:1001});
  const kept=rows.slice(0,1000),active=kept.filter(r=>r.status!=="CANCELLED"),periods={morning:0,afternoon:0,evening:0};
  const professionals=new Map<string,{professional_ref:string;professional_name:string;count:number;first_local:string;last_local:string}>();
  for(const r of active){
    const local=toLocalDateTime(r.startAt,r.timezone),clock=local.slice(11);
    periods[matchesSchedulingPeriod(clock,"morning")?"morning":matchesSchedulingPeriod(clock,"afternoon")?"afternoon":"evening"]++;
    const row=professionals.get(r.professionalId);
    if(row){row.count++;row.last_local=local;}else professionals.set(r.professionalId,{professional_ref:r.professionalId,professional_name:r.professional.user.name,count:1,first_local:local,last_local:local});
  }
  return {total:active.length,cancelled:kept.length-active.length,more:rows.length>1000,professionals:[...professionals.values()],periods};
}
/** T06: opaque reference only from an authorized backend/UI selection. */
export async function getSchedulingAppointment(tx:Tx,actor:ServiceActor,input:unknown) {
  await assertSchedulingAccess(tx,actor);const id=ref.parse(input);
  const [row]=await listAppointments(tx,actor,{where:{id,salonId:actor.salonId},take:1});
  if(!row)throw Error("APPOINTMENT_NOT_FOUND");return row;
}
/** C7: the customer's next future PENDING/CONFIRMED appointments (tenant scoped, bounded), or, with `overlapping`
 * (UTC [start, end)), those whose time overlaps it. Shown beside a NEW booking; nothing here blocks or picks.
 * P3b (flag SALON_SECRETARY_READS_V2): `professional_ref`/`service_ref`, the filters a read of that customer said (any service of
 * the appointment, as the day read does); absent, the historical query. */
export async function listUpcomingCustomerAppointments(tx:Tx,actor:ServiceActor,customerRef:string,options:{take?:number;overlapping?:{start:Date;end:Date};now?:Date;professional_ref?:string;service_ref?:string}={}) {
  await assertSchedulingAccess(tx,actor);
  const window=options.overlapping?{startAt:{gt:options.now??new Date(),lt:options.overlapping.end},endAt:{gt:options.overlapping.start}}:{startAt:{gt:options.now??new Date()}};
  const service=options.service_ref?ref.parse(options.service_ref):undefined;
  return listAppointments(tx,actor,{where:{salonId:actor.salonId,clientId:ref.parse(customerRef),status:{in:["PENDING","CONFIRMED"]},...window,
    ...(options.professional_ref?{professionalId:ref.parse(options.professional_ref)}:{}),...(service?{OR:[{serviceId:service},{serviceItems:{some:{serviceId:service}}}]}:{})},orderBy:[{startAt:"asc"},{id:"asc"}],take:Math.min(options.take??3,20)});
}
/** Days ahead a professional's next working day is looked for. */
export const PROFESSIONAL_DAY_HORIZON=31;
/** C4 owner rule 6 (flag SALON_SECRETARY_READS_V2): the day a read of ONE professional with no day said is about. Today while that
 * professional still has a PENDING/CONFIRMED appointment starting from now (with the read's service filter); otherwise the
 * professional's next working day: their weekly hours or an extra opening that day, not wholly taken by a salon closure or by
 * their own time off, within PROFESSIONAL_DAY_HORIZON days. Undefined (the day is asked) when the salon has no working hours
 * configured or no such day exists. Read-only, tenant scoped, nothing picked for the owner. */
export async function professionalReadDay(tx:Tx,actor:ServiceActor,input:{professional_ref:string;service_ref?:string},now=new Date()):Promise<{date:string;today:boolean}|undefined>{
  await assertSchedulingAccess(tx,actor);
  const professional=ref.parse(input.professional_ref),service=input.service_ref?ref.parse(input.service_ref):undefined,salonId=actor.salonId;
  if(!await tx.professional.findFirst({where:{id:professional,salonId},select:{id:true}}))throw Error("PROFESSIONAL_NOT_FOUND");
  const timezone=await schedulingTimezone(tx,actor),today=dateKeyInTimeZone(now,timezone);
  const left=await tx.appointment.findFirst({where:{salonId,professionalId:professional,status:{in:["PENDING","CONFIRMED"]},startAt:{gte:now,lt:endExclusiveOfDateInTimeZone(today,timezone)},
    ...(service?{OR:[{serviceId:service},{serviceItems:{some:{serviceId:service}}}]}:{})},select:{id:true}});
  if(left)return {date:today,today:true};
  if(!await tx.workingHours.findFirst({where:{salonId},select:{id:true}}))return;
  const first=addCalendarDays(today,1),last=addCalendarDays(today,PROFESSIONAL_DAY_HORIZON),from=startOfDateInTimeZone(first,timezone),to=endExclusiveOfDateInTimeZone(last,timezone);
  const weekly=await tx.workingHours.findMany({where:{salonId,professionalId:professional},select:{weekday:true,startMinutes:true,endMinutes:true}});
  const openings=await tx.professionalOpening.findMany({where:{salonId,professionalId:professional,dateKey:{gte:first,lte:last}},select:{dateKey:true,startMinutes:true,endMinutes:true}});
  const closures=await tx.salonClosure.findMany({where:{salonId,startAt:{lt:to},endAt:{gt:from}},select:{startAt:true,endAt:true}});
  // TimeOff has no salonId of its own: it is scoped through its professional's salon.
  const offs=await tx.timeOff.findMany({where:{professionalId:professional,professional:{salonId},startAt:{lt:to},endAt:{gt:from}},select:{startAt:true,endAt:true}});
  for(let n=1;n<=PROFESSIONAL_DAY_HORIZON;n++){
    const day=addCalendarDays(today,n),start=startOfDateInTimeZone(day,timezone),end=endExclusiveOfDateInTimeZone(day,timezone);
    const local=(at:Date)=>at<=start?0:at>=end?1440:wallClockMinutesInTimeZone(at,timezone);
    const work=[...weekly.filter(row=>row.weekday===weekdayOfDateKey(day)),...openings.filter(row=>row.dateKey===day)].map(row=>({start:row.startMinutes,end:row.endMinutes}));
    const away=[...closures,...offs].filter(row=>row.startAt<end&&row.endAt>start).map(row=>({start:local(row.startAt),end:local(row.endAt)}));
    if(subtractIntervals(work,away).length)return {date:day,today:false};
  }
}
