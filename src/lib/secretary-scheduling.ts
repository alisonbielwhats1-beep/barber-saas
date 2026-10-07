import { saysWholeDay, wholeDayBounds } from "./schedule-block-whole-day";
import { daypartChoiceRetry, firstTemporalAmbiguity, nextTemporalAmbiguities, temporalAmbiguityQuestion, type PendingTemporalAmbiguity } from "./scheduling-temporal-ambiguity";
import { firstCalendarConflict, nextCalendarConflicts, calendarConflictQuestion, dateChoiceRetryFor, type PendingCalendarConflict } from "./scheduling-calendar-conflict";
import { coherentIntervalReadings, dateRulesV2Enabled, daypartRulesV2Enabled } from "./scheduling-temporal-reference";
import { closedDayText, closedReadingsText, daypartByHoursEnabled, daypartPurpose, hoursAlternatives, hoursContext, loadDayFacts, loadNowFacts, openBlockPairs, openReadings, type DayFacts, type DaypartField, type HoursContext, type OpenReadings } from "./scheduling-daypart-facts";
import type { LocatorHint, PastReading } from "./scheduling-temporal-mode";
import { askedSourceFields, groundSchedulingReasons, pendingSourceFields, type ReasonField, type ReasonRejection } from "./scheduling-literal-source";
import { performance } from "node:perf_hooks";
import { assertSchedulingExceptionScope, exceptionRulesV2Enabled, literalOverrideConsent, reconcileExceptionDecision, type SchedulingReview } from "./scheduling-conflict-contract";
import { serviceDirectoryProof, validateSchedulingEntityMentions, withoutCustomerMentions } from "./scheduling-entity-mentions";
import { runServicesTurn, referencesV2Enabled, referenceConflictNotice, type Model, type SchedulingInterpretation } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { searchSalonCustomer } from "./customer-catalog";
import { getOperationRequirements } from "./service-contract";
import { schedulingPatch, schedulingResolved, type SchedulingFields } from "./scheduling-contract";
import type { AgentBasis } from "./secretary-agent-validator";
import { applyKeptDayGuard, applyScopeCoverage, serviceSwapV2Enabled } from "./scheduling-temporal-source";
import { daypartWrittenOutside, groundSchedulingTemporalTurn, SELECTOR_CONFLICT } from "./scheduling-temporal-mode";
import { EXCLUDED_VALUE, excludedClocks, polarityCodes } from "./scheduling-temporal-polarity";
import { schedulingNegativeContext, withTemporalTurnDrafts } from './secretary-temporal-turn';
import { clarificationContext } from "./secretary-clarification";
import { secretaryFastPath } from "./secretary-fast-path";
import { getSchedulingAppointment, getSchedulingAvailability, listSchedulingAppointments, listSchedulingProfessionals, listSchedulingServices, listUpcomingCustomerAppointments, professionalReadDay, servicePickGuardEnabled, schedulingSelfProfessional, schedulingTimezone, summarizeSchedulingAppointments, timed, type SchedulingMetrics } from "./scheduling-catalog";
import { localDateTimeToUtc, toLocalDateTime } from "./time";
import { upsertSchedulingDraft, proposeAppointmentCreate, proposeSchedulingAction, schedulingSnapshot, confirmAppointmentCreate, type SchedulingForgetField } from "./scheduling-actions";
import { authorizeSchedulingOperation, isSchedulingMutation, locateSchedulingAppointments, inspectSchedulingMove, schedulingActionSnapshot } from "./scheduling-mutations";
import { exceptionHash, exceptionQuestion, hasScheduleCause, scheduleExceptionPending, scheduleExceptionsEnabled } from "./schedule-exception-policy";
import { applyTemporalRejections, reconcileSchedulingTemporal, schedulingTemporalConflicts, matchesSchedulingPeriod, type TemporalRejection } from "./scheduling-temporal";
import { formatClock, formatDay, formatLocal } from "./secretary-datetime-format";
import { directorySubsetProof, nameInText, phoneticNamesEnabled, sameName, samePhoneticName } from "./name-search";
import { sameAcceptedQuery } from "./secretary-entity-context";
import { appointmentEchoRoles, onlyRestatesOptions, optionName, replyOnlyPicks } from "./secretary-options";
import { temporalValueRoles, type SchedulingTemporalEvidence } from "@everflair/salon-secretary";
import { confirmQuestion, detailQuestion, nameSuggestionsEnabled, recordNameCheck, recordNameResolution, salonDirectoryNames, suggestedRows, suggestionQuestion, suggestSalonCustomers, suggestSchedulingProfessionals, suggestSchedulingServices, type Suggested } from "./entity-suggestions";
import { ALIAS_REJECT_REF, aliasCard, aliasKey, aliasKindOf, aliasQuestion, aliasUsed, candidateSetHash, forgetAlias, learnAlias, nameAliasesEnabled, proposeAlias, type AliasRef } from "./secretary-name-aliases";
import { requiredFieldHeld, schedulingRequiredFields, schedulingServiceRefs } from "./scheduling-contract";
import { alterationAskQuestion, alterationMissingLabels, alteringChange, groundAlteration, resolveAlteration, selectAlteration, type AlterationField } from "./secretary-alteration";
import { groundServiceList, listAnswer, resolveServiceList, selectServiceList, serviceListLabel, serviceListMissingLabels, unansweredServiceCard, isServiceListField, notPerformingAll, nobodyPerformsAll, singleServiceCombo } from "./secretary-multi-service";
import { temporalFieldLabels } from "./scheduling-field-labels";
import { secretaryCopyV2Enabled } from "./secretary-error-copy";
import { alterAppointmentEnabled } from "../../packages/salon-secretary/src/alter-appointment";
import { isFirstPersonReference } from "./secretary-first-person";
import { readsV2Enabled, upcomingAppointments, upcomingMessage, daySummaryMessage, summaryOptions, availabilityAcross, availabilityAcrossMessage, periodLabel, ACROSS_MAX, SLOT_LIMIT, DAY_LIST_LIMIT } from "./secretary-reads";
import { recurrenceFromTurn, recurrenceNotice, recurrencePending, recurrenceQuestion, FIRST_ONLY_REF, RECURRENCE_CARD, type RecurrenceState } from "./secretary-recurrence";
import { blockOverlapChosen, blockOverlapGuardEnabled, blockOverlapQuestion, blockOverlapSelection, BLOCK_OVERLAP_CARD, type BlockOverlapChoice } from "./secretary-block-guard";
import { pilotRescheduleEnabled } from "./secretary-pilot";

/** `source` (C3, only with SALON_SECRETARY_NAME_SUGGESTIONS): "suggest" = tolerant suggestions after an empty search,
 * rechecked by the same suggest function; "confirm" = rows of a name Luna wrote that the message does not contain.
 * D1 (only with SALON_SECRETARY_NAME_ALIASES): "alias" = the entity a learned alias proposes (one option to confirm, then
 * "não é essa pessoa"); `alias_basis` = the hash of the exact search's result set for the typed name when a card was
 * published (what an alias learned from a click on it remembers). `alias_declined`: typed names whose alias the owner
 * refused in this action (never proposed again here).
 * `unproven_names`: roles whose current name is such a model claim (never auto-resolved).
 * `selected_names` (B4): the name of the option the owner chose per role; its re-echo keeps the chosen ref. */
/** C5 (flag SALON_SECRETARY_SAME_AS): this action's links to other actions' values, backend-owned. `seeded`: the value
 * copied per field (date/time as the journal holds them; professional/customer as a backend ref). `waiting`: fields whose
 * referenced value is not known (or was retracted): never asked, never guessed, never usable, so no proposal meanwhile.
 * `asked`: fields whose reference was not honored (unproven, contradicted, gone): asked, never inherited or auto-assigned.
 * `released`: the appointment a pending cancellation of the same plan releases; the move is checked as if it were free
 * (execution re-checks the committed agenda after that cancellation). `note`: the waiting note; `notice`: the conflict
 * notice; `blocked`: the last preparation only waits. */
export type SameAsField="date"|"time"|"professional"|"customer"|"service";
/** P3a (flag SALON_SECRETARY_REFERENCES_V2): `origin`, a change's own origin day/clock to keep (seeded from the located
 * appointment; D-SELF-ORIGIN); `card`, the options a reference could not settle alone (a read's rows, several services), asked
 * until chosen (why a referenced value is not used is the `notice`, said until its `asked` fields are known); `release`, the
 * DESTINATION of the reschedule whose origin a create takes (D1: `released` is then that appointment, projected out). */
export type SchedulingReferences={seeded?:Partial<Record<SameAsField,string>>;waiting?:SameAsField[];asked?:SameAsField[];released?:string;note?:string;notice?:string;blocked?:true;
  origin?:("date"|"time")[];card?:{kind:"appointment_ref"|"service_ref";items:{id:string;name:string}[]};
  release?:{professional_ref:string;start:string;end:string}};
/** `resolved_names` (B7): display names of refs this adapter resolved from a single match, keyed by ref (presentation
 * only: sentences name the subject as registered; never read by interpretation, drafts or proposals). */
/** Flag SALON_SECRETARY_DATE_RULES_V2 only: `past_readings`, the past reading dropped from a mutation's day (shown while the
 * day still holds that value); `locator_hint`, a change's origin said only in a negated predicate (checked when locating);
 * `excluded_readings`, values the owner excluded for a role still open (LOCATE never settles a role on them; with
 * SALON_SECRETARY_DAYPART_BY_HOURS also the proven clock exclusions, which the tenant's hours never settle on either). */
/** Flag SALON_SECRETARY_DAYPART_BY_HOURS only: `daypart_hours`, a half-day reading the tenant's facts settled (`value`) or left
 * with no possible reading (no `value`), with the owner's two readings, the quote and the facts' basis (day, professionals,
 * duration). While the role keeps that value, a changed basis gives the two readings back; `line` is said before Confirmar.
 * `daypart_written`: open half-day roles of an action whose message wrote a daypart elsewhere ("amanhã de manhã … pras 2"):
 * the owner settles them, never the hours. */
export type DaypartHoursRecord={field:DaypartField;candidates:[string,string];expression:string;value?:string;basis:string;line?:string};
/** P2a (flag SALON_SECRETARY_ALTER_APPOINTMENT): the alteration cards (`target_professional_ref`: the NEW professional;
 * `service_changes_ref`: the first unresolved service of the delta) and the NEW professional's unproven/selected name. */
/** P2b (flag SALON_SECRETARY_MULTI_SERVICE): the service-list cards (`service_list_ref`: the first unresolved service of the
 * list; `service_combo_ref`: a catalog combo of said services, or them apart) and `service_combo_declined`, the combos the owner
 * kept apart in this action (never offered or picked again here). */
/** A3 (flag SALON_SECRETARY_EXCEPTION_RULES_V2): `origin_from_ref`, the origin roles (a change's source_date/source_time, a
 * cancel's date/time) filled from the chosen appointment's own fresh row, not said by the owner (codes only; never outlive the
 * ref: see forgetOriginFromRef). */
export type OriginRole="date"|"time"|"source_date"|"source_time";
/** C4 (flag SALON_SECRETARY_DATE_RULES_V2): `origin_day_kept`, the destination day prepare() kept from the located appointment for a
 * time-only move (the origin's, never the owner's words; codes only). While the date still holds it and no turn proved a day, it is not a
 * held destination day for applyKeptDayGuard: a later correction's day that the interpretation dropped is asked, never replaced by it. */
/** Review A (P2a): the two professionals of a change whose roles may be swapped, while their card of both readings is open. */
export type AlterSwap={professional:{ref:string;name?:string};target:{ref:string;name?:string}};
/** P3b (flag SALON_SECRETARY_READS_V2): `read_partial`, the read showed less than exists: "UPCOMING", a customer's next appointments
 * with more after them (an ordinal over the rows shown is not over all of them); "SUMMARY", a day summarized with a question. */
/** P3c (flag SALON_SECRETARY_RECURRENCE_GUARD): `recurrence`, a recurrence the owner's words stated for this create/block and
 * whether they said yes to its first occurrence alone (secretary-recurrence.ts); the `recurrence_ref` card is that one option. */
export type SchedulingState={combo_chosen?:string[];block_whole_day?:boolean;
  /** 05/10 (flag SALON_SECRETARY_SCHEDULE_EXCEPTIONS): the schedule exception the owner was asked about ("quer … mesmo assim?"),
   * bound to that slot and its causes; a consent only counts for this hash and before it expires. */
  exception_pending?:{operation:"appointment.create"|"appointment.change";hash:string;causes:string[];expires_at:string};block_overlap?:BlockOverlapChoice;recurrence?:RecurrenceState;read_partial?:"UPCOMING"|"SUMMARY";origin_from_ref?:OriginRole[];origin_forgotten?:OriginRole[];origin_day_kept?:string;alter_swap?:AlterSwap;appointment_chosen?:string;service_combo_declined?:string[];daypart_hours?:DaypartHoursRecord[];daypart_written?:DaypartField[];past_readings?:PastReading[];locator_hint?:LocatorHint;excluded_readings?:{field:string;values:string[]}[];resolved_names?:Record<string,string>;references?:SchedulingReferences;selected_names?:Partial<Record<"customer_name"|"service_name"|"professional_name"|"target_professional_name",string>>;proposal_deferred?:boolean;operation?: NonNullable<SchedulingInterpretation["operation"]>; fields:SchedulingFields; message:string;
  draft?:Awaited<ReturnType<typeof upsertSchedulingDraft>>;proposal?:Awaited<ReturnType<typeof proposeAppointmentCreate>>;receipt?:Awaited<ReturnType<typeof confirmAppointmentCreate>>;
  candidates?:{kind:"customer_ref"|"service_ref"|"professional_ref"|"appointment_ref"|"target_professional_ref"|"service_changes_ref"|"service_list_ref"|"service_combo_ref"|typeof RECURRENCE_CARD|typeof BLOCK_OVERLAP_CARD;items:{id:string;name:string}[];source?:"suggest"|"confirm"|"alias";alias_basis?:string};unproven_names?:("customer_name"|"professional_name"|"target_professional_name")[];
  alias_declined?:{kind:AliasRef;key:string}[];
  alternatives?:Awaited<ReturnType<typeof getSchedulingAvailability>>["alternatives"];appointments?:Awaited<ReturnType<typeof listSchedulingAppointments>>;
  pending_temporal_ambiguities?:PendingTemporalAmbiguity[];pending_calendar_conflicts?:PendingCalendarConflict[];source_missing?:ReasonField[];waiting_for?:string;interpretation_source?:"MODEL"|"DETERMINISTIC_FAST_PATH";metrics:SchedulingMetrics;
  /** C5 agent (flag SALON_SECRETARY_AGENT; docs/c5-spike/11-especificacao-agente.md §5.1 V23, §6.2): `agent_basis`, the provenance of the values the
   * backend derived for this action (anchor, delegation, exception, workday end, kept clock, links), re-checked before the Confirmar writes;
   * `agent_forgotten`, derived fields a continuation dropped with their basis, handed once to the next journal write (never resurrected). */
  agent_basis?:AgentBasis[];agent_forgotten?:SchedulingForgetField[]};
// Human pt-BR labels ("ter, 29/09", "9h45"); fields and proposals keep ISO values.
const dayLabel=(date:string)=>formatDay(date);
const clockLabel=(local:string)=>formatClock(local.slice(11,16));
const statusLabels:Record<string,string>={CONFIRMED:"confirmado",PENDING:"pendente",PENDING_ACCEPTANCE:"aguardando aceite",CANCELLED:"cancelado",COMPLETED:"concluído",IN_PROGRESS:"em atendimento",NO_SHOW:"não compareceu"};
const unavailableCause=(violation:string)=>violation==="SLOT_TAKEN"?": já existe outro atendimento":violation==="SALON_CLOSED"?": o salão está fechado":
  ["OUTSIDE_WORKING_HOURS","AFTER_WORKING_HOURS","WORKING_HOURS_BREAK"].includes(violation)?": fica fora do expediente do profissional":violation==="PROFESSIONAL_UNAVAILABLE"?": o profissional está indisponível":"";
export const schedulingState=():SchedulingState=>({fields:{},message:"Informe o cliente, serviço e data/horário desejados.",metrics:{}});
/** B7: each temporal role named for what the operation does (moved to scheduling-field-labels.ts for UX-COPY; same labels). */
export { temporalFieldLabels };
/** The missing-field words of the adapter's "Informe …." question and the line after a proposal: both reach the model as
 * data (part of the backend presentation digest, secretary-presentation-contract.ts). */
export const schedulingMissingLabels:Record<string,string>={customer_ref:"cliente",service_ref:"serviço",professional_ref:"profissional",date:"data",source_date:"data original",source_time:"horário original",time:"horário exato",end_date:"data final",end_time:"horário final",appointment_ref:"agendamento original",reason:"motivo do cancelamento (mínimo 3 caracteres)"};
export const confirmInstruction="Use Confirmar para executar.";
const nameRefs=[["customer_name","customer_ref"],["service_name","service_ref"],["professional_name","professional_ref"]] as const;
/** Reuse the exact-clock parser only for a backend-requested original time. */
export function schedulingSourceTimeReply(waitingFor:string|undefined,message:string) {
  if(waitingFor!=="source_time")return;
  const parsed=secretaryFastPath("time",message);
  if(parsed&&"time" in parsed)return {source_time:parsed.time};
}
export async function persistSchedulingMetrics(actor:ServiceActor,sessionId:string,c:SchedulingState){
  await withTenant(actor,tx=>tx.auditLog.create({data:{salonId:actor.salonId,userId:actor.userId,actorName:"Secretária — latência",entityType:"SECRETARY_LATENCY",entityId:sessionId,action:"SCHEDULING_TIMINGS",metadata:{session_id:sessionId,operation:c.operation??null,interpretation_source:c.interpretation_source??"MODEL",...(c.interpretation_source==="DETERMINISTIC_FAST_PATH"?{model_avoided:true,model_requests:0,model_cost:0}:{}),durations_ms:c.metrics}}}));
}
/** C7 flag (default off): a NEW booking whose slot overlaps the same customer's upcoming appointment is asked, not proposed.
 * Without it the proposal card still shows the customer's upcoming appointments (screen only: existingBookingNotice). */
export const customerOverlapGuardEnabled=(env:Record<string,string|undefined>=process.env)=>env.SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD==="true";
/** B5: the question asked when a service Luna named is not in the owner's message (plan turns). */
export const unprovenServiceQuestion="Não consegui confirmar o serviço na sua mensagem.\nQual serviço?";
/** `askService` (B5): the service named this turn was not proven and left the patch; nothing is proposed or
 * located until the owner says which service (the other fields are still resolved and kept). */
/** `excluded` (C4): proven destination clocks this turn's message excluded; never offered as alternatives. */
/** C5: the draft keys a reference field stands for (a customer also locates a change/cancel). */
const referenceKeys=(fields:readonly SameAsField[]|undefined,op:string)=>new Set<string>((fields??[]).flatMap(field=>field==="professional"?["professional_ref"]:field==="service"?["service_ref"]:
  field==="customer"?["customer_ref",...(op==="appointment.change"||op==="appointment.cancel"?["appointment_ref"]:[])]:[field]));
/** LOCATE (flag SALON_SECRETARY_DATE_RULES_V2): a pending identity role of a change/cancel — the appointment's own day (a
 * DATE_CHOICE) or clock (a half-day choice) — is settled read-only by the tenant's real appointments. Only for ONE customer
 * (the resolved ref, or the single exact match of a name the owner wrote; homonyms keep today's order and nothing is read),
 * and a named professional/service must be a single match too. The readings are only the published candidates; the tenant
 * locator runs once per day reading (at most twice) with the clock removed and counts only future PENDING/CONFIRMED rows.
 * One reading matches: the role is filled (the appointment itself is still chosen by the locator or a card). Both days
 * match: the card of those real appointments. None: said, and the role is asked. Both clocks match: today's question. */
