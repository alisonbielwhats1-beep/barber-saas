import { firstTemporalAmbiguity, nextTemporalAmbiguities, temporalAmbiguityQuestion, type PendingTemporalAmbiguity } from "./scheduling-temporal-ambiguity";
import { firstCalendarConflict, nextCalendarConflicts, calendarConflictQuestion, type PendingCalendarConflict } from "./scheduling-calendar-conflict";
import { groundSchedulingReasons, pendingSourceFields, type ReasonField, type ReasonRejection } from "./scheduling-literal-source";
import { performance } from "node:perf_hooks";
import { assertSchedulingExceptionScope, type SchedulingReview } from "./scheduling-conflict-contract";
import { validateSchedulingEntityMentions } from "./scheduling-entity-mentions";
import { runServicesTurn, type Model, type SchedulingInterpretation } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { searchSalonCustomer } from "./customer-catalog";
import { getOperationRequirements } from "./service-contract";
import { schedulingPatch, type SchedulingFields } from "./scheduling-contract";
import { groundSchedulingTemporal } from "./scheduling-temporal-source";
import { schedulingNegativeContext, withTemporalTurnDrafts } from './secretary-temporal-turn';
import { clarificationContext } from "./secretary-clarification";
import { secretaryFastPath } from "./secretary-fast-path";
import { getSchedulingAppointment, getSchedulingAvailability, listSchedulingAppointments, listSchedulingProfessionals, listSchedulingServices, schedulingTimezone, timed, type SchedulingMetrics } from "./scheduling-catalog";
import { upsertSchedulingDraft, proposeAppointmentCreate, proposeSchedulingAction, schedulingSnapshot, confirmAppointmentCreate } from "./scheduling-actions";
import { authorizeSchedulingOperation, isSchedulingMutation, locateSchedulingAppointments, inspectSchedulingMove, schedulingActionSnapshot } from "./scheduling-mutations";
import { applyTemporalRejections, reconcileSchedulingTemporal, schedulingTemporalConflicts, matchesSchedulingPeriod, type TemporalRejection } from "./scheduling-temporal";

export type SchedulingState={proposal_deferred?:boolean;operation?: NonNullable<SchedulingInterpretation["operation"]>; fields:SchedulingFields; message:string;
  draft?:Awaited<ReturnType<typeof upsertSchedulingDraft>>;proposal?:Awaited<ReturnType<typeof proposeAppointmentCreate>>;receipt?:Awaited<ReturnType<typeof confirmAppointmentCreate>>;
  candidates?:{kind:"customer_ref"|"service_ref"|"professional_ref"|"appointment_ref";items:{id:string;name:string}[]};
  alternatives?:Awaited<ReturnType<typeof getSchedulingAvailability>>["alternatives"];appointments?:Awaited<ReturnType<typeof listSchedulingAppointments>>;
  pending_temporal_ambiguities?:PendingTemporalAmbiguity[];pending_calendar_conflicts?:PendingCalendarConflict[];source_missing?:ReasonField[];waiting_for?:string;interpretation_source?:"MODEL"|"DETERMINISTIC_FAST_PATH";metrics:SchedulingMetrics};
const dayLabel=(date:string)=>`${date.slice(8,10)}/${date.slice(5,7)}`;
const clockLabel=(local:string)=>local.slice(11,16).replace(":00","h").replace(":","h");
const unavailableCause=(violation:string)=>violation==="SLOT_TAKEN"?": já existe outro atendimento":violation==="SALON_CLOSED"?": o salão está fechado":
  ["OUTSIDE_WORKING_HOURS","AFTER_WORKING_HOURS","WORKING_HOURS_BREAK"].includes(violation)?": fica fora do expediente do profissional":violation==="PROFESSIONAL_UNAVAILABLE"?": o profissional está indisponível":"";