type Located={codes:string[];settled:Partial<Record<"date"|"source_date"|"time"|"source_time",string>>;customer:string;name:string;notice?:string;asked?:("date"|"source_date"|"time"|"source_time")[];
  card?:NonNullable<SchedulingState["candidates"]>};
async function locateIdentity(actor:ServiceActor,c:SchedulingState,f:SchedulingFields,op:string,calendar:readonly PendingCalendarConflict[],clocks:readonly PendingTemporalAmbiguity[]):Promise<Located|undefined>{
  if(!dateRulesV2Enabled()||op!=="appointment.change"&&op!=="appointment.cancel"||f.appointment_ref)return;
  const change=op==="appointment.change",dayRole=change?"source_date" as const:"date" as const,clockRole=change?"source_time" as const:"time" as const;
  const day=calendar.find(item=>item.field===dayRole&&item.kind==="DATE_CHOICE"),clock=clocks.find(item=>item.field===clockRole&&item.kind==="CLOCK_DAYPART");
  // A contradiction the owner wrote about that day ("terça, dia 14" on a Wednesday) is theirs to settle first.
  if(day?.kind!=="DATE_CHOICE"&&!clock||calendar.some(item=>item.field===dayRole&&item.kind!=="DATE_CHOICE"))return;
  const unproven=new Set(c.unproven_names??[]);
  let customer=f.customer_ref,name=customer?c.resolved_names?.[customer]:undefined,professional=f.professional_ref,service=f.service_ref;
  if(!customer){
    if(!f.customer_name||unproven.has("customer_name"))return;
    const rows=await withTenant(actor,tx=>searchSalonCustomer(tx,actor,f.customer_name!));
    if(rows.length!==1)return;
    customer=rows[0].id;name=rows[0].name;
  }
  if(!professional&&f.professional_name){
    if(unproven.has("professional_name"))return;
    const rows=await withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,{query:f.professional_name}));
    if(rows.length!==1)return;professional=rows[0].id;
  }
  if(!service&&f.service_name){const rows=await withTenant(actor,tx=>listSchedulingServices(tx,actor,f.service_name!));if(rows.length!==1)return;service=rows[0].id;}
  // A reading the owner excluded (this turn or an earlier one) never enters.
  const out=(field:string,value:string|undefined)=>value!==undefined&&!!c.excluded_readings?.some(item=>item.field===field&&item.values.includes(value));
  const days=day?.kind==="DATE_CHOICE"?day.candidates.filter(date=>!out(dayRole,date)):[f[dayRole]],readings=clock?clock.candidates.filter(time=>!out(clockRole,time)):f[clockRole]?[f[clockRole]!]:undefined;
  if(!days.length||readings&&!readings.length)return;
  const rows:Awaited<ReturnType<typeof locateSchedulingAppointments>>=[];
  try{for(const date of days)rows.push(...await withTenant(actor,tx=>locateSchedulingAppointments(tx,actor,{...f,customer_ref:customer,professional_ref:professional,service_ref:service,[dayRole]:date,[clockRole]:undefined},op)));}
  catch{return;}
  const hits=[...new Map(rows.filter(r=>!readings||readings.includes(r.start_local.slice(11,16))).map(r=>[r.appointment_ref,r])).values()];
  const who=name??f.customer_name??"o cliente",codes:string[]=[],settled:Located["settled"]={};
  const dayHits=day?(days as string[]).filter(date=>hits.some(r=>r.start_local.startsWith(date))):undefined;
  if(!hits.length){
    // The clock the owner fixed is part of what was looked for; the customer's appointments on those days at other clocks make
    // the clock (not the day) the question, with those real times said; the day choice stays open for the next LOCATE.
    const others=!clock&&readings?[...new Map(rows.map(r=>[r.appointment_ref,r])).values()]:[];
    const where=[...(day?[`em ${(days as string[]).map(date=>formatDay(date)).join(" nem em ")}`]:[]),...(readings?[`às ${readings.map(formatClock).join(" nem às ")}`]:[])].join(" ");
    const seen=others.length&&others.length<=3?` Encontrei ${others.map(r=>formatLocal(r.start_local)).join(" e ")}.`:"";
    return {codes:others.length?["LOCATE_CLOCK_ASKED"]:[...(day?["DATE_CHOICE_RESOLVED_BY_AGENDA_NONE"]:[]),...(clock?["DAYPART_RESOLVED_BY_APPOINTMENT_NONE"]:[])],settled,customer,name:who,
      notice:`Não encontrei agendamento futuro de ${who} ${where}.${seen}`,asked:others.length?[clockRole]:[...(day?[dayRole]:[]),...(clock?[clockRole]:[])]};
  }
  if(dayHits&&dayHits.length>1)return hits.length>20?undefined:{codes:["DATE_CHOICE_RESOLVED_BY_AGENDA_BOTH"],settled,customer,name:who,
    card:{kind:"appointment_ref",items:hits.map(r=>({id:r.appointment_ref,name:`${r.customer_name} — ${formatLocal(r.start_local)} — ${r.professional_name}`}))}};
  if(dayHits?.length===1){settled[dayRole]=dayHits[0];codes.push("DATE_CHOICE_RESOLVED_BY_AGENDA");}
  if(clock){
    const onDay=dayHits?.length===1?hits.filter(r=>r.start_local.startsWith(dayHits[0])):hits,clockHits=readings!.filter(time=>onDay.some(r=>r.start_local.slice(11,16)===time));
    if(clockHits.length===1){settled[clockRole]=clockHits[0];codes.push("DAYPART_RESOLVED_BY_APPOINTMENT");}else codes.push("DAYPART_RESOLVED_BY_APPOINTMENT_BOTH");
  }
  return {codes,settled,customer,name:who};
}
/** C3 (flag SALON_SECRETARY_DAYPART_RULES_V2) then C2 (flag SALON_SECRETARY_DAYPART_BY_HOURS): an open half-day question of this
 * action is settled before it is asked, only among the two readings of the hour the owner wrote. First the other edge of the same
 * single-day interval (the end after the start; an 8-11 edge is both its readings, never proof of a half-day), then the tenant's
 * real facts for that day and professional (scheduling-daypart-facts.ts). One reading left fills the role and is said before
 * Confirmar; two keep today's question; none is said as unavailable with real alternatives and asks the time again (an existing
 * appointment's own clock keeps its question, with what was ruled out). A resolution keeps its facts' basis: once the
 * professional, service or day change, the owner's two readings come back and are checked again. Unknown facts: today's question. */
/** `cleared`: roles whose settled value went stale (erased from the draft unless settled again). */
type DaypartSettlement={settled:string[];cleared:string[];stop?:{field:DaypartField;message:string;alternatives:NonNullable<SchedulingState["alternatives"]>};info?:string};
const eveningTwin=(clock:string)=>Number(clock.slice(0,2))>=8&&Number(clock.slice(0,2))<=11?[clock,`${String(Number(clock.slice(0,2))+12)}${clock.slice(2)}`]:[clock];
async function settleDayparts(actor:ServiceActor,c:SchedulingState,f:SchedulingFields,op:string,codes:string[],excluded?:ReadonlySet<string>):Promise<DaypartSettlement|undefined>{
  const v2=daypartRulesV2Enabled(),hours=daypartByHoursEnabled();
  if(!v2&&!hours)return;
  let pendings=[...(c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[])];
  const out:DaypartSettlement={settled:[],cleared:[]},now=new Date(),unproven=new Set<string>(c.unproven_names??[]);
  const pend=(field:string)=>pendings.find(item=>item.field===field);
  // Registered names only (a single match, or the option the owner chose), never the typed words.
  const names={...(f.professional_ref&&c.selected_names?.professional_name?{[f.professional_ref]:c.selected_names.professional_name}:{}),...c.resolved_names};
  const context=(field:DaypartField)=>hoursContext(actor,{op,field,fields:f,unproven,names}).catch(()=>undefined);
  const locateDay=(field:DaypartField)=>field==="source_time"?f.source_date:f.date;
  const basisOf=async(field:DaypartField)=>daypartPurpose(op,field)==="LOCATE"?`LOCATE|${locateDay(field)??""}`:(await context(field))?.basis;
  // The owner's two readings given back (a stale value is erased from the draft too).
  const restore=(field:DaypartField,candidates:[string,string],expression:string)=>{
    if(f[field]!==undefined){delete f[field];out.cleared.push(field);}
    if(!pend(field))pendings.push({field,kind:"CLOCK_DAYPART",expression,candidates});
  };
  if(c.daypart_hours?.length){
    const kept:DaypartHoursRecord[]=[];
    for(const record of c.daypart_hours){
      // The owner answered or changed that role (or said it again): the record is spent.
      if(f[record.field]!==record.value||pend(record.field))continue;
      // An edge the other edge settled (C3, basis INTERVAL) is checked against the facts below.
      if(record.basis==="INTERVAL"||!hours||await basisOf(record.field)===record.basis){kept.push(record);continue;}
      restore(record.field,record.candidates,record.expression);codes.push("DAYPART_HOURS_STALE");
    }
    c.daypart_hours=kept.length?kept:undefined;
  }
  const fill=(field:DaypartField,value:string,code:string,record?:Omit<DaypartHoursRecord,"field"|"value">)=>{
    f[field]=value;pendings=pendings.filter(item=>item.field!==field);out.settled.push(field);codes.push(code);
    if(record)c.daypart_hours=[...(c.daypart_hours??[]).filter(item=>item.field!==field),{field,value,...record}];
  };
  const singleDay=!f.end_date||f.end_date===f.date;
  if(v2&&singleDay&&(pend("time")||pend("end_time"))){
    const starts=pend("time")?.candidates??(f.time?eveningTwin(f.time):undefined),ends=pend("end_time")?.candidates??(f.end_time?eveningTwin(f.end_time):undefined);
    const pairs=starts&&ends?coherentIntervalReadings(starts,ends):[];
    for(const [field,values]of [["time",new Set(pairs.map(pair=>pair[0]))],["end_time",new Set(pairs.map(pair=>pair[1]))]] as const){
      const pending=pend(field);
      if(pending&&values.size===1)fill(field,[...values][0],"DAYPART_RESOLVED_BY_INTERVAL",{candidates:pending.candidates,expression:pending.expression,basis:"INTERVAL"});
    }
  }
  // C2: a pair the interval's coherence chose that the professional cannot hold (a night studio's "das 10 às 2", which may cross
  // midnight, never inferred) gives both edges' readings back, asked as today.
  let doubt=false;
  const byInterval=(c.daypart_hours??[]).filter(item=>item.basis==="INTERVAL"&&f[item.field]===item.value);
  if(hours&&op==="schedule.block"&&singleDay&&f.time&&f.end_time&&byInterval.length){
    const scope=await context("time");
    const facts=scope?await withTenant(actor,async tx=>loadDayFacts(tx,actor.salonId,await schedulingTimezone(tx,actor),scope.day,scope.staff.ids,now)).catch(()=>undefined):undefined;
    if(facts&&!openBlockPairs([f.time],[f.end_time],facts).length){
      for(const field of ["time","end_time"] as const){
        const record=byInterval.find(item=>item.field===field),twin=eveningTwin(f[field]!);
        if(record)restore(field,record.candidates,record.expression);else if(twin.length===2)restore(field,twin as [string,string],byInterval[0].expression);
      }
      c.daypart_hours=c.daypart_hours?.filter(item=>item.basis!=="INTERVAL");if(!c.daypart_hours?.length)delete c.daypart_hours;
      doubt=true;codes.push("DAYPART_INTERVAL_REJECTED_BY_HOURS");
    }
  }
  // What the owner excluded for a role, in this turn (its proven destination/start clocks) or an earlier one: never settled on.
  const excludedOf=(field:DaypartField)=>new Set<string>([...(c.excluded_readings??[]).filter(item=>item.field===field).flatMap(item=>item.values),...(field==="time"?excluded??[]:[])]);
  if(hours)for(const field of ["source_time","time","end_time"] as const){
    const pending=pend(field),purpose=pending&&daypartPurpose(op,field);
    // A move's destination is checked against ITS appointment: never while the move's own origin clock is still open.
    if(!pending||!purpose||doubt&&purpose.startsWith("BLOCK")||op==="appointment.change"&&field==="time"&&pend("source_time"))continue;
    // A daypart the owner wrote elsewhere in the action is theirs to settle (today's question).
    if(c.daypart_written?.includes(field)){codes.push("DAYPART_HOURS_SKIPPED_WRITTEN");continue;}
    let facts:DayFacts|undefined,scope:HoursContext|undefined,day:string|undefined;
    try{
      if(purpose==="LOCATE"){day=locateDay(field);facts=day?await loadNowFacts(actor,day,now):undefined;}
      else{scope=await context(field);day=scope?.day;
        facts=scope?await withTenant(actor,async tx=>loadDayFacts(tx,actor.salonId,await schedulingTimezone(tx,actor),scope!.day,scope!.staff.ids,now)):undefined;}
    }catch{facts=undefined;}
    if(!facts||!day)continue;
    const who=scope?.staff.ids.length===1?scope.staff.name??"o profissional":undefined,basis=purpose==="LOCATE"?`LOCATE|${day}`:scope!.basis;
    let readings:OpenReadings;
    const other=field==="time"?pend("end_time"):pend("time"),refused=excludedOf(field);
    if(purpose.startsWith("BLOCK")&&singleDay&&other){
      // Both edges open: only coherent pairs ONE professional can hold (never on an excluded reading).
      const [starts,ends]=(["time","end_time"] as const).map(edge=>pend(edge)!.candidates.filter(time=>!excludedOf(edge).has(time)));
      const pairs=openBlockPairs(starts,ends,facts),index=field==="time"?0:1;
      const open=[...new Set(pairs.map(pair=>pair[index]))];
      readings={open,closed:pending.candidates.filter(time=>!open.includes(time)&&!refused.has(time)).map(time=>({time,cause:openReadings([time],purpose,facts).closed[0]?.cause??"INTERVAL"}))};
    }else{
      const edge=purpose.startsWith("BLOCK")&&singleDay?field==="time"?f.end_time:f.time:undefined,bounds=edge?eveningTwin(edge):undefined;
      readings=openReadings(pending.candidates,purpose,facts,{duration:scope?.duration,...(bounds?{other:purpose==="BLOCK_START"?bounds.at(-1)!:bounds[0]}:{}),excluded:refused});
    }
    // Why the other reading is out: the facts' causes, then the owner's own exclusion.
    const discarded=pending.candidates.filter(time=>refused.has(time)),why=[closedReadingsText(readings.closed,who),...(discarded.length?[`você descartou ${discarded.map(time=>`às ${formatClock(time)}`).join(" e ")}`]:[])].filter(Boolean).join("; ");
    if(readings.open.length===1)
      fill(field,readings.open[0],"DAYPART_RESOLVED_BY_HOURS",{candidates:pending.candidates,expression:pending.expression,basis,line:`Considerei ${formatClock(readings.open[0])}: ${why}.`});
    else if(!readings.open.length&&readings.closed.length){
      // Owner 05/10 (flag SALON_SECRETARY_SCHEDULE_EXCEPTIONS): no reading is free, but the owner may still book over the professional's
      // schedule. The reading inside the SALON's working hours that day (any professional working then) is the one meant ("9 horas"
      // in a salon open 9–20 is 9h, never 21h); it goes on to the exception question ("quer marcar mesmo assim?"). A closure, the
      // past, or a salon that does not tell the two readings apart keeps today's answer.
      const salonReading=purpose==="BOOK"&&scheduleExceptionsEnabled()&&readings.closed.every(item=>["OUTSIDE","OFF","DURATION"].includes(item.cause))?await salonHoursReading(actor,day,pending.candidates,refused,now):undefined;
      if(salonReading){fill(field,salonReading,"DAYPART_KEPT_FOR_EXCEPTION",{candidates:pending.candidates,expression:pending.expression,basis,line:`Considerei ${formatClock(salonReading)}, no horário de funcionamento do salão.`});continue;}
      codes.push("DAYPART_UNAVAILABLE_BY_HOURS");
      const whole=closedDayText(facts,day,who),detail=whole?`: ${whole}`:` em ${formatDay(day)}: ${why}`;
      // An existing appointment's own clock stays asked, with what was ruled out; a time to book or block is never guessed.
      if(purpose==="LOCATE"){out.info=`Em ${formatDay(day)}, ${closedReadingsText(readings.closed)}: a Secretária só altera agendamentos futuros.`;continue;}
      pendings=pendings.filter(item=>item.field!==field);
      c.daypart_hours=[...(c.daypart_hours??[]).filter(item=>item.field!==field),{field,candidates:pending.candidates,expression:pending.expression,basis}];
      const alternatives=purpose==="BOOK"&&scope?(await hoursAlternatives(actor,scope,now,refused)).filter(slot=>slot.startLocal.startsWith(day!)):[];
      out.stop={field,alternatives,message:`Esse horário não está disponível${detail}. ${alternatives.length?`Tenho ${alternatives.map(slot=>clockLabel(slot.startLocal)).join(", ")}. Qual horário você prefere?`:"Qual outro horário ou dia você prefere?"}`};
      break;
    }
  }
  c.pending_temporal_ambiguities=pendings;
  return out;
}
/** UX-COPY (flag SALON_SECRETARY_COPY_V2): what the locator looked for, said back in a "not found" ("de Sérgio Lima em qui, 01/10
 * às 17h30"): the registered name once resolved (the owner's words otherwise), the origin day and clock as human dates.
 * Undefined when nothing was read (the historical sentence is kept). */
function readBack(c:SchedulingState,f:SchedulingFields,op:string){
  const change=op==="appointment.change",day=change?f.source_date:f.date,clock=change?f.source_time:f.time;
  const who=f.customer_ref?c.resolved_names?.[f.customer_ref]??c.selected_names?.customer_name??f.customer_name:f.customer_name;
  const parts=[...(who?[`de ${who}`]:[]),...(day?[`em ${formatDay(day)}`]:[]),...(clock?[`às ${formatClock(clock)}`]:[])];
  return parts.length?parts.join(" "):undefined;
}
/** P3c (flag): said before a question about the first occurrence while a stated recurrence still owes the owner's yes. */
const recurringLine=(c:SchedulingState,op:string)=>recurrencePending(c.recurrence,op)?`${recurrenceNotice(op,c.recurrence!.expression)} `:"";
/** `askAlteration` (P2a): an alteration part of this turn was not applied (negated or unproven): asked, nothing proposed.
 * `askList` (P2b): the service list of this turn was not applied, or named two professionals: asked, nothing proposed. */
async function prepare(actor:ServiceActor,c:SchedulingState,rejectedTemporal:TemporalRejection[]=[],rejectedSource:ReasonRejection[]=[],askService=false,excluded?:ReadonlySet<string>,codes:string[]=[],askAlteration?:AlterationField,
  askList?:{notice:string;waiting_for:string}){
  // A3 (review B): ref-derived roles this turn forgot are never resurrected by the journal merge (whatever the flag says now).
  let forget:{forget_origin?:OriginRole[];forget_fields?:SchedulingForgetField[]}=c.origin_forgotten?.length?{forget_origin:c.origin_forgotten}:{};delete c.origin_forgotten;
  // C5 agent (flag): derived fields a continuation dropped with their provenance (agentBasisPatched) are never resurrected by the merge.
  if(c.agent_forgotten?.length){forget={...forget,forget_fields:[...c.agent_forgotten]};delete c.agent_forgotten;}
  const f=c.fields,op=c.operation!,copyV2=secretaryCopyV2Enabled();c.candidates=undefined;delete c.alter_swap;c.alternatives=undefined;c.appointments=undefined;c.proposal=undefined;c.waiting_for=undefined;delete c.read_partial;
  // UX-COPY (flag): sentences name who the backend resolved as registered (the owner's words while unresolved).
  // E2 (V2): a first-person professional ("minha agenda") is always named as registered once resolved, never by the pronoun.
  const shown=(role:"customer_name"|"professional_name",ref:"customer_ref"|"professional_ref")=>(copyV2||isFirstPersonReference(f[role]))&&f[ref]?c.resolved_names?.[f[ref]!]??c.selected_names?.[role]??f[role]:f[role];
  const self=isFirstPersonReference(f.professional_name);
  // C5: a waiting field is never usable (absent, or a stale copy of a retracted value); an absent asked one is never
  // inherited or auto-assigned. A move into a slot a pending cancellation of the plan releases is checked as released.
  const refs=c.references,waiting=referenceKeys(refs?.waiting,op),asked=referenceKeys(refs?.asked,op);
  const held=(key:string)=>(waiting.has(key)||asked.has(key))&&!f[key as keyof SchedulingFields],released=op==="appointment.change"||op==="appointment.create"&&referencesV2Enabled()?refs?.released:undefined;
  // D1 (V2): a create in the ORIGIN of a pending reschedule of the plan is checked (availability, snapshot, proposal) with that
  // appointment projected out; its executor never receives the projection (it re-checks the committed agenda after the move).
  const projection=op==="appointment.create"&&released?{releasedAppointmentId:released}:undefined;
  if(refs){delete refs.blocked;if(refs.notice&&[...asked].every(key=>f[key as keyof SchedulingFields]))delete refs.notice;}
  assertSchedulingExceptionScope(f,op);
  await withTenant(actor,tx=>authorizeSchedulingOperation(tx,actor,op));
  const sourceMissing=askedSourceFields(c.source_missing??c.draft?.source_missing??[]);
  // LOCATE (flag): identity roles settled by the tenant's real appointments before any question about them.
  const located=await locateIdentity(actor,c,f,op,c.pending_calendar_conflicts??c.draft?.pending_calendar_conflicts??[],c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[]);
  if(located){
    codes.push(...located.codes);
    // The card of real appointments answers both identity questions (its options carry their day and clock).
    const card=located.card?op==="appointment.change"?["source_date","source_time"]:["date","time"]:[],gone=new Set<string>([...Object.keys(located.settled),...card,...(located.asked??[])]);
    Object.assign(f,located.settled);for(const field of located.asked??[])delete f[field];
    c.pending_calendar_conflicts=(c.pending_calendar_conflicts??c.draft?.pending_calendar_conflicts??[]).filter(item=>!gone.has(item.field));
    c.pending_temporal_ambiguities=(c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[]).filter(item=>!gone.has(item.field));
    // A settled (or carded) role's own rejection must not erase it again; a role found nowhere is asked as missing.
    rejectedTemporal=[...rejectedTemporal.filter(item=>!gone.has(item.field)),...(located.asked??[]).map(field=>({code:"SOURCE_TEMPORAL_CONFLICT" as const,field,value:"MISSING"}))];
    if(located.card||located.asked){
      if(located.card){f.customer_ref=located.customer;c.resolved_names={...c.resolved_names,[located.customer]:located.name};}
      c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,...forget,pending_calendar_conflicts:c.pending_calendar_conflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities,source_missing:sourceMissing,rejected_temporal:rejectedTemporal,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
      c.fields=c.draft.fields;
      if(located.card){c.candidates=located.card;c.message="Qual agendamento? Selecione uma opção real.";return;}
      const labels=temporalFieldLabels(op),asked=located.asked!;if(asked.length===1)c.waiting_for=asked[0];
      c.message=`${located.notice} Preciso confirmar ${asked.map(field=>labels[field]).join(" e ")}. Pode informar?`;return;
    }
  }
  // B1 (flag): the past reading dropped from this action's day is said before Confirmar and in a "not found".
  let pastLine=dateRulesV2Enabled()?(c.past_readings??[]).filter(item=>f[item.field]===item.date).map(item=>`“${item.expression}” é ${formatDay(item.date)} (${formatDay(item.dropped)} já passou).`).join(" "):"";
  const calendarConflicts=c.pending_calendar_conflicts??c.draft?.pending_calendar_conflicts??[];
  if(sourceMissing.length){
    c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,...forget,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[],source_missing:sourceMissing,rejected_source:rejectedSource,rejected_temporal:rejectedTemporal,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
    c.fields=c.draft.fields;c.source_missing=sourceMissing;
    if(sourceMissing.length===1)c.waiting_for=sourceMissing[0];
    c.message=sourceMissing.includes("reason")?"Qual é o motivo do cancelamento? Vou registrar suas palavras.":"Qual é o motivo do encaixe? Vou registrar suas palavras.";
    return;
  }
  const calendar=firstCalendarConflict(calendarConflicts);
  if(calendar){
    c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,...forget,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[],source_missing:sourceMissing,rejected_temporal:rejectedTemporal,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
    c.fields=c.draft.fields;c.pending_calendar_conflicts=c.draft.pending_calendar_conflicts??[];
    c.waiting_for=calendar.field;c.message=calendarConflictQuestion(calendar,op);return;
  }
  // C3/C2 (flags): an open half-day reading settled by the other edge of the interval or by the tenant's facts before it is asked.
  const dayparts=await settleDayparts(actor,c,f,op,codes,excluded);
  if(dayparts){
    // A settled role's own rejection must not erase it; a role with no possible reading is asked as a required time; a stale
    // value not settled again is erased from the draft (the journal otherwise keeps the previous revision's value).
    const gone=new Set<string>([...dayparts.settled,...(dayparts.stop?[dayparts.stop.field]:[])]);
    rejectedTemporal=[...rejectedTemporal.filter(item=>!gone.has(item.field)),
      ...dayparts.cleared.filter(field=>!dayparts.settled.includes(field)).map(field=>({code:"SOURCE_TEMPORAL_CONFLICT" as const,field:field as TemporalRejection["field"],value:"MISSING"}))];
    if(dayparts.stop){
      c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,...forget,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities,source_missing:sourceMissing,rejected_temporal:rejectedTemporal,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
      c.fields=c.draft.fields;c.pending_temporal_ambiguities=c.draft.pending_temporal_ambiguities??[];
      c.alternatives=dayparts.stop.alternatives;c.waiting_for=dayparts.stop.field;c.message=dayparts.stop.message;return;
    }
  }
  const pending=firstTemporalAmbiguity(c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities);
  if(pending){
    c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,...forget,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities,source_missing:sourceMissing,rejected_temporal:rejectedTemporal,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
    c.fields=c.draft.fields;c.pending_temporal_ambiguities=c.draft.pending_temporal_ambiguities??[];
    c.waiting_for=pending.field;c.message=`${dayparts?.info?`${dayparts.info}\n`:""}${temporalAmbiguityQuestion(pending,op)}`;return;
  }
  const conflicts=schedulingTemporalConflicts(f);
  const rejectedMissing=rejectedTemporal.filter(r=>r.field!=="period"&&!f[r.field]);
  const unresolvedTemporal=(c.draft?.temporal_missing??[]).filter(field=>!f[field]);
  if(conflicts.length||rejectedMissing.length||unresolvedTemporal.length){
    c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,...forget,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[],source_missing:sourceMissing,rejected_temporal:rejectedTemporal,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
    c.fields=c.draft.fields;
    const pending=[...new Set([...conflicts.map(x=>x.field),...rejectedMissing.map(x=>x.field),...unresolvedTemporal])];if(pending.length===1)c.waiting_for=pending[0];
    const labels=temporalFieldLabels(op);
    const issues=[...conflicts,...rejectedMissing];
    const excludedIssue=rejectedMissing.filter(issue=>issue.value===EXCLUDED_VALUE);
    const notice=issues.some(issue=>issue.code==="DATE_IN_PAST")?"Essa data já passou. ":rejectedMissing.some(issue=>issue.value===SELECTOR_CONFLICT)?"Recebi indicações diferentes para a mesma data ou horário e não escolhi nenhuma. ":
      excludedIssue.length?`Retirei ${excludedIssue.every(issue=>issue.field.endsWith("time"))?"o horário":excludedIssue.every(issue=>issue.field.endsWith("date"))?"a data":"a data e o horário"} que você descartou. `:issues.some(issue=>issue.code==="SOURCE_TEMPORAL_CONFLICT")?"A interpretação de data ou horário divergiu do que você informou e foi retirada. ":issues.some(issue=>issue.code==="TIME_OUTSIDE_PERIOD")?"O horário anterior é incompatível com o período informado e foi retirado. ":issues.some(issue=>issue.code==="END_NOT_AFTER_START")?"O final incompatível foi retirado. ":"";
    c.message=`${recurringLine(c,op)}${notice}Preciso confirmar ${pending.map(field=>labels[field]??"a informação temporal").join(" e ")}. Pode informar?`;
    return;
  }
  let notice:string|undefined=askService?unprovenServiceQuestion:undefined;
  if(askService)c.waiting_for="service_name";
  // V2: a reference it could not settle alone is a card of the real options (a read's rows, several services), never a pick.
  if(!notice&&refs?.card&&!f[refs.card.kind]){notice=refs.card.kind==="service_ref"?"Qual serviço? Selecione uma opção real.":"Qual agendamento? Selecione uma opção real.";
    c.candidates={kind:refs.card.kind,items:refs.card.items.map(item=>({...item}))};}
  if(!notice&&askAlteration){notice=alterationAskQuestion(askAlteration);c.waiting_for=askAlteration;}
  if(!notice&&askList){notice=askList.notice;c.waiting_for=askList.waiting_for;}
  const createOrAvailability=op==="appointment.create"||op==="availability.get";
  // Independent reads use separate tenant transactions. Final domain checks still share the confirmation transaction.
  const [customers,services]=await Promise.all([
    f.customer_name&&!f.customer_ref?timed(c.metrics,"customers",()=>withTenant(actor,tx=>searchSalonCustomer(tx,actor,f.customer_name!))):undefined,
    f.service_name&&!f.service_ref?timed(c.metrics,"services",()=>withTenant(actor,tx=>listSchedulingServices(tx,actor,f.service_name!))):undefined,
  ]);
  // C3 (flag): suggestions only after an empty search; a name Luna wrote unlike the message is only confirmed by a click.
  const suggest=nameSuggestionsEnabled(),unproven=new Set(suggest?c.unproven_names:[]);
  const labelOf=(r:{name:string;phone?:string|null})=>`${r.name}${"phone" in r&&r.phone?` · ${r.phone}`:""}`;
  // D1 (flag): an alias the owner taught is proposed for a typed name (never for a model's unproven name, never after the
  // owner refused it here); cards published for a typed name remember the exact search's set an alias may learn from.
  const aliases=nameAliasesEnabled();
  const declined=(kind:AliasRef,name:string)=>!!c.alias_declined?.some(item=>item.kind===kind&&item.key===aliasKey(name));
  const basis=(ids:readonly string[])=>aliases?{alias_basis:candidateSetHash(ids)}:{};
  for(const [kind,rows,label]of [["customer_ref",customers,"cliente"],["service_ref",services,"serviço"]] as const){
    if(!rows)continue;
    const entity=kind==="customer_ref"?"customer":"service",query=kind==="customer_ref"?f.customer_name!:f.service_name!;
    const confirm=kind==="customer_ref"&&unproven.has("customer_name")&&rows.length>=1&&rows.length<=20;
    // FX6 (review, owner rule 9, flag): the one combo found for words its parts' own registrations make a choice is a card, never a pick.
    const combo=kind==="service_ref"&&createOrAvailability?await singleServiceCombo(name=>withTenant(actor,tx=>listSchedulingServices(tx,actor,name)),query,rows):undefined;
    if(combo){if(!notice){notice=combo.notice;c.candidates={kind,items:combo.items};codes.push("MULTI_SERVICE_SINGLE_COMBO");}continue;}
    // Owner 05/10 (flag SALON_SECRETARY_SERVICE_SWAP_V2): the one service whose whole name is what was said is that service
    // ("pedicure" → "Pedicure", never "Manicure + Pedicure"); a name shared by several rows is still asked.
    const exact=kind==="service_ref"&&rows.length>1&&serviceSwapV2Enabled()?rows.filter(r=>sameName(r.name,query)):[];
    if(exact.length===1){f[kind]=exact[0].id;c.resolved_names={...c.resolved_names,[exact[0].id]:exact[0].name};recordNameResolution(entity,"MATCH",1);continue;}
    if(rows.length===1&&!confirm){f[kind]=rows[0].id;c.resolved_names={...c.resolved_names,[rows[0].id]:rows[0].name};recordNameResolution(entity,"MATCH",1);}
    else if(!notice){
      if(confirm){notice=confirmQuestion("cliente",rows.map(labelOf));c.candidates={kind,source:"confirm",items:rows.map(r=>({id:r.id,name:labelOf(r)}))};recordNameResolution(entity,"CONFIRM",rows.length);continue;}
      const alias=aliases&&rows.length<=20&&!(kind==="customer_ref"&&unproven.has("customer_name"))&&!declined(kind,query)?await proposeAlias(actor,aliasKindOf(kind),query,rows.map(r=>r.id)):undefined;
      if(alias){notice=aliasQuestion(query,alias.label);c.candidates=aliasCard(kind,alias);recordNameResolution(entity,"ALIAS",1);continue;}
      if(suggest&&!rows.length){
        const found=await withTenant<Suggested<{id:string;name:string;phone?:string|null}>>(actor,tx=>kind==="customer_ref"?suggestSalonCustomers(tx,actor,query):suggestSchedulingServices(tx,actor,query));
        recordNameResolution(entity,found.status==="SUGGEST"?"SUGGEST":found.status==="NONE"?"NO_MATCH":"DETAIL",suggestedRows(found).length);
        // Owner 05/10 (flag SALON_SECRETARY_PHONETIC_NAMES): the one suggestion that sounds exactly like the name said (Walter → Valter
        // Souza, Isabella → Isabela Mattos) is taken; its full name is on the card before Confirmar. Never for a name the model wrote unlike the message.
        // Owner 07/10 (flag SALON_SECRETARY_SERVICE_PICK_GUARD): a service is taken by its sound only when the WHOLE name sounds the
        // same ("platinado" never takes "Descoloração global ou platinado masculino" alone): the card asks.
        const whole=kind==="service_ref"&&servicePickGuardEnabled();
        const sound=found.status==="SUGGEST"&&phoneticNamesEnabled()&&!(kind==="customer_ref"&&unproven.has("customer_name"))?found.rows.filter(r=>samePhoneticName(query,r.name)&&(!whole||samePhoneticName(r.name,query))):[];
        if(sound.length===1){f[kind]=sound[0].id;c.resolved_names={...c.resolved_names,[sound[0].id]:sound[0].name};codes.push("NAME_SOUND_MATCH");continue;}
        if(found.status==="SUGGEST"){notice=suggestionQuestion(query,found.rows.map(labelOf));c.candidates={kind,source:"suggest",items:found.rows.map(r=>({id:r.id,name:labelOf(r)})),...basis([])};continue;}
        if(found.status!=="NONE"){notice=detailQuestion(query,label);continue;}
      } else recordNameResolution(entity,!rows.length?"NO_MATCH":rows.length>20?"TOO_MANY":"AMBIGUOUS",rows.length);
      notice=!rows.length?`Não encontrei esse ${label} neste salão.`:rows.length>20?`Muitas opções de ${label}; informe um nome mais específico.`:`Qual ${label}? Selecione uma opção real.`;
      if(rows.length>1&&rows.length<=20)c.candidates={kind,items:rows.map(r=>({id:r.id,name:labelOf(r)})),...basis(rows.map(r=>r.id))};}
  }
  // P2b (flag): the services of a list, one card at a time (a catalog combo of two or more said services is asked, never picked).
  if(createOrAvailability&&f.service_names&&!notice){
    const listed=await timed(c.metrics,"services",()=>resolveServiceList(actor,c,f));codes.push(...listed.codes);
    if(listed.notice){notice=listed.notice;c.waiting_for=listed.waiting_for;if(listed.candidates)c.candidates=listed.candidates;}
  }
  // The professional attends every service: the single one, or (P2b) every service of a resolved list.
  const serviceRefs=createOrAvailability?schedulingServiceRefs(f):undefined,multi=!!f.service_names,scope=multi?{service_refs:serviceRefs}:{service_ref:f.service_ref};
  // P3b (flag): availability with no professional said: the eligible team whose free times are listed (bounded; never a pick).
  let eligibleTeam:{id:string;name:string}[]|undefined;
  if(createOrAvailability&&serviceRefs&&!f.professional_ref&&!notice&&!(held("professional_ref")&&!f.professional_name)){
    const all=await timed(c.metrics,"professional",()=>withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,scope)));
    const named=f.professional_name?await withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,{...scope,query:f.professional_name})):all;
    const confirm=!!f.professional_name&&unproven.has("professional_name")&&named.length>=1&&named.length<=20;
    const alias=aliases&&!self&&!multi&&named.length!==1&&named.length<=20&&!!f.professional_name&&!unproven.has("professional_name")&&!declined("professional_ref",f.professional_name)
      ?await proposeAlias(actor,"professional",f.professional_name,named.map(r=>r.id),{service_ref:f.service_ref}):undefined;
    if(named.length===1&&!confirm){f.professional_ref=named[0].id;c.resolved_names={...c.resolved_names,[named[0].id]:named[0].name};if(f.professional_name)recordNameResolution("professional","MATCH",1);}
    // E2 (V2): the owner as the professional, but not registered here or not doing the service: said plainly, the options shown.
    else if(self&&!named.length){
      const own=await withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,{query:f.professional_name}));codes.push(own.length?"SELF_NOT_ELIGIBLE":"SELF_NOT_PROFESSIONAL");
      notice=own.length?`O profissional informado (você) não realiza ${multi?"todos esses serviços":"esse serviço"}. Escolha uma opção real.`:"Não encontrei seu cadastro como profissional neste salão. Escolha uma opção real.";
      if(all.length&&all.length<=20)c.candidates={kind:"professional_ref",items:all};}
    else if(confirm){notice=confirmQuestion("profissional",named.map(r=>r.name));c.candidates={kind:"professional_ref",source:"confirm",items:named};recordNameResolution("professional","CONFIRM",named.length);}
    else if(alias){notice=aliasQuestion(f.professional_name!,alias.label);c.candidates=aliasCard("professional_ref",alias);recordNameResolution("professional","ALIAS",1);}
    else if(suggest&&f.professional_name&&!named.length&&all.length){
      // "Não está elegível" only when the name is someone in the salon; otherwise it was not found.
      const anyone=await withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,{query:f.professional_name}));
      const found=anyone.length?undefined:await withTenant(actor,tx=>suggestSchedulingProfessionals(tx,actor,{...scope,query:f.professional_name!}));
      recordNameResolution("professional",!found?"NOT_ELIGIBLE":found.status==="SUGGEST"?"SUGGEST":found.status==="NONE"?"NO_MATCH":"DETAIL",found?suggestedRows(found).length:anyone.length);
      if(found?.status==="SUGGEST"){notice=suggestionQuestion(f.professional_name,found.rows.map(r=>r.name));c.candidates={kind:"professional_ref",source:"suggest",items:found.rows,...basis([])};}
      else{notice=!found?multi?notPerformingAll:"O profissional informado não está elegível para esse serviço. Escolha um profissional elegível.":found.status==="NONE"?"Não encontrei esse profissional neste salão. Escolha um profissional elegível.":detailQuestion(f.professional_name,"profissional");
        if(all.length<=20)c.candidates={kind:"professional_ref",items:all};}
    }
    else if(readsV2Enabled()&&op==="availability.get"&&!f.professional_name&&all.length>1&&all.length<=ACROSS_MAX){eligibleTeam=all;codes.push("AVAILABILITY_ACROSS");}
    else {notice=f.professional_name&&!named.length?multi?notPerformingAll:"O profissional informado não está elegível para esse serviço. Escolha um profissional elegível.":!all.length?multi?nobodyPerformsAll:"Nenhum profissional elegível para este serviço.":"Qual profissional? Escolha uma opção real.";
      if(f.professional_name)recordNameResolution("professional",named.length?named.length>20?"TOO_MANY":"AMBIGUOUS":"NO_MATCH",named.length);
      // Only a homonym card of the typed name (not the fallback list of everyone eligible) is a basis to learn from.
      const options=named.length?named:all;if(options.length<=20&&(options.length||!suggest))c.candidates={kind:"professional_ref",items:options,...(f.professional_name&&named.length>1?basis(named.map(r=>r.id)):{})};}
  }
  // V2 (D4): a professional copied from another action still has to perform this action's service(s): asked, never reassigned.
  if(referencesV2Enabled()&&createOrAvailability&&serviceRefs&&f.professional_ref&&refs?.seeded?.professional===f.professional_ref&&!notice){
    const eligible=await withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,scope));
    if(!eligible.some(row=>row.id===f.professional_ref)){codes.push("SAME_AS_NOT_ELIGIBLE");delete f.professional_ref;delete f.professional_name;
      notice="O profissional informado não está elegível para esse serviço. Escolha um profissional elegível.";if(eligible.length&&eligible.length<=20)c.candidates={kind:"professional_ref",items:eligible};}
  }
  if(!createOrAvailability&&f.professional_name&&!f.professional_ref&&!notice){
    const rows=await timed(c.metrics,"professional",()=>withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,{query:f.professional_name})));
    const confirm=unproven.has("professional_name")&&rows.length>=1&&rows.length<=20;
    const alias=aliases&&!self&&rows.length!==1&&rows.length<=20&&!unproven.has("professional_name")&&!declined("professional_ref",f.professional_name)
      ?await proposeAlias(actor,"professional",f.professional_name,rows.map(r=>r.id)):undefined;
    if(rows.length===1&&!confirm){f.professional_ref=rows[0].id;if(copyV2||self)c.resolved_names={...c.resolved_names,[rows[0].id]:rows[0].name};recordNameResolution("professional","MATCH",1);}
    // E2 (V2): the owner is not a professional of this salon: said plainly, with the salon's professionals to choose from.
    else if(self&&!rows.length){
      const team=await withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,{}));codes.push("SELF_NOT_PROFESSIONAL");
      notice=`Não encontrei seu cadastro como profissional neste salão. ${team.length&&team.length<=20?"Escolha uma opção real.":op==="schedule.block"?"De qual profissional devo bloquear a agenda?":"Qual profissional?"}`;
      if(team.length&&team.length<=20)c.candidates={kind:"professional_ref",items:team};}
    else if(confirm){notice=confirmQuestion("profissional",rows.map(r=>r.name));c.candidates={kind:"professional_ref",source:"confirm",items:rows};recordNameResolution("professional","CONFIRM",rows.length);}
    else if(alias){notice=aliasQuestion(f.professional_name,alias.label);c.candidates=aliasCard("professional_ref",alias);recordNameResolution("professional","ALIAS",1);}
    else if(suggest&&!rows.length){
      const found=await withTenant(actor,tx=>suggestSchedulingProfessionals(tx,actor,{query:f.professional_name!}));
      recordNameResolution("professional",found.status==="SUGGEST"?"SUGGEST":found.status==="NONE"?"NO_MATCH":"DETAIL",suggestedRows(found).length);
      if(found.status==="SUGGEST"){notice=suggestionQuestion(f.professional_name,found.rows.map(r=>r.name));c.candidates={kind:"professional_ref",source:"suggest",items:found.rows,...basis([])};}
      // Nothing to click is not a pending choice: no empty option card.
      else notice=found.status==="NONE"?"Não encontrei esse profissional neste salão.":detailQuestion(f.professional_name,"profissional");
    }
    else {notice=rows.length?"Qual profissional? Escolha uma opção real.":"Não encontrei esse profissional neste salão.";if(rows.length<=20)c.candidates={kind:"professional_ref",items:rows,...(rows.length>1?basis(rows.map(r=>r.id)):{})};
      recordNameResolution("professional",rows.length?rows.length>20?"TOO_MANY":"AMBIGUOUS":"NO_MATCH",rows.length);}
  }
  // P2a review: the owner stated a day or clock of the ORIGIN of this change by a quote of its own (a source_date/source_time, or
  // the negated-predicate day the locator reads, B6), before the locate below consumes the hint.
  const statedOrigin=!!(f.source_date||f.source_time||c.locator_hint);
  if(["appointment.change","appointment.cancel"].includes(op)&&!notice&&!f.appointment_ref&&!(waiting.has("customer_ref")&&!f.customer_ref)){
    if(!f.customer_ref&&!(op==="appointment.change"?f.source_date:f.date))notice="Informe o cliente ou a data original do agendamento.";
    else {
      const rows=await timed(c.metrics,"appointments",()=>withTenant(actor,tx=>locateSchedulingAppointments(tx,actor,f,op)));
      // B6 (flag): an origin said only in a negated predicate never selects by itself: it LOCATES. Of the customer's future
      // appointments, the only one on that day is the one the owner meant, whatever else they have booked; none there (a single
      // appointment on another day included) or several there is a card, never another one picked.
      const hint=dateRulesV2Enabled()&&op==="appointment.change"&&!f.source_date?c.locator_hint:undefined,onHint=(row:{start_local:string})=>!hint||hint.dates.includes(row.start_local.slice(0,10));
      const onDay=hint?rows.filter(onHint):rows,pick=onDay.length===1?onDay[0]:undefined;
      // B1 (flag): a dropped past day on which that customer has an appointment of any status may be the one the owner meant
      // ("faltou dia 25"): the next occurrence is never selected by itself; it is a card, beside the past one it cannot change.
      // B6: so is the past reading the negated day dropped ("não veio dia 25").
      const dropped=!pick?[]:[...(pastLine?(c.past_readings??[]).filter(item=>f[item.field]===item.date):[]),
        ...(hint?.dropped??[]).map(day=>({field:"source_date" as const,date:pick.start_local.slice(0,10),dropped:day,expression:hint!.expression}))];
      const client=f.customer_ref??rows[0]?.customer_ref;
      // Read-only and tenant-scoped; a customer or a read that cannot be checked counts as held (a card, never a pick).
      const found=!dropped.length?[]:client?await withTenant(actor,tx=>Promise.all(dropped.map(item=>listSchedulingAppointments(tx,actor,{date:item.dropped,customer_ref:client})))).catch(()=>undefined):undefined;
      const held=found===undefined?dropped:dropped.filter((_,k)=>found[k]?.length);
      // B6: the day the negated predicate read when it dropped a past reading, said like a past reading (B1).
      const hintLine=hint?.dropped?.length?`“${hint.expression}” é ${hint.dates.map(date=>formatDay(date)).join(" ou ")} (${hint.dropped.map(date=>formatDay(date)).join(" e ")} já passou).`:"";
      if(held.length){notice=`Não encontrei agendamento de ${rows[0].customer_name} que a Secretária possa alterar em ${held.map(item=>formatDay(item.dropped)).join(" nem em ")}, que já passou; ${held.map(item=>`“${item.expression}” também é ${formatDay(item.date)}`).join("; ")}. Selecione uma opção real.`;
        c.candidates={kind:"appointment_ref",items:onDay.map(r=>({id:r.appointment_ref,name:`${r.customer_name} — ${formatLocal(r.start_local)} — ${r.professional_name}`}))};}
      else if(pick){f.appointment_ref=pick.appointment_ref;if(hint)delete c.locator_hint;if(hintLine)pastLine=pastLine?`${pastLine} ${hintLine}`:hintLine;}
      else {notice=rows.length?hint&&!onDay.length?`Não encontrei agendamento futuro de ${c.resolved_names?.[f.customer_ref!]??f.customer_name??"o cliente"} em ${hint.dates.map(date=>formatDay(date)).join(" nem em ")}.${hintLine?` ${hintLine}`:""} Selecione uma opção real.`:"Qual agendamento? Selecione uma opção real.":`Não encontrei agendamento futuro pendente ou confirmado ${copyV2?readBack(c,f,op)??"para esses dados":"para esses dados"}. Agendamentos que já começaram ou foram encerrados não podem ser alterados pela Secretária.`;
        if(!rows.length&&pastLine)notice=`${notice} ${pastLine}`;
        if(!rows.length&&hintLine)notice=`${notice} ${hintLine}`;
        if(rows.length>20)notice="Muitos agendamentos. Informe a data e o horário original.";
        else if(rows.length>1||hint&&rows.length===1)c.candidates={kind:"appointment_ref",items:(onDay.length>1?onDay:rows).map(r=>({id:r.appointment_ref,name:`${r.customer_name} — ${formatLocal(r.start_local)} — ${r.professional_name}`}))};}
    }
  }
  // P2a (flag): a change that alters who attends or the services and whose only destination is the very day its located
  // appointment is already on, with no clock or period ("troca a escova da Esperança de terça por hidratação"), keeps the slot:
  // no move, so no clock is asked (GF14 asks the clock of a NEW day). The day is dropped for good (never resurrected by the
  // journal); any other day, a clock or a period still moves (and asks) as before. Review: only when the message states ONE day for
  // this change: a destination said by its own quote beside an origin quote ("de terça pra terça que vem") that reads the same
  // day is never dropped; it keeps the historical path (the clock of the move is asked).
  if(alteringChange(op,f)&&!notice&&f.appointment_ref&&f.date&&!f.time&&!f.period&&!held("date")&&!held("time")&&!refs?.origin?.length&&!released&&!statedOrigin){
    const start=(await withTenant(actor,tx=>getSchedulingAppointment(tx,actor,f.appointment_ref!))).start_local;
    if(start.slice(0,10)===f.date){delete f.date;forget={...forget,forget_origin:[...new Set([...(forget.forget_origin??[]),"date" as const])]};codes.push("ALTER_SAME_DAY_KEPT");}
  }
  // P2a (flag): the NEW professional and the service delta are resolved and checked against the located appointment
  // (refusals, no-op, who performs every service) before any availability check; their questions keep everything else.
  if(op==="appointment.change"&&!notice&&(f.target_professional_name||f.target_professional_ref||f.service_changes)){
    const altered=await resolveAlteration(actor,c,f);codes.push(...altered.codes);
    if(altered.notice){notice=altered.notice;c.waiting_for=altered.waiting_for;if(altered.candidates)c.candidates=altered.candidates;}
  }
  // D-SELF-ORIGIN (V2): "pra sexta no mesmo horário" keeps the located appointment's own clock (or day), from its fresh tenant row.
  // A value the owner said beside it that differs is a conflict (asked, none chosen); a later value of the owner ends the link.
  if(op==="appointment.change"&&f.appointment_ref&&refs?.origin?.length&&!notice){
    const start=(await withTenant(actor,tx=>getSchedulingAppointment(tx,actor,f.appointment_ref!))).start_local,kept:("date"|"time")[]=[];
    for(const field of refs.origin){
      const value=field==="date"?start.slice(0,10):start.slice(11,16),seeded=refs.seeded?.[field];
      if(f[field]===undefined||f[field]===seeded){if(f[field]!==value)codes.push("ORIGIN_KEPT");f[field]=value;(refs.seeded??={})[field]=value;kept.push(field);}
      else if(seeded===undefined&&f[field]!==value){delete f[field];(refs.asked??=[]).push(field);asked.add(field);refs.notice=referenceConflictNotice([field]);codes.push("SAME_AS_CONFLICT");}
      else if(seeded!==undefined){delete refs.seeded![field];codes.push("SAME_AS_OVERRIDDEN");}
      else kept.push(field);
    }
    if(kept.length)refs.origin=kept;else delete refs.origin;
  }
  // "Passa para 11h" keeps the appointment's day. A new day without a time is
  // still a question: the destination clock is never assumed (Golden GF14).
  if(op==="appointment.change"&&f.appointment_ref&&!f.date&&f.time&&!held("date")){
    const original=await withTenant(actor,tx=>getSchedulingAppointment(tx,actor,f.appointment_ref!));f.date=original.start_local.slice(0,10);
    // C4 (flag): the origin's day, never the owner's words (applyKeptDayGuard on a later turn).
    if(dateRulesV2Enabled())c.origin_day_kept=f.date;
  }
  // C4 owner rule 6 (flag READS_V2): a read of ONE professional with no customer and no day, clock or period said is about that
  // professional's next appointments: today while any is left, otherwise their next working day (the day is still asked when the
  // tenant's hours cannot tell). The day read below answers it.
  const proDay=readsV2Enabled()&&!notice&&(op==="appointment.list"||op==="appointment.read")&&f.professional_ref&&!f.customer_ref&&!f.customer_name&&!f.date&&!f.time&&!f.period&&!held("date")&&!c.draft?.temporal_missing?.includes("date")
    ?await timed(c.metrics,"appointments",()=>withTenant(actor,tx=>professionalReadDay(tx,actor,{professional_ref:f.professional_ref!,...(f.service_ref?{service_ref:f.service_ref}:{})}))):undefined;
  if(proDay){f.date=proDay.date;codes.push(proDay.today?"READ_PROFESSIONAL_TODAY":"READ_PROFESSIONAL_NEXT_DAY");}
  if(op==="schedule.block"&&c.block_whole_day&&!notice&&f.professional_ref&&f.date&&!f.end_date&&!f.time&&!f.end_time){
    const bounds=await withTenant(actor,tx=>wholeDayBounds(tx,actor.salonId,f.professional_ref!,f.date!));
    if(bounds){f.time=bounds.time;f.end_time=bounds.end_time;codes.push("BLOCK_WHOLE_DAY");}
    else{notice=`${f.professional_name??"Esse profissional"} não tem expediente em ${dayLabel(f.date)}. De que horas a que horas devo bloquear?`;c.waiting_for="time";codes.push("BLOCK_WHOLE_DAY_NO_HOURS");}
  }
  // P2a: an alteration with no destination said keeps the slot (no date/time required); its names must be resolved.
  const required=schedulingRequiredFields(op,f);
  const missing=[...new Set([...required,...(c.draft?.temporal_missing??[])])].filter(k=>!requiredFieldHeld(f,k)||waiting.has(k));
  let snap:Awaited<ReturnType<typeof schedulingSnapshot>>|undefined;
  let review:SchedulingReview|undefined;
  let mutationSnap:Awaited<ReturnType<typeof schedulingActionSnapshot>>|undefined;
  let exceptionNotice:string|undefined;
  if(!notice&&!missing.length&&isSchedulingMutation(op)){
    if(alteringChange(op,f)){
      // P2a: the new professional/services at the kept slot (or the said destination), for their real duration: a collision
      // offers the new professional's free times (no encaixe here); the domain's own refusal is asked, never forced.
      const move=await timed(c.metrics,"availability",()=>withTenant(actor,tx=>inspectSchedulingMove(tx,actor,f.appointment_ref!,f.date,f.time,excluded,released,f,...(scheduleExceptionsEnabled()?[f.override_requested===true] as const:[] as const)))).catch(error=>{
        if(error instanceof Error&&error.message==="PAST_TIME")return undefined;
        if(error instanceof Error&&["PRO_SERVICE_MISMATCH","SERVICE_INVALID"].includes(error.message))return error.message;
        throw error;});
      if(!move){notice="Esse horário já passou. O agendamento original continua como está. Qual novo horário você prefere?";c.waiting_for="time";}
      else if(typeof move==="string"){const pro=move==="PRO_SERVICE_MISMATCH";c.waiting_for=pro?"target_professional_name":"service_changes";
        notice=pro?"O profissional que vai atender não faz todos os serviços do agendamento. Nada foi alterado. Quem vai atender?":"Um dos serviços não está mais ativo no catálogo. Nada foi alterado. Quais serviços devo manter?";}
      else if(move.exception&&(exceptionNotice=exceptionAsk(c,f,move,move.professional_ref===move.current.dto.professional_ref?move.current.dto.professional_name:c.resolved_names?.[move.professional_ref]))!==undefined)notice=exceptionNotice;
      else if(move.result.violation){c.alternatives=move.alternatives;c.waiting_for="time";
        const who=move.professional_ref===move.current.dto.professional_ref?move.current.dto.professional_name:c.resolved_names?.[move.professional_ref]??"o profissional";
        notice=`Esse horário está indisponível${unavailableCause(move.result.violation)}. Com ${move.result.services.map(s=>s.name).join(" e ")} com ${who}, o atendimento iria até ${clockLabel(toLocalDateTime(move.result.endAt,move.result.timezone))}. O agendamento original continua como está. ${move.alternatives.length?`Tenho ${move.alternatives.map(a=>clockLabel(a.startLocal)).join(", ")}. Qual horário você prefere?`:"Não encontrei outra opção nesse dia. Qual outro dia ou horário você prefere?"}`;}
      else if(customerOverlapGuardEnabled()){
        // Review A (C7 guard, as for a create): the altered attendance never overlaps the same customer's other appointment.
        const own=move.current.dto,overlap=(await withTenant(actor,tx=>listUpcomingCustomerAppointments(tx,actor,own.customer_ref,{take:4,overlapping:{start:move.result.startAt,end:move.result.endAt}})))
          .filter(row=>row.appointment_ref!==f.appointment_ref);
        if(overlap.length){c.waiting_for="time";codes.push("ALTER_CUSTOMER_OVERLAP");
          notice=`${own.customer_name} já tem horário ${formatLocal(overlap[0].start_local)}, e com ${move.result.services.map(s=>s.name).join(" e ")} o atendimento iria até ${clockLabel(toLocalDateTime(move.result.endAt,move.result.timezone))}, sobrepondo os dois. O agendamento original continua como está. Qual horário ou serviços você prefere?`;}
      }
    }
    else if(op==="appointment.change"){
      const consent=f.override_requested===true;
      const move=await timed(c.metrics,"availability",()=>withTenant(actor,tx=>scheduleExceptionsEnabled()?inspectSchedulingMove(tx,actor,f.appointment_ref!,f.date!,f.time!,excluded,released,undefined,consent):
        released?inspectSchedulingMove(tx,actor,f.appointment_ref!,f.date!,f.time!,excluded,released):
        inspectSchedulingMove(tx,actor,f.appointment_ref!,f.date!,f.time!,...(excluded?[excluded] as const:[] as const)))).catch(error=>{
        // A past destination is a normal answer to correct, not a preparation failure.
        if(error instanceof Error&&error.message==="PAST_TIME")return undefined;throw error;});
      if(!move){notice="Esse horário já passou. O agendamento original continua como está. Qual novo horário você prefere?";c.waiting_for="time";}
      else if(move.exception&&(exceptionNotice=exceptionAsk(c,f,move,move.current.dto.professional_name))!==undefined)notice=exceptionNotice;
      else if(move.result.violation){c.alternatives=move.alternatives;c.waiting_for="time";
        notice=`Esse horário está indisponível${unavailableCause(move.result.violation)}. O agendamento original continua como está. ${move.alternatives.length?`Tenho ${move.alternatives.map(a=>clockLabel(a.startLocal)).join(", ")}. Qual horário você prefere?`:"Não encontrei outra opção nesse dia. Qual outro dia ou horário você prefere?"}`;}
    }
    if(!notice)mutationSnap=await timed(c.metrics,"proposal",()=>withTenant(actor,tx=>schedulingActionSnapshot(tx,actor,op,f,...(released?[released] as const:[] as const))));
    // C5 (flag, owner rule 10): a block over committed appointments is never proposed directly: their card (a free interval, or the
    // whole block keeping them) is asked, whatever the request said; only the whole block the owner already picked goes on.
    if(!notice&&mutationSnap&&op==="schedule.block"&&blockOverlapGuardEnabled()&&mutationSnap.affected.length&&!blockOverlapChosen(c.block_overlap,mutationSnap)){
      const asked=await blockOverlapQuestion(actor,mutationSnap);
      notice=asked.message;c.candidates=asked.card;c.waiting_for=BLOCK_OVERLAP_CARD;codes.push("BLOCK_OVERLAP_ASKED");mutationSnap=undefined;
    }
  }
  // P3b (flag): availability with no professional said lists each eligible professional's free times (read-only, one tenant read
  // each, bounded team); the professional is only asked when there is no such team.
  const readsV2=readsV2Enabled(),across=readsV2&&op==="availability.get"&&!f.professional_ref;
  if(!notice&&!missing.length&&across){
    if(!eligibleTeam){notice="Qual profissional? Escolha uma opção real.";c.waiting_for="professional_ref";}
    else{const rows=await timed(c.metrics,"availability",()=>availabilityAcross(actor,eligibleTeam!,{service_ref:serviceRefs![0],...(multi?{service_refs:serviceRefs}:{}),date:f.date!,...(f.time?{time:f.time}:{}),...(f.period?{period:f.period}:{})},excluded));
      c.alternatives=rows.flatMap(row=>row.slots);
      notice=availabilityAcrossMessage(rows,{service:serviceListLabel(c,f)??f.service_name??"o serviço",date:f.date!,time:f.time,period:f.period});}
  }
  if(!notice&&!missing.length&&createOrAvailability){
    const availability=await timed(c.metrics,"availability",()=>withTenant(actor,tx=>getSchedulingAvailability(tx,actor,{service_ref:serviceRefs?.[0]??f.service_ref,...(multi?{service_refs:serviceRefs}:{}),professional_ref:f.professional_ref,date:f.date,...(f.time?{time:f.time}:{}),...(f.period?{period:f.period}:{}),...(f.override_requested!==undefined?{override_requested:f.override_requested}:{}),...(f.override_reason?{override_reason:f.override_reason}:{})},undefined,projection,excluded,
      // P3b (flag): an availability read looks for one more free time than it shows, to say when there are more.
      ...((readsV2&&op==="availability.get"?[SLOT_LIMIT+1]:op==="appointment.create"&&scheduleExceptionsEnabled()?[5,true]:[]) as [number?,boolean?]))));
    c.alternatives=availability.alternatives;
    review=availability.review;
    if(op==="appointment.create"&&!availability.plan){
      // Without the overlap review, a taken slot is still a question about another time.
      notice=review?.message??(availability.alternatives.length?`Esse horário está indisponível. Tenho ${availability.alternatives.map(a=>clockLabel(a.startLocal)).join(", ")}. Qual horário você prefere?`:"Esse horário está indisponível e não encontrei outra opção nesse dia. Qual outro dia ou horário você prefere?");
      c.waiting_for=review?.missing_fields[0]??(availability.alternatives.length?"time":"date");
      if(scheduleExceptionsEnabled())rememberCreateException(c,review);
    }
    else if(op==="appointment.create"){
      const s=snap=await timed(c.metrics,"availability",()=>withTenant(actor,tx=>projection?schedulingSnapshot(tx,actor,f,new Date(),projection):schedulingSnapshot(tx,actor,f)));
      // C7 (flag): the same customer already booked at an overlapping time is a question, never a second proposal.
      const overlap=customerOverlapGuardEnabled()?await withTenant(actor,tx=>listUpcomingCustomerAppointments(tx,actor,s.customer_ref,{overlapping:{start:localDateTimeToUtc(s.startLocal,s.timezone),end:localDateTimeToUtc(s.endLocal,s.timezone)}})):[];
      if(overlap.length){snap=undefined;c.waiting_for="time";
        notice=`${s.customer_name} já tem horário ${formatLocal(overlap[0].start_local)}, que se sobrepõe a este. Isto criaria um segundo agendamento; para remarcar, diga "remarcar", ou informe outro horário.`;}
      // D1 (V2): the move whose origin this create takes may land on it (same professional): asked, never two colliding proposals.
      else if(projection&&refs?.release&&refs.release.professional_ref===s.professional_ref&&refs.release.start<s.endLocal&&s.startLocal<refs.release.end){snap=undefined;c.waiting_for="time";codes.push("RELEASED_ORIGIN_OVERLAP");
        notice=`Esse horário ficaria sobreposto à remarcação que o libera (que vai para ${formatLocal(refs.release.start)}). Nada foi preparado para este agendamento. Qual outro horário você prefere?`;}
    }
    else{const more=readsV2&&availability.alternatives.length>SLOT_LIMIT,offered=more?availability.alternatives.slice(0,SLOT_LIMIT):availability.alternatives;c.alternatives=offered;
      const slots=[...(availability.plan?[availability.plan.startLocal]:[]),...offered.map(s=>s.startLocal)];
      notice=slots.length?`Horários livres${f.professional_name?` de ${shown("professional_name","professional_ref")}`:""} para ${serviceListLabel(c,f)??f.service_name??"o serviço"} em ${dayLabel(f.date!)}: ${slots.map(clockLabel).join(", ")}${more?" e há mais":""}. A consulta não reserva o horário.`:`Não encontrei horário livre${f.professional_name?` para ${shown("professional_name","professional_ref")}`:""} em ${dayLabel(f.date!)}${f.time||f.period?" nesse período":""}.`;}
  }
  c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,...forget,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[],source_missing:sourceMissing,...(review?{review}:{}),rejected_temporal:rejectedTemporal,...(snap?{snapshot:snap}:{}),...(mutationSnap?{action_snapshot:mutationSnap}:{}),
    ...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
  c.fields=c.draft.fields;
  // C2 (flag): a half-day reading the tenant's facts settled is said with the answer about that time and before Confirmar.
  const hoursLine=daypartByHoursEnabled()?(c.daypart_hours??[]).filter(item=>item.value!==undefined&&item.line&&f[item.field]===item.value).map(item=>item.line!).join(" "):"";
  if(notice){c.message=`${notice}${hoursLine&&(review||c.waiting_for==="time")?`\n${hoursLine}`:""}`;return;}
  if(missing.length){const labels=schedulingMissingLabels;
    // A professional is resolved from the service; do not ask before the service is known.
    const ask=missing.filter(k=>(k!=="professional_ref"||!!schedulingServiceRefs(f)||op==="schedule.block")&&!waiting.has(k));
    // C5: only another action's value is missing: a note, never a question (and never a proposal meanwhile).
    if(!ask.length&&refs&&missing.some(k=>waiting.has(k))){refs.blocked=true;c.message=refs.note??"";return;}
    if(ask.length===1)c.waiting_for=ask[0];
    // E2 (V2): a block without a professional shows the salon's professionals to choose from (the owner first when registered
    // here, marked "você"), never a pick.
    if(referencesV2Enabled()&&op==="schedule.block"&&ask.includes("professional_ref")&&!f.professional_name){
      const [team,own]=await withTenant(actor,tx=>Promise.all([listSchedulingProfessionals(tx,actor,{}),schedulingSelfProfessional(tx,actor)]));
      if(team.length&&team.length<=20)c.candidates={kind:"professional_ref",items:[...(own&&team.some(row=>row.id===own.id)?[{id:own.id,name:`${own.name} · você`}]:[]),...team.filter(row=>row.id!==own?.id)]};
    }
    c.message=`${recurringLine(c,op)}${refs?.notice&&ask.some(k=>asked.has(k))?`${refs.notice} `:""}Informe ${ask.map(k=>labels[k]??alterationMissingLabels[k]??serviceListMissingLabels[k]).join(" e ")}.`;return;}
  // P3c (flag): a stated recurrence is never prepared as one silent occurrence. Its first occurrence (now fully known and checked)
  // is offered as a one-option card; only the owner's yes (a click, or a verified pick of that option) goes on to the ordinary
  // proposal and Confirmar. Nothing is proposed meanwhile.
  if(recurrencePending(c.recurrence,op)){
    // Review B: a move or a cancellation names the one appointment it would change (its start before the move) and the destination.
    const origin=isSchedulingMutation(op)?mutationSnap?.before_start:undefined,start=op==="appointment.cancel"?origin:op==="appointment.change"?mutationSnap?.startLocal:undefined;
    const asked=recurrenceQuestion(op,c.recurrence!.expression,start?.slice(0,10)??f.date!,start?.slice(11,16)??f.time,op==="schedule.block"&&f.end_time?`${f.end_date??f.date}T${f.end_time}`:undefined,origin);
    c.candidates={kind:asked.card.kind,items:asked.card.items};c.waiting_for=RECURRENCE_CARD;c.message=`${asked.message}${hoursLine?`\n${hoursLine}`:""}`;codes.push("RECURRENCE_ASKED");return;
  }
  if(c.proposal_deferred){c.message="Dados da ação dependente validados; aguardando proposta conjunta.";return;}
  if(isSchedulingMutation(op)){
    c.proposal=await timed(c.metrics,"proposal",()=>withTenant(actor,tx=>proposeSchedulingAction(tx,actor,{draft_ref:c.draft!.draft_ref,draft_revision:c.draft!.draft_revision},...(released?[released] as const:[] as const))));
    c.message=`${c.proposal.preview}\n${pastLine?`${pastLine}\n`:""}${hoursLine?`${hoursLine}\n`:""}${confirmInstruction}`;return;
  }
  if(op==="appointment.create"){
    c.proposal=await timed(c.metrics,"proposal",()=>withTenant(actor,tx=>proposeAppointmentCreate(tx,actor,{draft_ref:c.draft!.draft_ref,draft_revision:c.draft!.draft_revision},...(projection?[projection] as const:[] as const))));
    c.message=`${c.proposal.preview}\n${hoursLine?`${hoursLine}\n`:""}${confirmInstruction}`;return;
  }
  // P3b (flag): a read names the customer/professional/service as registered once resolved (the owner's words otherwise).
  const registered=(role:"customer_name"|"professional_name"|"service_name",ref:"customer_ref"|"professional_ref"|"service_ref")=>f[ref]?c.resolved_names?.[f[ref]!]??c.selected_names?.[role]??f[role]:undefined;
  // C32 (flag): ONE customer and no day said: that customer's next PENDING/CONFIRMED appointments, with the professional/service
  // said as filters (a small limit, and "há mais" when there are more). Without a customer the day is still asked.
  if(readsV2&&!f.date){
    if(!f.customer_ref){c.waiting_for="date";c.message=`Informe ${schedulingMissingLabels.date}.`;return;}
    const next=await timed(c.metrics,"appointments",()=>upcomingAppointments(actor,f.customer_ref!,{professional_ref:f.professional_ref,service_ref:f.service_ref}));
    const service=registered("service_name","service_ref"),pro=registered("professional_name","professional_ref");
    c.appointments=next.rows;if(next.more)c.read_partial="UPCOMING";codes.push("READ_UPCOMING");
    c.message=upcomingMessage(registered("customer_name","customer_ref")??"o cliente",next.rows,next.more,`${service?` para ${service}`:""}${pro?` com ${pro}`:""}`);return;
  }
  const dayRead={date:f.date,...(f.customer_ref?{customer_ref:f.customer_ref}:{}),...(f.professional_ref?{professional_ref:f.professional_ref}:{}),...(f.service_ref?{service_ref:f.service_ref}:{}),
    // C29 (flag): the clock/period filter is part of the query, applied before its row limit.
    ...(readsV2&&f.time?{time:f.time}:{}),...(readsV2&&f.period?{period:f.period}:{})};
  const rows=await withTenant(actor,tx=>listSchedulingAppointments(tx,actor,dayRead));
  // Never turn a bounded, incomplete result into an apparently complete read.
  if(rows.length>DAY_LIST_LIMIT&&readsV2){
    // C29 (flag): counted per professional (or per period) with a narrower read asked (the professionals as options); never
    // "restrinja por cliente", never the first rows as if they were all.
    const summary=await timed(c.metrics,"appointments",()=>withTenant(actor,tx=>summarizeSchedulingAppointments(tx,actor,dayRead)));
    const said=daySummaryMessage(f.date!,{professional:f.professional_ref?registered("professional_name","professional_ref")??"o profissional":undefined,period:f.period,time:f.time},summary);
    c.read_partial="SUMMARY";c.waiting_for=said.ask;c.message=said.message;codes.push("READ_DAY_SUMMARY");
    if(said.ask==="professional_ref"){const items=await summaryOptions(actor,summary,f.service_ref);if(items)c.candidates={kind:"professional_ref",items};}
    return;
  }
  if(rows.length>50){c.message="Muitos agendamentos. Restrinja a busca por cliente.";return;}
  if(f.time||f.period)rows.splice(0,rows.length,...rows.filter(row=>(!f.time||row.start_local.slice(11,16)===f.time)&&matchesSchedulingPeriod(row.start_local.slice(11),f.period)));
  c.appointments=rows;
  if(op==="appointment.read"&&rows.length>1&&!proDay){c.candidates={kind:"appointment_ref",items:rows.map(r=>({id:r.appointment_ref,name:`${r.customer_name} — ${formatLocal(r.start_local)} — ${r.professional_name}`}))};c.message="Qual agendamento deseja consultar?";return;}
  if(op==="appointment.read"&&rows.length===1)c.appointments=[await withTenant(actor,tx=>getSchedulingAppointment(tx,actor,rows[0].appointment_ref))];
  // C29 (flag): the answer says the period/clock it was filtered by.
  // A professional chosen from the summary's options (no name typed) is named as registered.
  const filtered=readsV2?`${periodLabel(f.period)}${f.time?` às ${formatClock(f.time)}`:""}`:"",who=f.professional_name?shown("professional_name","professional_ref"):readsV2?registered("professional_name","professional_ref"):undefined;
  c.message=!rows.length?`${who?`${who} não tem atendimentos`:f.customer_name?`Não encontrei atendimentos de ${shown("customer_name","customer_ref")}`:"Nenhum atendimento"} em ${dayLabel(f.date!)}${filtered}.`:
    `${who?`Agenda de ${who}`:"Agenda"} em ${dayLabel(f.date!)}${filtered}:\n`+c.appointments.map(r=>`${clockLabel(r.start_local)} — ${r.customer_name} (${r.services.map(s=>s.serviceName).join(", ")}) com ${r.professional_name}${r.status==="CONFIRMED"?"":` · ${statusLabels[r.status]??r.status}`}`).join("\n");
  // C4 rule 6: nothing left today is said before the next working day's agenda (that day is never presented as today).
  if(proDay&&!proDay.today)c.message=`${who??"O profissional"} não tem mais atendimentos hoje. Próximo dia de trabalho: ${dayLabel(f.date!)}.\n${c.message}`;
}
/** Choosing among published appointment options, Luna may copy the chosen option's
 * day or clock into a source role the message does not prove ("O das 14h" → day 13).
 * Such an echo is never evidence: it is dropped only when the proven coordinates
 * already select exactly one published option and that option agrees with it.
 * Any other unproven coordinate keeps the normal question. */