export const schedulingState=():SchedulingState=>({fields:{},message:"Informe o cliente, serviço e data/horário desejados.",metrics:{}});
/** Reuse the exact-clock parser only for a backend-requested original time. */
export function schedulingSourceTimeReply(waitingFor:string|undefined,message:string) {
  if(waitingFor!=="source_time")return;
  const parsed=secretaryFastPath("time",message);
  if(parsed&&"time" in parsed)return {source_time:parsed.time};
}
export async function persistSchedulingMetrics(actor:ServiceActor,sessionId:string,c:SchedulingState){
  await withTenant(actor,tx=>tx.auditLog.create({data:{salonId:actor.salonId,userId:actor.userId,actorName:"Secretária — latência",entityType:"SECRETARY_LATENCY",entityId:sessionId,action:"SCHEDULING_TIMINGS",metadata:{session_id:sessionId,operation:c.operation??null,interpretation_source:c.interpretation_source??"MODEL",...(c.interpretation_source==="DETERMINISTIC_FAST_PATH"?{model_avoided:true,model_requests:0,model_cost:0}:{}),durations_ms:c.metrics}}}));
}
async function prepare(actor:ServiceActor,c:SchedulingState,rejectedTemporal:TemporalRejection[]=[],rejectedSource:ReasonRejection[]=[]){
  const f=c.fields,op=c.operation!;c.candidates=undefined;c.alternatives=undefined;c.appointments=undefined;c.proposal=undefined;c.waiting_for=undefined;
  assertSchedulingExceptionScope(f,op);
  await withTenant(actor,tx=>authorizeSchedulingOperation(tx,actor,op));
  const sourceMissing=c.source_missing??c.draft?.source_missing??[];
  const calendarConflicts=c.pending_calendar_conflicts??c.draft?.pending_calendar_conflicts??[];
  if(sourceMissing.length){
    c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[],source_missing:sourceMissing,rejected_source:rejectedSource,rejected_temporal:rejectedTemporal,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
    c.fields=c.draft.fields;c.source_missing=sourceMissing;
    if(sourceMissing.length===1)c.waiting_for=sourceMissing[0];
    c.message=sourceMissing.includes("reason")?"Qual é o motivo do cancelamento? Vou registrar suas palavras.":"Qual é o motivo do encaixe? Vou registrar suas palavras.";
    return;
  }
  const calendar=firstCalendarConflict(calendarConflicts);
  if(calendar){
    c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[],source_missing:sourceMissing,rejected_temporal:rejectedTemporal,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
    c.fields=c.draft.fields;c.pending_calendar_conflicts=c.draft.pending_calendar_conflicts??[];
    c.waiting_for=calendar.field;c.message=calendarConflictQuestion(calendar);return;
  }
  const pending=firstTemporalAmbiguity(c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities);
  if(pending){
    c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities,source_missing:sourceMissing,rejected_temporal:rejectedTemporal,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
    c.fields=c.draft.fields;c.pending_temporal_ambiguities=c.draft.pending_temporal_ambiguities??[];
    c.waiting_for=pending.field;c.message=temporalAmbiguityQuestion(pending);return;
  }
  const conflicts=schedulingTemporalConflicts(f);
  const rejectedMissing=rejectedTemporal.filter(r=>r.field!=="period"&&!f[r.field]);
  const unresolvedTemporal=(c.draft?.temporal_missing??[]).filter(field=>!f[field]);
  if(conflicts.length||rejectedMissing.length||unresolvedTemporal.length){
    c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[],source_missing:sourceMissing,rejected_temporal:rejectedTemporal,...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
    c.fields=c.draft.fields;
    const pending=[...new Set([...conflicts.map(x=>x.field),...rejectedMissing.map(x=>x.field),...unresolvedTemporal])];if(pending.length===1)c.waiting_for=pending[0];
    const labels:Record<string,string>={date:"data de destino",time:"horário de destino",source_date:"data original",source_time:"horário original",end_date:"data final",end_time:"horário final"};
    const issues=[...conflicts,...rejectedMissing];
    const notice=issues.some(issue=>issue.code==="SOURCE_TEMPORAL_CONFLICT")?"A interpretação de data ou horário divergiu do que você informou e foi retirada. ":issues.some(issue=>issue.code==="TIME_OUTSIDE_PERIOD")?"O horário anterior é incompatível com o período informado e foi retirado. ":issues.some(issue=>issue.code==="END_NOT_AFTER_START")?"O final incompatível foi retirado. ":"";
    c.message=`${notice}Preciso confirmar ${pending.map(field=>labels[field]??"a informação temporal").join(" e ")}. Pode informar?`;
    return;
  }
  let notice:string|undefined;
  const createOrAvailability=op==="appointment.create"||op==="availability.get";
  // Independent reads use separate tenant transactions. Final domain checks still share the confirmation transaction.
  const [customers,services]=await Promise.all([
    f.customer_name&&!f.customer_ref?timed(c.metrics,"customers",()=>withTenant(actor,tx=>searchSalonCustomer(tx,actor,f.customer_name!))):undefined,
    f.service_name&&!f.service_ref?timed(c.metrics,"services",()=>withTenant(actor,tx=>listSchedulingServices(tx,actor,f.service_name!))):undefined,
  ]);
  for(const [kind,rows,label]of [["customer_ref",customers,"cliente"],["service_ref",services,"serviço"]] as const){
    if(!rows)continue;
    if(rows.length===1)f[kind]=rows[0].id;
    else if(!notice){notice=!rows.length?`Não encontrei esse ${label} neste salão.`:rows.length>20?`Muitas opções de ${label}; informe um nome mais específico.`:`Qual ${label}? Selecione uma opção real.`;
      if(rows.length>1&&rows.length<=20)c.candidates={kind,items:rows.map(r=>({id:r.id,name:`${r.name}${"phone" in r&&r.phone?` · ${r.phone}`:""}`}))};}
  }
  if(createOrAvailability&&f.service_ref&&!f.professional_ref&&!notice){
    const all=await timed(c.metrics,"professional",()=>withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,{service_ref:f.service_ref})));
    const named=f.professional_name?await withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,{service_ref:f.service_ref,query:f.professional_name})):all;
    if(named.length===1)f.professional_ref=named[0].id;
    else {notice=f.professional_name&&!named.length?"O profissional informado não está elegível para esse serviço. Escolha um profissional elegível.":!all.length?"Nenhum profissional elegível para este serviço.":"Qual profissional? Escolha uma opção real.";
      const options=named.length?named:all;if(options.length<=20)c.candidates={kind:"professional_ref",items:options};}
  }
  if(!createOrAvailability&&f.professional_name&&!f.professional_ref&&!notice){
    const rows=await timed(c.metrics,"professional",()=>withTenant(actor,tx=>listSchedulingProfessionals(tx,actor,{query:f.professional_name})));
    if(rows.length===1)f.professional_ref=rows[0].id;
    else {notice=rows.length?"Qual profissional? Escolha uma opção real.":"Não encontrei esse profissional neste salão.";if(rows.length<=20)c.candidates={kind:"professional_ref",items:rows};}
  }
  if(["appointment.change","appointment.cancel"].includes(op)&&!notice&&!f.appointment_ref){
    if(!f.customer_ref&&!(op==="appointment.change"?f.source_date:f.date))notice="Informe o cliente ou a data original do agendamento.";
    else {
      const rows=await timed(c.metrics,"appointments",()=>withTenant(actor,tx=>locateSchedulingAppointments(tx,actor,f,op)));
      if(rows.length===1)f.appointment_ref=rows[0].appointment_ref;
      else {notice=rows.length?"Qual agendamento? Selecione uma opção real.":"Não encontrei agendamento futuro pendente ou confirmado para esses dados. Agendamentos que já começaram ou foram encerrados não podem ser alterados pela Secretária.";
        if(rows.length>20)notice="Muitos agendamentos. Informe a data e o horário original.";
        else if(rows.length>1)c.candidates={kind:"appointment_ref",items:rows.map(r=>({id:r.appointment_ref,name:`${r.customer_name} — ${r.start_local} — ${r.professional_name}`}))};}
    }
  }
  // "Passa para 11h" keeps the appointment's day. A new day without a time is
  // still a question: the destination clock is never assumed (Golden GF14).
  if(op==="appointment.change"&&f.appointment_ref&&!f.date&&f.time){
    const original=await withTenant(actor,tx=>getSchedulingAppointment(tx,actor,f.appointment_ref!));f.date=original.start_local.slice(0,10);
  }
  const required=getOperationRequirements(op).required_fields;
  const missing=[...new Set([...required,...(c.draft?.temporal_missing??[])])].filter(k=>!f[k as keyof SchedulingFields]);
  let snap:Awaited<ReturnType<typeof schedulingSnapshot>>|undefined;
  let review:SchedulingReview|undefined;
  let mutationSnap:Awaited<ReturnType<typeof schedulingActionSnapshot>>|undefined;
  if(!notice&&!missing.length&&isSchedulingMutation(op)){
    if(op==="appointment.change"){
      const move=await timed(c.metrics,"availability",()=>withTenant(actor,tx=>inspectSchedulingMove(tx,actor,f.appointment_ref!,f.date!,f.time!))).catch(error=>{
        // A past destination is a normal answer to correct, not a preparation failure.
        if(error instanceof Error&&error.message==="PAST_TIME")return undefined;throw error;});
      if(!move){notice="Esse horário já passou. O agendamento original continua como está. Qual novo horário você prefere?";c.waiting_for="time";}
      else if(move.result.violation){c.alternatives=move.alternatives;c.waiting_for="time";
        notice=`Esse horário está indisponível${unavailableCause(move.result.violation)}. O agendamento original continua como está. ${move.alternatives.length?`Tenho ${move.alternatives.map(a=>clockLabel(a.startLocal)).join(", ")}. Qual horário você prefere?`:"Não encontrei outra opção nesse dia. Qual outro dia ou horário você prefere?"}`;}
    }
    if(!notice)mutationSnap=await timed(c.metrics,"proposal",()=>withTenant(actor,tx=>schedulingActionSnapshot(tx,actor,op,f)));
  }
  if(!notice&&!missing.length&&createOrAvailability){
    const availability=await timed(c.metrics,"availability",()=>withTenant(actor,tx=>getSchedulingAvailability(tx,actor,{service_ref:f.service_ref,professional_ref:f.professional_ref,date:f.date,...(f.time?{time:f.time}:{}),...(f.period?{period:f.period}:{}),...(f.override_requested!==undefined?{override_requested:f.override_requested}:{}),...(f.override_reason?{override_reason:f.override_reason}:{})})));
    c.alternatives=availability.alternatives;
    review=availability.review;
    if(op==="appointment.create"&&!availability.plan){
      // Without the overlap review, a taken slot is still a question about another time.
      notice=review?.message??(availability.alternatives.length?`Esse horário está indisponível. Tenho ${availability.alternatives.map(a=>clockLabel(a.startLocal)).join(", ")}. Qual horário você prefere?`:"Esse horário está indisponível e não encontrei outra opção nesse dia. Qual outro dia ou horário você prefere?");
      c.waiting_for=review?.missing_fields[0]??(availability.alternatives.length?"time":"date");
    }
    else if(op==="appointment.create")snap=await timed(c.metrics,"availability",()=>withTenant(actor,tx=>schedulingSnapshot(tx,actor,f)));
    else{const slots=[...(availability.plan?[availability.plan.startLocal]:[]),...availability.alternatives.map(s=>s.startLocal)];
      notice=slots.length?`Horários livres${f.professional_name?` de ${f.professional_name}`:""} para ${f.service_name??"o serviço"} em ${dayLabel(f.date!)}: ${slots.map(clockLabel).join(", ")}. A consulta não reserva o horário.`:`Não encontrei horário livre${f.professional_name?` para ${f.professional_name}`:""} em ${dayLabel(f.date!)}${f.time||f.period?" nesse período":""}.`;}
  }
  c.draft=await withTenant(actor,tx=>upsertSchedulingDraft(tx,actor,{operation:op,fields:f,pending_calendar_conflicts:calendarConflicts,pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities??[],source_missing:sourceMissing,...(review?{review}:{}),rejected_temporal:rejectedTemporal,...(snap?{snapshot:snap}:{}),...(mutationSnap?{action_snapshot:mutationSnap}:{}),
    ...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
  c.fields=c.draft.fields;
  if(notice){c.message=notice;return;}
  if(missing.length){const labels:Record<string,string>={customer_ref:"cliente",service_ref:"serviço",professional_ref:"profissional",date:"data",source_date:"data original",source_time:"horário original",time:"horário exato",end_date:"data final",end_time:"horário final",appointment_ref:"agendamento original",reason:"motivo do cancelamento (mínimo 3 caracteres)"};
    // A professional is resolved from the service; do not ask before the service is known.
    const ask=missing.filter(k=>k!=="professional_ref"||!!f.service_ref||op==="schedule.block");
    if(ask.length===1)c.waiting_for=ask[0];
    c.message=`Informe ${ask.map(k=>labels[k]).join(" e ")}.`;return;}
  if(c.proposal_deferred){c.message="Dados da ação dependente validados; aguardando proposta conjunta.";return;}
  if(isSchedulingMutation(op)){
    c.proposal=await timed(c.metrics,"proposal",()=>withTenant(actor,tx=>proposeSchedulingAction(tx,actor,{draft_ref:c.draft!.draft_ref,draft_revision:c.draft!.draft_revision})));
    c.message=`${c.proposal.preview}\nUse Confirmar para executar.`;return;
  }
  if(op==="appointment.create"){
    c.proposal=await timed(c.metrics,"proposal",()=>withTenant(actor,tx=>proposeAppointmentCreate(tx,actor,{draft_ref:c.draft!.draft_ref,draft_revision:c.draft!.draft_revision})));
    c.message=`${c.proposal.preview}\nUse Confirmar para executar.`;return;
  }
  const rows=await withTenant(actor,tx=>listSchedulingAppointments(tx,actor,{date:f.date,...(f.customer_ref?{customer_ref:f.customer_ref}:{}),...(f.professional_ref?{professional_ref:f.professional_ref}:{}),...(f.service_ref?{service_ref:f.service_ref}:{})}));
  // Never turn a bounded, incomplete result into an apparently complete read.
  if(rows.length>50){c.message="Muitos agendamentos. Restrinja a busca por cliente.";return;}
  if(f.time||f.period)rows.splice(0,rows.length,...rows.filter(row=>(!f.time||row.start_local.slice(11,16)===f.time)&&matchesSchedulingPeriod(row.start_local.slice(11),f.period)));
  c.appointments=rows;
  if(op==="appointment.read"&&rows.length>1){c.candidates={kind:"appointment_ref",items:rows.map(r=>({id:r.appointment_ref,name:`${r.customer_name} — ${r.start_local} — ${r.professional_name}`}))};c.message="Qual agendamento deseja consultar?";return;}
  if(op==="appointment.read"&&rows.length===1)c.appointments=[await withTenant(actor,tx=>getSchedulingAppointment(tx,actor,rows[0].appointment_ref))];
  const statusLabels:Record<string,string>={CONFIRMED:"confirmado",PENDING:"pendente",PENDING_ACCEPTANCE:"aguardando aceite",CANCELLED:"cancelado",COMPLETED:"concluído",IN_PROGRESS:"em atendimento",NO_SHOW:"não compareceu"};
  c.message=!rows.length?`${f.professional_name?`${f.professional_name} não tem atendimentos`:f.customer_name?`Não encontrei atendimentos de ${f.customer_name}`:"Nenhum atendimento"} em ${dayLabel(f.date!)}.`:
    `${f.professional_name?`Agenda de ${f.professional_name}`:"Agenda"} em ${dayLabel(f.date!)}:\n`+c.appointments.map(r=>`${clockLabel(r.start_local)} — ${r.customer_name} (${r.services.map(s=>s.serviceName).join(", ")}) com ${r.professional_name}${r.status==="CONFIRMED"?"":` · ${statusLabels[r.status]??r.status}`}`).join("\n");
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
async function applySchedulingInterpretationMutable(actor:ServiceActor,c:SchedulingState,result:SchedulingInterpretation&{temporal_negative_context?:unknown},sourceMessage?:string){
  const start=performance.now();c.proposal=undefined;c.interpretation_source??="MODEL";
  const {operation=c.operation,temporal_evidence,temporal_negative_context,...raw}=result;if(!operation)throw Error("OPERATION_REQUIRED");
  if(c.operation&&c.operation!==operation)throw Error("OPERATION_MISMATCH");c.operation=operation;
  // Repeating an already accepted pair during a time/channel continuation is not new evidence.
  // A new service or customer association must be grounded in the current message.
  const entityPairChanged=raw.service_name!==c.fields.service_name || (raw.customer_name!==undefined&&raw.customer_name!==c.fields.customer_name);
  const selection=c.candidates?.kind==="service_ref"&&c.fields.service_name&&c.draft&&
    new Date(c.draft.expires_at).getTime()>Date.now()&&JSON.stringify(c.draft.fields)===JSON.stringify(c.fields)&&
    (raw.customer_name===undefined||raw.customer_name===c.fields.customer_name)
      ?{query:c.fields.service_name,candidates:c.candidates.items}:undefined;
  if(sourceMessage!==undefined&&raw.service_name&&entityPairChanged)await validateSchedulingEntityMentions(actor,sourceMessage,{customer_name:raw.customer_name??c.fields.customer_name,service_name:raw.service_name},selection);
  const timezone=await withTenant(actor,tx=>schedulingTimezone(tx,actor));
  const liveDraft=c.draft?{...c.draft,scope_valid:JSON.stringify(c.draft.fields)===JSON.stringify(c.fields)}:undefined;
  const negativeContext=schedulingNegativeContext(temporal_negative_context,{source:sourceMessage,previous:c.fields,raw:schedulingPatch.parse(raw),operation,evidence:temporal_evidence,draft:liveDraft});
  const grounded=groundSchedulingTemporal(c.fields,schedulingPatch.parse(raw),sourceMessage,timezone,new Date(),c.waiting_for,operation,temporal_evidence,liveDraft,negativeContext);
  if(await onlyOptionEchoes(actor,c,operation,grounded))grounded.rejected.splice(0);
  // A failed answer to a pending field is an unaccepted patch, not permission
  // to erase previously grounded values. No proposal existed for this incomplete
  // draft; retain its revision/identity and ask about the same role again.
  if(c.waiting_for&&c.draft?.missing_fields.includes(c.waiting_for)&&grounded.rejected.length&&!grounded.pending_temporal_ambiguities.length&&!grounded.pending_calendar_conflicts.length){
    c.message="Não consegui associar essa resposta com segurança à informação solicitada. "+c.message;
    c.metrics.message=(c.metrics.interpretation??0)+performance.now()-start;
    return;
  }
  const patch=grounded.patch;
  const sourceResult=groundSchedulingReasons(patch,c.fields,sourceMessage,c.draft?{operation:c.draft.operation,waiting_for:c.waiting_for,fields:c.draft.fields,review:c.draft.review,expires_at:c.draft.expires_at}:undefined);
  c.source_missing=pendingSourceFields(c.source_missing??c.draft?.source_missing,sourceResult);
  if(patch.override_reason!==undefined&&patch.override_reason!==c.fields.override_reason&&!("override_reason_source" in patch))delete c.fields.override_reason_source;
  if(c.fields.override_requested!==undefined&&["customer_name","service_name","professional_name","date","time","period"].some(k=>patch[k as keyof typeof patch]!==undefined&&patch[k as keyof typeof patch]!==c.fields[k as keyof typeof c.fields])&&patch.override_requested!==true){delete c.fields.override_requested;delete c.fields.override_reason;delete c.fields.override_reason_source;}
  if(patch.destination_mode==="ALTERNATIVE_SLOT"){c.fields.override_requested=false;delete c.fields.override_reason;delete c.fields.override_reason_source;if(patch.time===undefined)delete c.fields.time;}
  if(patch.override_requested===false){delete c.fields.override_reason;delete c.fields.override_reason_source;}
  const reconciled=reconcileSchedulingTemporal(c.fields,patch).fields;
  for(const [query,ref]of [["customer_name","customer_ref"],["service_name","service_ref"],["professional_name","professional_ref"]] as const){
    if(patch[query]!==undefined&&patch[query]!==c.fields[query]){delete c.fields[ref];if(query==="service_name")delete c.fields.professional_ref;}
  }
  if(c.fields.appointment_ref&&["customer_name","service_name","professional_name","source_date","source_time",...(operation==="appointment.cancel"?["date","time"]:[])].some(k=>patch[k as keyof typeof patch]!==undefined&&patch[k as keyof typeof patch]!==c.fields[k as keyof typeof c.fields]))delete c.fields.appointment_ref;
  if(operation==="appointment.cancel"&&(reconciled.time!==c.fields.time||reconciled.period!==c.fields.period))delete c.fields.appointment_ref;
  // Preserve reference invalidations above while replacing the temporal state.
  const reconciliation=reconcileSchedulingTemporal(c.fields,patch);
  applyTemporalRejections(reconciliation.fields,c.fields,grounded.rejected);
  c.pending_temporal_ambiguities=nextTemporalAmbiguities(c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities,grounded.pending_temporal_ambiguities,reconciliation.fields,schedulingPatch.parse(raw),grounded.rejected);
  c.pending_calendar_conflicts=nextCalendarConflicts(c.pending_calendar_conflicts??c.draft?.pending_calendar_conflicts,grounded.pending_calendar_conflicts,reconciliation.fields);
  c.fields=reconciliation.fields;await prepare(actor,c,[...reconciliation.rejected,...grounded.rejected],sourceResult.rejected);c.metrics.message=(c.metrics.interpretation??0)+performance.now()-start;
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
/** The committed draft stays authoritative even if a later proposal/read fails. */
export async function applySchedulingInterpretation(actor:ServiceActor,c:SchedulingState,result:SchedulingInterpretation&{temporal_negative_context?:unknown},sourceMessage?:string){
  c.proposal=undefined;
  const next=structuredClone(c);
  try{await applySchedulingInterpretationMutable(actor,next,result,sourceMessage);Object.assign(c,next);}
  catch(error){publishCommittedSchedulingDraft(c,next);throw error;}
}
export async function sendSchedulingTurn(actor:ServiceActor,c:SchedulingState,model:Model,message:string,assertLive:()=>unknown){
  c.proposal=undefined;c.metrics={};c.interpretation_source="MODEL";
  const context=clarificationContext({...c,...(c.candidates?{waiting_for:c.candidates.kind,selection:{field:c.candidates.kind,labels:c.candidates.items.map(row=>row.name)}}:{}),pending_temporal_ambiguities:c.pending_temporal_ambiguities??c.draft?.pending_temporal_ambiguities,pending_calendar_conflicts:c.pending_calendar_conflicts??c.draft?.pending_calendar_conflicts,missing_fields:c.draft?.missing_fields});
  return withTemporalTurnDrafts(c.draft?[{...c.draft,scope_valid:JSON.stringify(c.draft.fields)===JSON.stringify(c.fields)}]:[],async()=>{
    const result=await timed(c.metrics,"interpretation",()=>runServicesTurn(model,message,context,getOperationRequirements(c.operation??"appointment.create"),"scheduling"));
    assertLive();await applySchedulingInterpretation(actor,c,result,message);
  });
}
export async function selectScheduling(actor:ServiceActor,c:SchedulingState,ref:string){
  const selection=c.candidates;if(!selection?.items.some(r=>r.id===ref))throw Error("SELECTION_INVALID");
  c.proposal=undefined;
  const next=structuredClone(c);next.proposal=undefined;
  if(selection.kind==="appointment_ref"){
    if(isSchedulingMutation(c.operation??"")){
      const rows=await withTenant(actor,tx=>locateSchedulingAppointments(tx,actor,c.fields,c.operation!));
      if(!rows.some(r=>r.appointment_ref===ref))throw Error("SELECTION_INVALID");
      next.fields.appointment_ref=ref;
      try{await prepare(actor,next);Object.assign(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}return;
    }
    const row=await withTenant(actor,tx=>getSchedulingAppointment(tx,actor,ref));c.appointments=[row];c.candidates=undefined;c.message=`${row.customer_name} — ${row.start_local} (${row.timezone}) — ${row.professional_name} — ${row.status}`;return;
  }
  const current=await withTenant(actor,tx=>selection.kind==="customer_ref"?searchSalonCustomer(tx,actor,c.fields.customer_name!):selection.kind==="service_ref"?listSchedulingServices(tx,actor,c.fields.service_name!):listSchedulingProfessionals(tx,actor,{service_ref:c.fields.service_ref}));
  if(!current.some(r=>r.id===ref))throw Error("SELECTION_INVALID");
  next.fields[selection.kind]=ref;
  try{await prepare(actor,next);Object.assign(c,next);}catch(error){publishCommittedSchedulingDraft(c,next);throw error;}
}