async function onlyOptionEchoes(actor:ServiceActor,c:SchedulingState,operation:string,grounded:{patch:SchedulingFields;rejected:TemporalRejection[];pending_temporal_ambiguities:unknown[];pending_calendar_conflicts:unknown[]}){
  const roles=operation==="appointment.change"?["source_date","source_time"] as const:operation==="appointment.cancel"?["date","time"] as const:undefined;
  if(!roles||c.candidates?.kind!=="appointment_ref"||!grounded.rejected.length||grounded.pending_temporal_ambiguities.length||grounded.pending_calendar_conflicts.length)return false;
  if(!c.draft||new Date(c.draft.expires_at).getTime()<=Date.now()||JSON.stringify(c.draft.fields)!==JSON.stringify(c.fields))return false;
  if(!grounded.rejected.every(r=>(roles as readonly string[]).includes(r.field)&&grounded.patch[r.field]===undefined))return false;
  const [dateRole,timeRole]=roles,day=grounded.patch[dateRole]??c.fields[dateRole],clock=grounded.patch[timeRole]??c.fields[timeRole];
  if(!day&&!clock)return false;
  const items=c.candidates.items;
  const options=await withTenant(actor,tx=>Promise.all(items.map(item=>getSchedulingAppointment(tx,actor,item.id)))).catch(()=>undefined);
  const matches=options?.filter(o=>(!day||o.start_local.slice(0,10)===day)&&(!clock||o.start_local.slice(11,16)===clock));
  if(matches?.length!==1)return false;
  const chosen=matches[0].start_local;
  return grounded.rejected.every(r=>r.value===(r.field===dateRole?chosen.slice(0,10):chosen.slice(11,16)));
}
/** B4: day/clock values Luna copied beside a chosen appointment option ("o das 14h" → source_time 14:00)
 * must be that option's own coordinates. Each echoed role is read like any answer (its grounded value,
 * or the unproven value itself; a half-day ambiguity agrees when one candidate is the option's clock).
 * A role that cannot be read disagrees: the card is asked again and nothing is picked. */
export async function schedulingChoiceAgrees(actor:ServiceActor,c:{fields:SchedulingFields;operation:string;waiting_for?:string;draft?:SchedulingState["draft"]},ref:string,
  echo:Record<string,unknown>,evidence:readonly {field:string;text:string}[],source:string):Promise<boolean>{
  const {day,clock}=appointmentEchoRoles(c.operation),raw=schedulingPatch.parse(echo);
  const present=new Set<string>([...Object.keys(raw).flatMap(key=>Object.hasOwn(temporalValueRoles,key)?[temporalValueRoles[key as keyof typeof temporalValueRoles]]:[]),...evidence.map(entry=>entry.field)]);
  if(!present.size&&raw.period===undefined)return true;
  const appointment=await withTenant(actor,tx=>getSchedulingAppointment(tx,actor,ref)).catch(()=>undefined);
  if(!appointment)return false;
  const start=appointment.start_local;
  if(raw.period!==undefined&&!matchesSchedulingPeriod(start.slice(11),raw.period))return false;
  if([...present].some(role=>role!==day&&role!==clock))return false;
  if(!present.size)return true;
  const {period:_period,...temporal}=raw;void _period;
  const timezone=await withTenant(actor,tx=>schedulingTimezone(tx,actor));
  const liveDraft=c.draft?{...c.draft,scope_valid:JSON.stringify(c.draft.fields)===JSON.stringify(c.fields)}:undefined;
  const grounded=groundSchedulingTemporalTurn(c.fields,temporal,source,timezone,new Date(),c.waiting_for,c.operation,evidence as SchedulingTemporalEvidence,liveDraft);
  return [day,clock].filter(role=>present.has(role)).every(role=>{
    const expected=role===day?start.slice(0,10):start.slice(11,16);
    const value=grounded.patch[role]??grounded.rejected.find(item=>item.field===role)?.value;
    return value===expected||grounded.pending_temporal_ambiguities.some(item=>item.field===role&&item.candidates.includes(expected));
  });
}
/** Options of one grounding. `scoped`: sourceMessage is a verified per-action clause view of
 * a compound request (secretary-sibling-scope.ts), so scope coverage applies. `names`: the whole
 * user message, the reference for names Luna emitted (a name may sit outside the action's clause). */
export type SchedulingGroundingOptions={scoped?:boolean;names?:string;
  /** B5 (plan turns): a service name that fails its literal proof (ENTITY_MENTION_CONFLICT) leaves only
   * this patch's service and is asked; without it the whole patch is refused, as before. */
  askUnprovenService?:boolean;
  /** C4 (flag SALON_SECRETARY_DATE_RULES_V2): `single`, sourceMessage is the whole message of a request with this one action (its
   * own text, as a `scoped` clause is); `references`, the literals of its same_as links (what they state is theirs). */
  single?:boolean;references?:readonly string[];
  /** C4 (same flag): sourceMessage is the sibling-masked message of a compound request whose own clause is NOT verified; `own`, that
   * clause's occurrences, `siblings`, the other actions' clauses and quotes (secretary-sibling-scope.ts foreignClauses). */
  unverified?:{own:readonly (readonly [number,number])[];siblings:readonly (readonly [number,number])[]}};
/** C3: a customer/professional name Luna emitted that the message does not contain ("tatiane" → "Tatiana") is a model
 * claim, not evidence. Picking an option of an ordinary homonym card by its exact name is an echo of that option (as
 * today); an option of a suggestion/confirmation card is resolved only by a click or by the owner writing the name.
 * The booleans are always telemetry; with SALON_SECRETARY_NAME_SUGGESTIONS the claim is shown as an option to confirm. */
async function checkLunaNames(actor:ServiceActor,c:SchedulingState,raw:SchedulingFields,text:string|undefined,scope:string|undefined){
  if(text===undefined)return;
  for(const [role,kind]of [["customer_name","customer_ref"],["professional_name","professional_ref"]] as const){
    const name=raw[role];
    if(typeof name!=="string"||name===c.fields[role])continue;
    const inMessage=nameInText(name,text);
    const echo=!inMessage&&c.candidates?.kind===kind&&!c.candidates.source&&c.candidates.items.some(item=>sameName(item.name,name)||sameName(item.name.split(" · ")[0],name));
    // C7: a professional name Luna expanded from the directory ("rodrigo" → "Rodrigo Lima") is proven when the owner's
    // tokens for it, in this action's scope, single out exactly that directory entry. Customers are never in the directory,
    // and the customer's own name never proves a professional ("Carla Lima" is not "Rodrigo Lima"; review): blanked first.
    const proof=!inMessage&&!echo&&role==="professional_name"&&nameSuggestionsEnabled()&&
      directorySubsetProof(name,await withoutCustomerMentions(actor,scope??text,raw.customer_name??c.fields.customer_name),await withTenant(actor,tx=>salonDirectoryNames(tx,actor,"professional"))??[]);
    recordNameCheck({role:role==="customer_name"?"customer":"professional",in_message:inMessage,option_echo:echo,...(proof?{directory_proof:true as const}:{})});
    if(!nameSuggestionsEnabled())continue;
    const unproven=new Set(c.unproven_names);
    if(inMessage||echo||proof)unproven.delete(role);else unproven.add(role);
    c.unproven_names=unproven.size?[...unproven]:undefined;
  }
}
/** C7: a reply that only picks an option of the open card (it restates a published option's name and carries no temporal
 * selector, quote or period) is not temporal evidence: its words ("a segunda" = the second option) never re-verify, and so
 * never erase, the values already proven. The owner's own message decides too (replyOnlyPicks): a negator or another
 * temporal atom there ("a Amanda Souza, mas não amanhã") keeps the full grounding. Anything else keeps it as well. */
function pureSelectionReply(c:SchedulingState,raw:object,evidence:readonly unknown[]|undefined,message:string){
  const card=c.candidates;
  return !!card?.items.length&&!evidence?.length&&onlyRestatesOptions(card.kind,card.items.map(item=>item.name),raw)&&
    replyOnlyPicks(message,Object.values(raw).filter((value):value is string=>typeof value==="string"));
}
async function applySchedulingInterpretationMutable(actor:ServiceActor,c:SchedulingState,result:SchedulingInterpretation&{temporal_negative_context?:unknown},sourceMessage?:string,options:SchedulingGroundingOptions={}):Promise<string[]>{
  const start=performance.now();c.proposal=undefined;c.interpretation_source??="MODEL";
  const {operation=c.operation,temporal_evidence,temporal_negative_context,target_professional_name,service_changes,service_names,...raw}=result;if(!operation)throw Error("OPERATION_REQUIRED");
  if(c.operation&&c.operation!==operation)throw Error("OPERATION_MISMATCH");c.operation=operation;
  // Owner 06/10: "o dia inteiro" with no time said blocks the professional's whole working day (prepare() reads their hours).
  if(operation==="schedule.block"&&sourceMessage!==undefined){if(raw.time||raw.end_time)c.block_whole_day=false;else if(saysWholeDay(sourceMessage))c.block_whole_day=true;}
  // P3c (flag): a recurrence this turn's own words state for a create/block (re)opens its question: never one silent occurrence.
  // Review B: an adjective of the construction inside the owner's own names of this action ("pacote mensal") is that name.
  const recurring=recurrenceFromTurn(c.recurrence,operation,sourceMessage,[raw.service_name,...service_names??[],raw.customer_name,raw.professional_name,
    c.fields.service_name,...c.fields.service_names??[],c.fields.customer_name,c.fields.professional_name]);if(recurring.state)c.recurrence=recurring.state;
  // A3 (flag): the origin roles a chosen appointment filled, as they stand before this turn.
  const derived=originFromRef(c);
  // P2b (flag): the owner's service list, proven service by service (the backend never splits the owner's words itself). While
  // the action holds a list, a single service_name is a re-echo, the answer to the open service card, or a new service.
  const listCodes:string[]=[];
  const listed=await groundServiceList(actor,c,operation,service_names,raw.service_name,sourceMessage,raw.customer_name??c.fields.customer_name,listCodes);
  if(listed.single!==undefined)raw.service_name=listed.single;else if(listed.dropSingle||listed.ask==="service_names")delete raw.service_name;
  if(listed.ask==="service_names"&&!options.askUnprovenService)throw Error("ENTITY_MENTION_CONFLICT");
  const answered=listed.names||listed.ask?undefined:listAnswer(c,raw.service_name,sourceMessage);
  // Review A: one service beside a held list that is not a plain echo (restating vs narrowing vs adding) is asked, nothing kept.
  if(answered?.conflict&&!options.askUnprovenService)throw Error("ENTITY_MENTION_CONFLICT");
  const listAsk=listed.ask?{notice:listed.notice!,waiting_for:listed.ask}:answered?.conflict?{notice:answered.conflict,waiting_for:"service_names"}:undefined;
  if(answered?.pick)await selectServiceList(actor,c.candidates!,c,answered.pick).catch(error=>{if(!(error instanceof Error&&error.message==="SELECTION_INVALID"))throw error;delete answered.pick;answered.unanswered=true;});
  if(answered)delete raw.service_name;
  // Repeating an already accepted pair during a time/channel continuation is not new evidence.
  // A new service or customer association must be grounded in the current message.
  // B4: a fold-equal re-echo of the accepted query, or of the option the owner chose, names no one new.
  const echoedName=(query:(typeof nameRefs)[number][0],said:unknown)=>typeof said==="string"&&said!==c.fields[query]&&
    (sameAcceptedQuery(said,c.fields[query])||!!c.fields[nameRefs.find(([name])=>name===query)![1]]&&sameAcceptedQuery(said,c.selected_names?.[query]));
  const entityPairChanged=raw.service_name!==c.fields.service_name&&!echoedName("service_name",raw.service_name) || (raw.customer_name!==undefined&&raw.customer_name!==c.fields.customer_name&&!echoedName("customer_name",raw.customer_name));
  const selection=c.candidates?.kind==="service_ref"&&c.fields.service_name&&c.draft&&
    new Date(c.draft.expires_at).getTime()>Date.now()&&JSON.stringify(c.draft.fields)===JSON.stringify(c.fields)&&
    (raw.customer_name===undefined||raw.customer_name===c.fields.customer_name)
      ?{query:c.fields.service_name,candidates:c.candidates.items}:undefined;
  // B5: a contradicted temporal role (decoder marker) and an unproven service are codes-only divergence.
  const codes=temporal_evidence?.some(entry=>entry.conflict)?["TEMPORAL_SELECTOR_CONFLICT"]:[];
  codes.push(...listCodes);if(answered?.unanswered)codes.push("MULTI_SERVICE_ANSWER_UNRESOLVED");if(answered?.conflict)codes.push("MULTI_SERVICE_CONFLICT");
  if(recurring.stated)codes.push("RECURRENCE_STATED");
  let serviceUnproven=false;
  if(sourceMessage!==undefined&&raw.service_name&&entityPairChanged){
    try{await validateSchedulingEntityMentions(actor,sourceMessage,{customer_name:raw.customer_name??c.fields.customer_name,service_name:raw.service_name},selection);}
    catch(error){
      const conflict=error instanceof Error&&error.message==="ENTITY_MENTION_CONFLICT",tolerant=conflict&&nameSuggestionsEnabled();
      // C7 (flag): a directory service name Luna expanded from the owner's words is proven by the exact-token subset rule.
      const proof=tolerant&&await serviceDirectoryProof(actor,sourceMessage,raw.service_name,raw.customer_name??c.fields.customer_name);
      if(tolerant)recordNameCheck({role:"service",in_message:false,option_echo:false,...(proof?{directory_proof:true as const}:{})});
      if(!proof){
        // The validator keeps refusing; only the plan turn narrows the refusal to the unproven service.
        if(!options.askUnprovenService||!conflict)throw error;
        delete raw.service_name;serviceUnproven=true;codes.push("ENTITY_MENTION_CONFLICT");
      }
    }
  }
  // P2a (flag): the NEW professional and the service delta, proven against the owner's words (never locators).
  const alteration=await groundAlteration(actor,c,operation,{target_professional_name,service_changes},sourceMessage,options.names??sourceMessage,raw.customer_name??c.fields.customer_name,codes);
  if(alteration.unproven!==undefined){const set=new Set(c.unproven_names);if(alteration.unproven)set.add("target_professional_name");else set.delete("target_professional_name");c.unproven_names=set.size?[...set]:undefined;}
  // Review A: the answer to an open service card of the delta is a pick of that card (rechecked like a click), never a new delta.
  if(alteration.answer?.pick)await selectAlteration(actor,c.candidates!,c,alteration.answer.pick).catch(error=>{if(!(error instanceof Error&&error.message==="SELECTION_INVALID"))throw error;alteration.answer={unanswered:true};});
  const timezone=await withTenant(actor,tx=>schedulingTimezone(tx,actor));
  const liveDraft=c.draft?{...c.draft,scope_valid:JSON.stringify(c.draft.fields)===JSON.stringify(c.fields)}:undefined;
  const negativeContext=schedulingNegativeContext(temporal_negative_context,{source:sourceMessage,previous:c.fields,raw:schedulingPatch.parse(raw),operation,evidence:temporal_evidence?.filter(entry=>!entry.conflict&&entry.excluded===undefined),draft:liveDraft});
  // C7: a pure pick of the open card is not read as dates or clocks ("a segunda" is the second option, not Monday).
  const pick=sourceMessage!==undefined&&pureSelectionReply(c,raw,temporal_evidence,sourceMessage);
  const grounded=groundSchedulingTemporalTurn(c.fields,schedulingPatch.parse(raw),pick?undefined:sourceMessage,timezone,new Date(),c.waiting_for,operation,temporal_evidence,liveDraft,negativeContext);
  // C4 (flag): whether each exclusion was proven and whether it refused an affirmed value (codes only).
  codes.push(...polarityCodes(grounded));
  // Flag SALON_SECRETARY_DATE_RULES_V2 (codes only).
  if(grounded.past_readings?.length)codes.push("PAST_READING_DROPPED");
  if(grounded.locator_hints?.length)codes.push("SOURCE_NEGATED_PREDICATE");
  // Flag SALON_SECRETARY_DAYPART_RULES_V2 (codes only): a half-day choice the other edge of the same interval settled.
  if(grounded.daypart_resolutions?.length)codes.push(...grounded.daypart_resolutions.map(item=>item.code));
  // UX (flag): the half-day question this answer was for (a repeat of the same two readings is never asked again silently).
  const askedClock=daypartRulesV2Enabled()&&liveDraft?.scope_valid!==false&&c.waiting_for?(c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities)?.find(item=>item.field===c.waiting_for):undefined;
  if(await onlyOptionEchoes(actor,c,operation,grounded))grounded.rejected.splice(0);
  // A3 (review B): Luna restating an origin role the chosen appointment filled (the backend's own value, from the fresh tenant row)
  // is an echo: never evidence, never a reason to lose the appointment. A different value keeps the proof rule (and drops the ref).
  if(derived&&c.fields.appointment_ref){
    const echo=(r:TemporalRejection)=>r.code==="SOURCE_TEMPORAL_CONFLICT"&&Object.hasOwn(derived,r.field)&&derived[r.field as OriginRole]===r.value;
    if(grounded.rejected.some(echo)){grounded.rejected.splice(0,grounded.rejected.length,...grounded.rejected.filter(r=>!echo(r)));codes.push("ORIGIN_FROM_REF_ECHO");}
  }
  const divergence=options.scoped&&sourceMessage!==undefined&&!pick?applyScopeCoverage(grounded,sourceMessage,timezone,new Date(),operation,schedulingPatch.parse(raw),temporal_evidence):[];
  // C4 (flag SALON_SECRETARY_DATE_RULES_V2): a change of the action's own text never keeps its origin's day in place of a day the owner
  // wrote there that no field of it consumed (applyKeptDayGuard); a day linked by same_as (seeded, waiting, asked) or kept on purpose
  // ("no mesmo dia") is the link's.
  const refs=c.references,dayLinked=!!refs&&(!!refs.origin?.includes("date")||!!refs.waiting?.includes("date")||!!refs.asked?.includes("date")||refs.seeded?.date!==undefined);
  // The origin's day an earlier preparation kept is no held day while the action still holds it and this turn proved none.
  const keptDay=c.origin_day_kept!==undefined&&c.fields.date===c.origin_day_kept&&grounded.patch.date===undefined?c.origin_day_kept:undefined;
  if(keptDay===undefined)delete c.origin_day_kept;
  if((options.scoped||options.single||options.unverified)&&sourceMessage!==undefined&&!pick&&!dayLinked)codes.push(...applyKeptDayGuard(grounded,sourceMessage,operation,temporal_evidence,
    [raw.reason,raw.override_reason,raw.customer_name,raw.service_name,raw.professional_name,target_professional_name,...service_names??[],...(service_changes??[]).map(item=>item.service_name),...options.references??[]]
      .filter((text):text is string=>typeof text==="string"),{kept:keptDay,...(options.unverified?{foreign:options.unverified}:{})}));
  if(keptDay!==undefined&&grounded.rejected.some(item=>item.field==="date"))delete c.origin_day_kept;
  // A failed answer to a pending field is an unaccepted patch, not permission
  // to erase previously grounded values. No proposal existed for this incomplete
  // draft; retain its revision/identity and ask about the same role again.
  if(c.waiting_for&&c.draft?.missing_fields.includes(c.waiting_for)&&grounded.rejected.length&&!grounded.pending_temporal_ambiguities.length&&!grounded.pending_calendar_conflicts.length){
    // UX (flag): a DATE_CHOICE is never asked again silently: what was not understood, then the same two dates.
    const waited=c.waiting_for,choice=dateRulesV2Enabled()?(c.pending_calendar_conflicts??c.draft.pending_calendar_conflicts)?.find(item=>item.field===waited&&item.kind==="DATE_CHOICE"):undefined;
    if(choice)codes.push("DATE_CHOICE_ANSWER_UNRESOLVED");
    // UX (flag SALON_SECRETARY_DAYPART_RULES_V2): an answer not applied is said on its own line (visible in a plan too) above the
    // same question, never stacked; a half-day question comes back with what was not understood.
    if(askedClock&&!choice)codes.push("DAYPART_ANSWER_UNRESOLVED");
    const unapplied="Não consegui associar essa resposta com segurança à informação solicitada.";
    c.message=choice?.kind==="DATE_CHOICE"?`${dateChoiceRetryFor(choice.candidates)}\n${calendarConflictQuestion(choice,operation)}`:askedClock?`${daypartChoiceRetry}\n${temporalAmbiguityQuestion(askedClock,operation)}`:
      daypartRulesV2Enabled()?`${unapplied}\n${c.message.startsWith(unapplied)?c.message.slice(unapplied.length).replace(/^\s+/,""):c.message}`:unapplied+" "+c.message;
    c.metrics.message=(c.metrics.interpretation??0)+performance.now()-start;
    return [...divergence,...codes];
  }
  const patch=grounded.patch;
  // B4: such an echo neither drops the chosen ref nor the located appointment: the same homonym
  // question is never asked twice.
  const echoed=new Set<(typeof nameRefs)[number][0]>();
  for(const [query]of nameRefs)if(echoedName(query,patch[query])){delete patch[query];echoed.add(query);}
  const named=schedulingPatch.parse(raw);for(const query of echoed)delete named[query];
  await checkLunaNames(actor,c,named,options.names??sourceMessage,sourceMessage);
  const sourceResult=groundSchedulingReasons(patch,c.fields,sourceMessage,c.draft?{operation:c.draft.operation,waiting_for:c.waiting_for,fields:c.draft.fields,review:c.draft.review,expires_at:c.draft.expires_at}:undefined);
  if(exceptionRulesV2Enabled()){
    // A1-GF23 (flag): an encaixe consent beside "another slot" never retracts the proven day/time (the negation and consent guard
    // above ran on the whole patch first); the live review decides what the consent still means. Codes only.
    const live=c.draft&&new Date(c.draft.expires_at).getTime()>Date.now()&&JSON.stringify(c.draft.fields)===JSON.stringify(c.fields)?c.draft.review:undefined;
    const contradiction=reconcileExceptionDecision(patch,c.fields,{review:live,literal:literalOverrideConsent(sourceMessage)});
    if(contradiction.length){codes.push(...contradiction);sourceResult.accepted=sourceResult.accepted.filter(field=>field!=="override_reason");}
    // The latest decision wins: an encaixe consent supersedes an "other slot" stored in an earlier turn (never both kept).
    if(patch.override_requested===true&&c.fields.destination_mode==="ALTERNATIVE_SLOT")delete c.fields.destination_mode;
  }
  c.source_missing=askedSourceFields(pendingSourceFields(c.source_missing??c.draft?.source_missing,sourceResult));
  if(patch.override_reason!==undefined&&patch.override_reason!==c.fields.override_reason&&!("override_reason_source" in patch))delete c.fields.override_reason_source;
  if(c.fields.override_requested!==undefined&&["customer_name","service_name","professional_name","date","time","period"].some(k=>patch[k as keyof typeof patch]!==undefined&&patch[k as keyof typeof patch]!==c.fields[k as keyof typeof c.fields])&&patch.override_requested!==true){delete c.fields.override_requested;delete c.fields.override_reason;delete c.fields.override_reason_source;}
  if(patch.destination_mode==="ALTERNATIVE_SLOT"){c.fields.override_requested=false;delete c.fields.override_reason;delete c.fields.override_reason_source;if(patch.time===undefined)delete c.fields.time;}
  if(patch.override_requested===false){delete c.fields.override_reason;delete c.fields.override_reason_source;}
  const reconciled=reconcileSchedulingTemporal(c.fields,patch).fields;
  for(const [query,ref]of nameRefs){
    if(patch[query]!==undefined&&patch[query]!==c.fields[query]){delete c.fields[ref];if(query==="service_name")delete c.fields.professional_ref;
      if(c.selected_names){delete c.selected_names[query];if(query==="service_name")delete c.selected_names.professional_name;}}
  }
  // P2a: the alteration joins the patch; a different NEW professional or delta drops what was resolved for the old words.
  Object.assign(patch,alteration.patch);
  if(patch.target_professional_name!==undefined&&patch.target_professional_name!==c.fields.target_professional_name){delete c.fields.target_professional_ref;if(c.selected_names)delete c.selected_names.target_professional_name;}
  if(patch.service_changes!==undefined&&JSON.stringify(patch.service_changes)!==JSON.stringify(c.fields.service_changes))delete c.fields.service_changes_ref;
  // P2b: one form of the services at a time. A new list replaces the single service (and the professional's ref, re-checked for
  // every service; an encaixe consent for another duration); a new single service replaces the list. A list whose words name
  // two professionals keeps none of them (asked).
  if(listed.names){
    patch.service_names=listed.names;
    if(JSON.stringify(listed.names)!==JSON.stringify(c.fields.service_names)){
      c.fields.service_list_ref=listed.refs;delete c.fields.service_name;delete c.fields.service_ref;delete c.fields.professional_ref;
      if(c.selected_names){delete c.selected_names.service_name;delete c.selected_names.professional_name;}
      if(patch.override_requested!==true){delete c.fields.override_requested;delete c.fields.override_reason;delete c.fields.override_reason_source;}
    }
  }else if(patch.service_name!==undefined&&c.fields.service_names){delete c.fields.service_names;delete c.fields.service_list_ref;}
  if(listed.ask==="professional_name"){delete patch.professional_name;delete c.fields.professional_name;delete c.fields.professional_ref;if(c.selected_names)delete c.selected_names.professional_name;}
  if(c.fields.appointment_ref&&["customer_name","service_name","professional_name","source_date","source_time",...(operation==="appointment.cancel"?["date","time"]:[])].some(k=>patch[k as keyof typeof patch]!==undefined&&patch[k as keyof typeof patch]!==c.fields[k as keyof typeof c.fields]))delete c.fields.appointment_ref;
  if(operation==="appointment.cancel"&&(reconciled.time!==c.fields.time||reconciled.period!==c.fields.period))delete c.fields.appointment_ref;
  // Preserve reference invalidations above while replacing the temporal state.
  const reconciliation=reconcileSchedulingTemporal(c.fields,patch);
  applyTemporalRejections(reconciliation.fields,c.fields,grounded.rejected);
  // C5 agent (flag SALON_SECRETARY_AGENT; §6.2): a continuation that changes what a derived value stood on drops that value with its
  // provenance (prepare() asks it again); the owner's own new value for the derived field replaces it. Without agent_basis: nothing.
  if(c.agent_basis?.length)codes.push(...agentBasisPatched(c,reconciliation.fields,patch));
  c.pending_temporal_ambiguities=nextTemporalAmbiguities(c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities,grounded.pending_temporal_ambiguities,reconciliation.fields,schedulingPatch.parse(raw),grounded.rejected);
  c.pending_calendar_conflicts=nextCalendarConflicts(c.pending_calendar_conflicts??c.draft?.pending_calendar_conflicts,grounded.pending_calendar_conflicts,reconciliation.fields);
  // B5: the owner named a service that could not be proven: the accepted one (and what derives from it)
  // is not kept as if it were the answer; the service is asked and nothing is proposed meanwhile.
  // P2b: so is a service list this turn did not prove (negated, unproven, contradicted): no service of it (nor the previous) is kept.
  if(serviceUnproven||listAsk?.waiting_for==="service_names"){for(const key of ["service_name","service_ref","professional_ref","appointment_ref","service_names","service_list_ref"] as const)delete reconciliation.fields[key];
    if(c.selected_names){delete c.selected_names.service_name;delete c.selected_names.professional_name;}}
  // P2a: an alteration part that was negated or not proven drops the accepted one it would replace (asked, never kept).
  if(alteration.ask==="target_professional_name"){delete reconciliation.fields.target_professional_name;delete reconciliation.fields.target_professional_ref;if(c.selected_names)delete c.selected_names.target_professional_name;}
  if(alteration.ask==="service_changes"||alteration.notice){delete reconciliation.fields.service_changes;delete reconciliation.fields.service_changes_ref;}
  if(dateRulesV2Enabled()){
    // B1: a day's dropped past reading stays shown while that day keeps its value; B6: the negated origin is kept until located.
    const readings=[...(c.past_readings??[]).filter(item=>grounded.patch[item.field]===undefined),...(grounded.past_readings??[])];
    if(readings.length)c.past_readings=readings;else delete c.past_readings;
    if(grounded.locator_hints?.length)c.locator_hint=grounded.locator_hints[0];
    else if(grounded.patch.source_date!==undefined||reconciliation.fields.customer_name!==c.fields.customer_name)delete c.locator_hint;
  }
  if(dateRulesV2Enabled()||daypartByHoursEnabled()){
    // LOCATE (dates flag): what the owner excluded for an identity role still open (every exclusion's own reading, proven or not).
    // C2 (hours flag): the proven clock exclusions of a role still open, so no later turn settles it on an excluded reading.
    const identity=!dateRulesV2Enabled()?[]:operation==="appointment.change"?["source_date","source_time"]:operation==="appointment.cancel"?["date","time"]:[];
    const clocks=daypartByHoursEnabled()?["time","end_time","source_time"]:[];
    const excludedReadings=[...(c.excluded_readings??[]).filter(item=>grounded.patch[item.field as keyof SchedulingFields]===undefined),
      ...(grounded.exclusions?.claimed??[]).filter(item=>identity.includes(item.field)).map(item=>({field:item.field as string,values:[...item.values]})),
      ...(grounded.exclusions?.verified??[]).filter(item=>clocks.includes(item.field)).map(item=>({field:item.field as string,values:[...item.values]}))];
    if(excludedReadings.length)c.excluded_readings=excludedReadings;else delete c.excluded_readings;
  }
  if(daypartByHoursEnabled()){
    // C2: a half-day question beside a daypart the owner wrote elsewhere in this action ("amanhã de manhã … pras 2") stays theirs
    // while it is open: the salon's hours never pick a reading against it.
    const open=new Set<string>((c.pending_temporal_ambiguities??[]).map(item=>item.field));
    const quotes=(temporal_evidence??[]).filter(entry=>entry.excluded===undefined&&!entry.conflict&&["time","end_time","source_time"].includes(entry.field)).map(entry=>entry.text);
    const fresh=grounded.pending_temporal_ambiguities.length&&sourceMessage!==undefined&&!pick&&daypartWrittenOutside(sourceMessage,quotes)?grounded.pending_temporal_ambiguities.map(item=>item.field):[];
    const written=[...new Set<DaypartField>([...(c.daypart_written??[]),...fresh])].filter(field=>open.has(field));
    if(written.length)c.daypart_written=written;else delete c.daypart_written;
  }
  // C3 (flag): an interval edge the other edge settled is kept with its two readings (re-checked by the tenant's hours).
  const byInterval=grounded.daypart_resolutions??[];
  if(byInterval.length)c.daypart_hours=[...(c.daypart_hours??[]).filter(item=>!byInterval.some(settled=>settled.field===item.field)),
    ...byInterval.map(item=>({field:item.field,value:item.value,candidates:item.candidates,expression:item.expression,basis:"INTERVAL"}))];
  forgetOriginFromRef(c,reconciliation.fields,derived);
  c.fields=reconciliation.fields;await prepare(actor,c,[...reconciliation.rejected,...grounded.rejected],sourceResult.rejected,serviceUnproven,excludedClocks(grounded.exclusions),codes,alteration.notice?undefined:alteration.ask,listAsk??(alteration.notice?{notice:alteration.ask==="target_professional_name"?`${alteration.notice} ${alterationAskQuestion(alteration.ask)}`:alteration.notice,waiting_for:"service_changes"}:undefined));c.metrics.message=(c.metrics.interpretation??0)+performance.now()-start;
  // P2b: an answer that did not resolve the open service card is said above the same card (never a silent re-ask).
  if(answered?.unanswered&&isServiceListField(c.candidates?.kind))c.message=`${unansweredServiceCard}
${c.message}`;
  // Review A: so is one that did not resolve an open service card of an alteration.
  if(alteration.answer?.unanswered&&c.candidates?.kind==="service_changes_ref")c.message=`${unansweredServiceCard}
${c.message}`;
  // UX (flag): the answer re-created the very half-day question it answered ("às 2" again): said, never repeated silently.
  const again=askedClock&&grounded.pending_temporal_ambiguities.find(item=>item.field===askedClock.field&&item.candidates.join()===askedClock.candidates.join());
  if(again&&c.waiting_for===again.field&&c.message===temporalAmbiguityQuestion(again,operation)){c.message=`${daypartChoiceRetry}\n${c.message}`;codes.push("DAYPART_CHOICE_REPEATED");}
  return [...divergence,...codes];
}
/** A3: the ref-derived origin roles with the values they hold now. Only the fill is behind SALON_SECRETARY_EXCEPTION_RULES_V2;
 * the provenance (recorded only while it was on) is honoured whatever the flag says now (review B: a rollback mid-conversation
 * never brings back a narrowing on a day the owner did not say). Clearing only removes values: fail-safe with the flag off. */
function originFromRef(c:SchedulingState):Partial<Record<OriginRole,string>>|undefined{
  if(!c.origin_from_ref?.length)return;
  return Object.fromEntries(c.origin_from_ref.flatMap(role=>c.fields[role]!==undefined?[[role,c.fields[role]!] as [OriginRole,string]]:[]));
}
/** A3: origin roles filled from a chosen appointment never outlive its ref. Once the ref is gone (a correction, a new
 * customer, an unproven service, a rejected coordinate), a role still holding the row's value goes too (an echo of it is
 * never the owner's proof; a changed value is the owner's, proven like any answer), so the locator asks again instead of
 * narrowing — and possibly auto-selecting — on a day or clock the owner never said. The roles removed are handed to the next
 * journal write (`forget_origin`), which never resurrects them from the previous revision. */
function forgetOriginFromRef(c:SchedulingState,fields:SchedulingFields,derived:Partial<Record<OriginRole,string>>|undefined){
  if(!derived||fields.appointment_ref)return;
  const forgotten:OriginRole[]=[];
  for(const [role,value]of Object.entries(derived) as [OriginRole,string][])if(fields[role]===value){delete fields[role];forgotten.push(role);}
  if(forgotten.length)c.origin_forgotten=forgotten;
  delete c.origin_from_ref;
}
/** The prepared clone replaces the state: a key the turn removed (a spent locator hint, a cleared exclusion or half-day mark) is
 * removed from the state too (Object.assign alone would keep the stale value). */
function commitScheduling(current:SchedulingState,next:SchedulingState){
  Object.assign(current,next);
  for(const key of Object.keys(current))if(!Object.hasOwn(next,key))delete (current as Record<string,unknown>)[key];
}
function publishCommittedSchedulingDraft(current:SchedulingState,next:SchedulingState){
  if(next.draft&&(!current.draft||next.draft.draft_ref!==current.draft.draft_ref||next.draft.draft_revision>current.draft.draft_revision)){
    next.fields={...next.draft.fields};next.pending_temporal_ambiguities=next.draft.pending_temporal_ambiguities??[];
    next.pending_calendar_conflicts=next.draft.pending_calendar_conflicts??[];next.source_missing=next.draft.source_missing??[];
    next.proposal=undefined;next.appointments=undefined;next.alternatives=undefined;
    next.message="Os dados estão preservados. Não consegui concluir a preparação. Tente novamente.";
    Object.assign(current,next);
  }
}
/** The committed draft stays authoritative even if a later proposal/read fails.
 * Returns codes-only divergence (scope coverage) for turn telemetry. */
export async function applySchedulingInterpretation(actor:ServiceActor,c:SchedulingState,result:SchedulingInterpretation&{temporal_negative_context?:unknown},sourceMessage?:string,options?:SchedulingGroundingOptions):Promise<string[]>{
  c.proposal=undefined;
  const next=structuredClone(c);
  try{const divergence=await applySchedulingInterpretationMutable(actor,next,result,sourceMessage,options);commitScheduling(c,next);return divergence;}
  catch(error){publishCommittedSchedulingDraft(c,next);throw error;}
}
/** C5: the backend re-derives this action's referenced fields (another action's accepted value became known, changed or
 * was retracted). `fields`: backend values to set (never Luna's; a person as ref + name); `references`: the new link state.
 * A new customer relocates a change/cancel. The proposal is withdrawn and the draft prepared again, with no model call;
 * the committed draft stays authoritative if preparation fails. */
export async function reseedScheduling(actor:ServiceActor,c:SchedulingState,fields:Partial<SchedulingFields>,references:SchedulingReferences){
  c.proposal=undefined;
  const next=structuredClone(c);next.references=references;
  const derived=originFromRef(next);
  if(fields.customer_ref!==undefined&&fields.customer_ref!==next.fields.customer_ref)delete next.fields.appointment_ref;
  Object.assign(next.fields,fields);
  // A key set to undefined is removed (a seeded service list replaces the single-service form, review B).
  for(const [key,value] of Object.entries(fields))if(value===undefined)delete next.fields[key as keyof SchedulingFields];
  forgetOriginFromRef(next,next.fields,derived);
  try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}
}
/** C5 agent (flag SALON_SECRETARY_AGENT; docs/c5-spike/11-especificacao-agente.md §6.2), the sibling of reseedScheduling for an action of a plan
 * the backend validated (secretary-agent-apply.ts). `fields`: the validator's values (refs it proved, the owner's own words where a ref could not
 * stand, accepted temporal values); an appointment_ref is never taken: the C4 locate runs as for any change or cancellation. prepare() then does
 * everything it does for the C4 (locate, availability, HARD_BLOCK, duration, price, overlaps, block and combo guards, recurrence, draft and
 * proposal). `extras`: the half-day readings still open (asked, their role left empty), the provenance kept for the Confirmar (agent_basis),
 * display names, a stated recurrence (its "só a primeira?" card), the card of real appointments of the V7-A locate (references.card, rechecked
 * on click), `expected` (the appointment the validator accepted: prepare()'s own pick must be it, else nothing is proposed), and, when the
 * validator asks, its card of backend rows (a professional/new-professional choice, rechecked on click) or its question: then the draft is
 * written but nothing is proposed, and prepare()'s own question follows the validator's. `missing` (round 2, F0): a change's new day or clock
 * the owner wrote that no field carries, asked as a rejected temporal role (the draft's temporal_missing), never the appointment's own. */
/** `pilotAppointment` (pilot of the reschedule, flag SALON_SECRETARY_PILOT_RESCHEDULE; docs/c5-spike/12-piloto-remarcacao.md §5): the appointment
 * the pilot's resolver located once; with the flag on and the same ref in `fields`, the change keeps it as its appointment_ref and prepare() never
 * locates again. Absent (or the flag off): exactly as before. */
export type AgentResolvedExtras={ambiguities?:readonly PendingTemporalAmbiguity[];basis?:readonly AgentBasis[];names?:Readonly<Record<string,string>>;recurrence?:string|null;
  appointmentCard?:readonly {id:string;name:string}[];references?:SchedulingReferences;expected?:string;
  card?:{kind:"professional_ref"|"target_professional_ref";items:readonly {id:string;name:string}[];question:string};question?:string;missing?:readonly ("date"|"time")[];
  pilotAppointment?:string};
export async function prepareResolvedScheduling(actor:ServiceActor,c:SchedulingState,operation:NonNullable<SchedulingState["operation"]>,fields:SchedulingFields,extras:AgentResolvedExtras={}){
  if(c.operation&&c.operation!==operation)throw Error("OPERATION_MISMATCH");
  c.proposal=undefined;
  const next=structuredClone(c);
  next.operation=operation;next.interpretation_source="MODEL";
  const resolved=schedulingResolved.parse(structuredClone(fields));
  const keep=pilotRescheduleEnabled()&&operation==="appointment.change"&&!!extras.pilotAppointment&&resolved.appointment_ref===extras.pilotAppointment;
  if(!keep)delete resolved.appointment_ref;
  for(const item of extras.ambiguities??[])delete resolved[item.field];
  next.fields=resolved;
  if(extras.ambiguities?.length)next.pending_temporal_ambiguities=extras.ambiguities.map(item=>structuredClone(item));
  if(extras.basis?.length)next.agent_basis=structuredClone([...extras.basis]);else delete next.agent_basis;
  if(extras.names&&Object.keys(extras.names).length)next.resolved_names={...next.resolved_names,...extras.names};
  if(extras.recurrence)next.recurrence={expression:extras.recurrence.slice(0,120),status:"ASKED"};
  const references:SchedulingReferences={...structuredClone(extras.references??{}),...(extras.appointmentCard?.length?{card:{kind:"appointment_ref" as const,items:extras.appointmentCard.map(item=>({...item}))}}:{})};
  // A link state, even empty, lets the plan's syncReferences follow a released origin (the C4's D1 link) after this preparation.
  if(extras.references||extras.appointmentCard?.length)next.references=references;
  const hold=!!(extras.card||extras.question);
  if(hold)next.proposal_deferred=true;
  const missing=(extras.missing??[]).map(field=>({code:"SOURCE_TEMPORAL_CONFLICT" as const,field,value:"MISSING"}));
  try{await prepare(actor,next,missing);}catch(error){delete next.proposal_deferred;publishCommittedSchedulingDraft(c,next);throw error;}
  delete next.proposal_deferred;
  // V7-A: the C4 locate picked another appointment than the one validated (the agenda changed in between): nothing is proposed.
  if(extras.expected&&next.fields.appointment_ref&&next.fields.appointment_ref!==extras.expected){next.proposal=undefined;publishCommittedSchedulingDraft(c,next);throw Error("AGENT_APPT_LOCATE");}
  if(hold){
    next.proposal=undefined;
    const own=next.candidates||next.waiting_for?next.message:undefined;
    if(extras.card&&(!next.candidates||next.candidates.kind===extras.card.kind)){
      next.candidates={kind:extras.card.kind,items:extras.card.items.map(item=>({...item}))};next.waiting_for=extras.card.kind;next.message=extras.card.question;
    }
    else{const asked=extras.question??extras.card?.question;next.message=own&&own!==asked?`${asked}\n${own}`:asked??next.message;}
  }
  commitScheduling(c,next);
}
/** C5 agent (§6.2 hook, flag SALON_SECRETARY_AGENT): per derived basis of this action, the fields it fills, the owner's own fields that replace
 * it and the fields it stood on. The owner's own new value ends that basis (the value is the owner's now); a change of what it stood on drops the
 * derived values the continuation did not bring (forgotten by the next journal write) with the basis, so prepare() asks them
 * (AGENT_BASIS_PATCHED). A link to another action of the plan (sequence, between, released) ends with an owner's own day or clock. */
function agentBasisPatched(c:SchedulingState,fields:SchedulingFields,patch:Partial<SchedulingFields>):string[]{
  const before=c.fields,said=(keys:readonly (keyof SchedulingFields)[])=>keys.some(key=>patch[key]!==undefined&&JSON.stringify(patch[key])!==JSON.stringify(before[key]));
  const kept:AgentBasis[]=[],forgotten=new Set<SchedulingForgetField>(c.agent_forgotten??[]),codes:string[]=[];
  for(const item of c.agent_basis??[]){
    const shape=agentBasisShape(item);
    if(said(shape.own)){codes.push("AGENT_BASIS_OWNER");continue;}
    if(!said(shape.stands)){kept.push(item);continue;}
    for(const key of shape.derived)if(patch[key]===undefined){delete fields[key];forgotten.add(key);}
    codes.push("AGENT_BASIS_PATCHED");
  }
  if(kept.length)c.agent_basis=kept;else delete c.agent_basis;
  if(forgotten.size)c.agent_forgotten=[...forgotten];
  return codes;
}
function agentBasisShape(item:AgentBasis):{derived:SchedulingForgetField[];own:(keyof SchedulingFields)[];stands:(keyof SchedulingFields)[]}{
  switch(item.type){
    case "DELEGADO":return item.field==="novo_profissional"?{derived:["target_professional_ref","target_professional_name"],own:["target_professional_name"],stands:["date","time","service_changes"]}
      :{derived:["professional_ref","professional_name"],own:["professional_name"],stands:["date","time","service_name","service_names"]};
    case "ANCORA":return {derived:["time"],own:["time"],stands:["date","professional_name"]};
    case "MANTIDO":return {derived:["time"],own:["time"],stands:["date"]};
    case "EXCECAO":return {derived:["time","end_time","end_date"],own:["time","end_time"],stands:["date","professional_name"]};
    case "FIM_EXPEDIENTE":return {derived:["end_time","end_date"],own:["end_time"],stands:["date","time","professional_name"]};
    default:return {derived:["date","time"],own:["date","time"],stands:[]};
  }
}
/** C5 agent (V23 at the Confirmar, flag SALON_SECRETARY_AGENT): what a derived value stood on changed, so every derived value of this action
 * leaves with its basis (forgotten by the next journal write; prepare() asks it again). The caller withdraws the proposal (holdForReview). */
export function forgetAgentBasis(c:SchedulingState):string[]{
  if(!c.agent_basis?.length)return [];
  const forgotten=new Set<SchedulingForgetField>(c.agent_forgotten??[]);
  for(const item of c.agent_basis)for(const key of agentBasisShape(item).derived){delete c.fields[key];forgotten.add(key);}
  delete c.agent_basis;c.agent_forgotten=[...forgotten];
  return ["AGENT_BASIS_CHANGED"];
}
export async function sendSchedulingTurn(actor:ServiceActor,c:SchedulingState,model:Model,message:string,assertLive:()=>unknown){
  c.proposal=undefined;c.metrics={};c.interpretation_source="MODEL";
  const context=clarificationContext({...c,...(c.candidates?{waiting_for:c.candidates.kind,selection:{field:c.candidates.kind,labels:c.candidates.items.map(row=>row.name)}}:{}),pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities,pending_calendar_conflicts:c.pending_calendar_conflicts??c.draft?.pending_calendar_conflicts,missing_fields:c.draft?.missing_fields});
  return withTemporalTurnDrafts(c.draft?[{...c.draft,scope_valid:JSON.stringify(c.draft.fields)===JSON.stringify(c.fields)}]:[],async()=>{
    const result=await timed(c.metrics,"interpretation",()=>runServicesTurn(model,message,context,getOperationRequirements(c.operation??"appointment.create"),"scheduling"));
    // C4 (flag SALON_SECRETARY_DATE_RULES_V2): a scheduling session is one action; its message is its own text.
    assertLive();await applySchedulingInterpretation(actor,c,result,message,{single:true});
  });
}
/** `origin.clicked` (D1): the owner's own click (never a model's choice), the only selection an alias is learned from. */
export async function selectScheduling(actor:ServiceActor,c:SchedulingState,ref:string,origin:{clicked?:boolean}={}){
  const selection=c.candidates;if(!selection?.items.some(r=>r.id===ref))throw Error("SELECTION_INVALID");
  c.proposal=undefined;
  const next=structuredClone(c);next.proposal=undefined;
  // P3c (flag): the recurrence card's one option, only while the action still owes that yes (the flag is read again): the first
  // occurrence goes on to the ordinary preparation (availability again, proposal, Confirmar). Nothing else is chosen here.
  if(selection.kind===RECURRENCE_CARD){
    if(ref!==FIRST_ONLY_REF||!recurrencePending(c.recurrence,c.operation))throw Error("SELECTION_INVALID");
    next.recurrence={...c.recurrence!,status:"FIRST_ONLY"};
    try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}return;
  }
  // C5 (flag): the block-over-appointments card: rechecked against the block's fresh snapshot, then the ordinary preparation.
  if(selection.kind===BLOCK_OVERLAP_CARD){
    if(!blockOverlapGuardEnabled()||c.operation!=="schedule.block")throw Error("SELECTION_INVALID");
    await blockOverlapSelection(actor,next,ref);
    try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}return;
  }
  // V2: a card a reference published (a read's rows; the referenced appointment's services) is rechecked against that card and
  // the fresh tenant row (a foreign or vanished id is APPOINTMENT_NOT_FOUND; an inactive service is not offered again).
  const card=referencesV2Enabled()?c.references?.card:undefined;
  if(card&&card.kind===selection.kind&&card.items.some(item=>item.id===ref)){
    if(card.kind==="appointment_ref"){
      const row=await withTenant(actor,tx=>getSchedulingAppointment(tx,actor,ref));
      next.fields.appointment_ref=ref;next.fields.customer_ref=row.customer_ref;next.resolved_names={...next.resolved_names,[row.customer_ref]:row.customer_name};
    }else{
      const item=card.items.find(entry=>entry.id===ref)!;
      if(!(await withTenant(actor,tx=>listSchedulingServices(tx,actor,item.name))).some(row=>row.id===ref))throw Error("SELECTION_INVALID");
      next.fields.service_ref=ref;next.fields.service_name=item.name;
    }
    delete next.references!.card;
    try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}return;
  }
  if(selection.kind==="appointment_ref"){
    if(isSchedulingMutation(c.operation??"")){
      // Review A (P2a): the card of both readings of a possibly swapped change is rechecked by both readings (same customer and
      // origin, either professional named), and the pick orients the roles: the chosen appointment's professional is the one it
      // leaves, the other one named attends. Only while the pair is still the change's own (else the ordinary recheck).
      const swap=c.alter_swap&&alterAppointmentEnabled()&&c.operation==="appointment.change"&&c.fields.professional_ref===c.alter_swap.professional.ref&&c.fields.target_professional_ref===c.alter_swap.target.ref?c.alter_swap:undefined;
      const rows=await withTenant(actor,tx=>swap?Promise.all([swap.professional.ref,swap.target.ref].map(professional_ref=>locateSchedulingAppointments(tx,actor,{...c.fields,professional_ref},c.operation!))).then(found=>found.flat())
        :locateSchedulingAppointments(tx,actor,c.fields,c.operation!));
      const row=rows.find(r=>r.appointment_ref===ref);
      if(!row)throw Error("SELECTION_INVALID");
      if(swap&&row.professional_ref===swap.target.ref){
        next.fields.professional_ref=swap.target.ref;next.fields.target_professional_ref=swap.professional.ref;
        if(swap.target.name!==undefined)next.fields.professional_name=swap.target.name;else delete next.fields.professional_name;
        if(swap.professional.name!==undefined)next.fields.target_professional_name=swap.professional.name;else delete next.fields.target_professional_name;
        if(next.selected_names){delete next.selected_names.professional_name;delete next.selected_names.target_professional_name;}
      }
      next.fields.appointment_ref=ref;if(alterAppointmentEnabled())next.appointment_chosen=ref;
      // A3 (flag): the chosen appointment IS the origin: its own coordinates, from this fresh tenant-scoped row (never Luna's
      // echo), fill the origin roles the owner left open (provenance kept); one the owner said that disagrees asks again.
      if(exceptionRulesV2Enabled()&&(c.operation==="appointment.change"||c.operation==="appointment.cancel")){
        const {day,clock}=appointmentEchoRoles(c.operation),own:[OriginRole,string][]=[[day,row.start_local.slice(0,10)],[clock,row.start_local.slice(11,16)]],filled:OriginRole[]=[];
        for(const [role,value]of own){
          if(next.fields[role]!==undefined&&next.fields[role]!==value)throw Error("SELECTION_INVALID");
          if(next.fields[role]===undefined){next.fields[role]=value;filled.push(role);}
        }
        if(filled.length){next.origin_from_ref=filled;
          next.pending_temporal_ambiguities=(next.pending_temporal_ambiguities??next.draft?.pending_temporal_ambiguities)?.filter(item=>!(filled as string[]).includes(item.field));
          next.pending_calendar_conflicts=(next.pending_calendar_conflicts??next.draft?.pending_calendar_conflicts)?.filter(item=>!(filled as string[]).includes(item.field));}
        else delete next.origin_from_ref;
      }
      try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}return;
    }
    const row=await withTenant(actor,tx=>getSchedulingAppointment(tx,actor,ref));c.appointments=[row];c.candidates=undefined;c.message=`${row.customer_name} — ${formatLocal(row.start_local)} — ${row.professional_name} — ${statusLabels[row.status]??row.status}`;return;
  }
  // P2a: an alteration card (the NEW professional, or a service of the delta) has its own recheck; prepare checks it again.
  if(selection.kind==="target_professional_ref"||selection.kind==="service_changes_ref"){
    await selectAlteration(actor,selection,next,ref);
    try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}return;
  }
  // P2b: a service-list card (a service of the list, or a combo vs the services apart) has its own recheck; prepare checks again.
  if(selection.kind==="service_list_ref"||selection.kind==="service_combo_ref"){
    await selectServiceList(actor,selection,next,ref);
    try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}return;
  }
  // A C3 card is rechecked by the same function that published it (same query, fresh tenant rows).
  const createOrAvailability=c.operation==="appointment.create"||c.operation==="availability.get";
  // P2b: the professional card of a service list was published for every service of it (the same scope is rechecked).
  const listRefs=createOrAvailability&&c.fields.service_names?schedulingServiceRefs(c.fields):undefined,scope=listRefs?{service_refs:listRefs}:{service_ref:c.fields.service_ref};
  const professional=c.fields.professional_name?{...(listRefs?scope:createOrAvailability&&c.fields.service_ref?{service_ref:c.fields.service_ref}:{}),query:c.fields.professional_name}:undefined;
  const typed=selection.kind==="customer_ref"?c.fields.customer_name:selection.kind==="service_ref"?c.fields.service_name:c.fields.professional_name;
  if(selection.source==="alias"){
    const ref_=selection.kind as AliasRef,kind=aliasKindOf(ref_),proposed=selection.items[0].id;
    // D1 "não é essa pessoa": the alias is deleted when the owner may (OWNER/MANAGER; only by a click) and, either way,
    // not proposed again in this action: the ordinary card (homonyms or suggestions) follows.
    if(ref===ALIAS_REJECT_REF){
      if(origin.clicked)await forgetAlias(actor,kind,typed,proposed);
      const key=aliasKey(typed);if(key)next.alias_declined=[...(next.alias_declined??[]),{kind:ref_,key}];
      try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}return;
    }
    // Only the owner's click confirms a proposal: the typed name may match several entities the card does not list, so no
    // model choice (whatever literal it quotes) and no typed "sim" ever settles it.
    if(!origin.clicked)throw Error("SELECTION_INVALID");
    // The confirmation is rechecked by the same rule that proposed it: same exact search, same alias, entity still active.
    const searched:{id:string}[]=await withTenant(actor,tx=>selection.kind==="customer_ref"?searchSalonCustomer(tx,actor,c.fields.customer_name!):selection.kind==="service_ref"?listSchedulingServices(tx,actor,c.fields.service_name!):
      listSchedulingProfessionals(tx,actor,professional!));
    const again=await proposeAlias(actor,kind,typed,searched.map(r=>r.id),createOrAvailability&&selection.kind==="professional_ref"?{service_ref:c.fields.service_ref}:{});
    if(again?.id!==ref)throw Error("SELECTION_INVALID");
    next.fields[selection.kind]=ref;
    const role=selection.kind==="customer_ref"?"customer_name":selection.kind==="professional_ref"?"professional_name":undefined;
    if(role&&next.unproven_names){const left=next.unproven_names.filter(item=>item!==role);next.unproven_names=left.length?left:undefined;}
    const named=selection.kind==="service_ref"?"service_name":role;
    if(named){next.selected_names={...next.selected_names};next.selected_names[named]=optionName(again.label);}
    try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}
    if(origin.clicked)await aliasUsed(actor,kind,typed,ref);
    return;
  }
  const current:{id:string}[]=await withTenant(actor,async tx=>selection.source==="suggest"
    ?suggestedRows<{id:string}>(selection.kind==="customer_ref"?await suggestSalonCustomers(tx,actor,c.fields.customer_name!):selection.kind==="service_ref"?await suggestSchedulingServices(tx,actor,c.fields.service_name!):await suggestSchedulingProfessionals(tx,actor,professional!))
    :selection.kind==="customer_ref"?searchSalonCustomer(tx,actor,c.fields.customer_name!):selection.kind==="service_ref"?listSchedulingServices(tx,actor,c.fields.service_name!):
      listSchedulingProfessionals(tx,actor,selection.source==="confirm"&&professional?professional:scope));
  if(!current.some(r=>r.id===ref))throw Error("SELECTION_INVALID");
  next.fields[selection.kind]=ref;
  // The owner's click is the evidence the model's name lacked.
  const role=selection.kind==="customer_ref"?"customer_name":selection.kind==="professional_ref"?"professional_name":undefined;
  if(role&&next.unproven_names){const left=next.unproven_names.filter(item=>item!==role);next.unproven_names=left.length?left:undefined;}
  // B4: a later echo of the chosen option's own name is not a new person/service (see the ref invalidation).
  const chosen=selection.items.find(item=>item.id===ref)!,named=selection.kind==="service_ref"?"service_name":role;
  if(named){next.selected_names={...next.selected_names};next.selected_names[named]=optionName(chosen.name);}
  try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}
  // D1: the owner's click on a card published for the typed name teaches the salon that name (best-effort, never fails).
  if(origin.clicked&&selection.alias_basis&&(selection.source===undefined||selection.source==="suggest"))
    await learnAlias(actor,aliasKindOf(selection.kind as AliasRef),typed,ref,selection.alias_basis);
}

const EXCEPTION_TTL_MS=15*60_000;
/** 05/10 (flag SALON_SECRETARY_SCHEDULE_EXCEPTIONS): a new booking whose review asks about a schedule exception remembers that
 * question (its slot hash and causes); anything else forgets it. */
function rememberCreateException(c:SchedulingState,review:SchedulingReview|undefined){
  if(review?.status==="CONFLICT_OVERRIDABLE"&&review.override_allowed&&hasScheduleCause(review.causes)&&review.missing_fields[0]==="override_requested")
    c.exception_pending={operation:"appointment.create",hash:exceptionHash(review),causes:review.causes,expires_at:new Date(Date.now()+EXCEPTION_TTL_MS).toISOString()};
  else delete c.exception_pending;
}
type MoveException={causes:string[];hard:string[];allowed:boolean;endLocal:string;conflicts:{startLocal:string}[];hash:string};
/** 05/10: the question of a reschedule the professional's schedule refuses but this role may keep anyway. Returns undefined when
 * there is nothing to ask (no exception, not allowed: the old refusal text stays; or a live consent for this very slot). A consent
 * given for another slot or other causes is dropped and the question is asked again. */
function exceptionAsk(c:SchedulingState,f:SchedulingFields,move:{exception?:MoveException;alternatives:{startLocal:string}[]},who:string|undefined){
  const e=move.exception;
  if(!e||!e.allowed){if(e)delete c.exception_pending;return undefined;}
  const pending=c.exception_pending,live=pending?.operation==="appointment.change"&&pending.hash===e.hash&&Date.parse(pending.expires_at)>Date.now();
  if(f.override_requested===true&&live)return undefined;
  delete f.override_requested;delete f.override_reason;
  c.alternatives=move.alternatives as SchedulingState["alternatives"];c.waiting_for="schedule_exception";
  c.exception_pending={operation:"appointment.change",hash:e.hash,causes:e.causes,expires_at:new Date(Date.now()+EXCEPTION_TTL_MS).toISOString()};
  return exceptionQuestion("appointment.change",e.causes,who,e.endLocal,e.conflicts.map(x=>x.startLocal),move.alternatives.map(a=>a.startLocal));
}

/** 05/10: the owner's "mesmo assim" (a click on the window's option, or the deterministic reading of the reply) applied with no
 * model call: the consent (and the owner's literal reason, when given) and a fresh preparation, which re-inspects the slot and
 * still ends in a proposal that needs Confirmar. Anything stale is OPTION_UNAVAILABLE. */
export async function applyScheduleExceptionConsent(actor:ServiceActor,c:SchedulingState,decision:{reason?:string}={}){
  if(!scheduleExceptionPending(c))throw Error("OPTION_UNAVAILABLE");
  c.proposal=undefined;
  const next=structuredClone(c);
  next.fields.override_requested=true;delete next.fields.destination_mode;
  if(decision.reason)next.fields.override_reason=decision.reason;else delete next.fields.override_reason;
  delete next.fields.override_reason_source;next.interpretation_source="DETERMINISTIC_FAST_PATH";
  try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}
}
/** 06/10 (flag SALON_SECRETARY_CANCEL_REASON_OPTIONAL): an open cancellation (ready for Confirmar) and the owner explaining the cause.
 * The whole sentence is the reason, proven literal like any other; a fresh preparation, no model call, still ends in Confirmar. */
export const cancelReasonOpen=(c:SchedulingState|undefined)=>c?.operation==="appointment.cancel"&&!!c.proposal;
export async function applyCancelReason(actor:ServiceActor,c:SchedulingState,message:string){
  if(!cancelReasonOpen(c))return false;
  const patch:Record<string,unknown>={reason:message.trim()};
  if(!groundSchedulingReasons(patch,c.fields as Record<string,unknown>,message).accepted.includes("reason"))return false;
  c.proposal=undefined;
  const next=structuredClone(c);
  next.fields.reason=patch.reason as string;(next.fields as Record<string,unknown>).reason_source=patch.reason_source;next.interpretation_source="DETERMINISTIC_FAST_PATH";
  try{await prepare(actor,next);commitScheduling(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}
  return true;
}
/** 05/10: "não" to the exception question: nothing is prepared; the free times are offered again. */
export function refuseScheduleException(c:SchedulingState){
  if(!scheduleExceptionPending(c))return undefined;
  delete c.exception_pending;delete c.fields.override_requested;delete c.fields.override_reason;c.proposal=undefined;
  const free=(c.alternatives??c.draft?.review?.alternatives??[]).map(slot=>clockLabel(slot.startLocal));
  c.waiting_for=free.length?"time":"date";
  c.message=`Tudo bem, nada foi alterado. ${free.length?`Tenho ${free.join(", ")}. Qual horário você prefere?`:"Qual outro dia ou horário você prefere?"}`;
  return c.message;
}

/** Owner 05/10: the one reading of an ambiguous clock that falls inside the salon's working hours that day (any active
 * professional working then; TimeOff ignored), or undefined when none or both do. Read-only. */
async function salonHoursReading(actor:ServiceActor,day:string,candidates:readonly string[],refused:ReadonlySet<string>,now:Date){
  const facts=await withTenant(actor,async tx=>{
    const ids=(await tx.professional.findMany({where:{salonId:actor.salonId,active:true},select:{id:true},take:200})).map(row=>row.id);
    return loadDayFacts(tx,actor.salonId,await schedulingTimezone(tx,actor),day,ids,now);
  }).catch(()=>undefined);
  if(!facts)return undefined;
  const open=openReadings(candidates.filter(time=>!refused.has(time)),"BLOCK_START",facts).open;
  return open.length===1?open[0]:undefined;
}
