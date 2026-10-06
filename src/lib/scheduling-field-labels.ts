import { secretaryCopyV2Enabled } from "./secretary-error-copy";

/** B7: each temporal role named for what the operation does (a block's start/end, the booked appointment's day) —
 * "destino" only where there is an origin (a change). Shared (UX-COPY) so the calendar and half-day questions can use it
 * without importing the adapter; secretary-scheduling.ts re-exports it (the presentation digest reads it there). */
export function temporalFieldLabels(operation?:string):Record<string,string>{
  if(operation==="schedule.block")return {date:"data do bloqueio",time:"início do bloqueio",end_date:"data final do bloqueio",end_time:"fim do bloqueio",source_date:"data original",source_time:"horário original"};
  if(operation==="appointment.create"||operation==="appointment.cancel"||operation==="appointment.read")return {date:"data do atendimento",time:"horário do atendimento",source_date:"data original",source_time:"horário original",end_date:"data final",end_time:"horário final"};
  if(operation==="appointment.list"||operation==="availability.get")return {date:"data",time:"horário",source_date:"data original",source_time:"horário original",end_date:"data final",end_time:"horário final"};
  return {date:"data de destino",time:"horário de destino",source_date:"data original",source_time:"horário original",end_date:"data final",end_time:"horário final"};
}
/** The historical, operation-agnostic labels of the calendar ("Para a …") and half-day ("No …") questions. */
const questionLabels:Record<string,string>={source_date:"data original",date:"data desejada",end_date:"data final",source_time:"horário original",time:"horário de destino",end_time:"horário final"};
/** UX-COPY (flag SALON_SECRETARY_COPY_V2, default off): the role a calendar or half-day question names, by what the operation does
 * (a cancellation's "horário do atendimento", a block's "início do bloqueio"). Off, with no operation, or for a read: the historical label. */
export function temporalQuestionLabel(field:string,operation?:string){
  // A read (the agenda, free times) keeps "data desejada": its generic labels ("data", "horário") say less than the historical ones.
  const specific=!!operation&&operation!=="appointment.list"&&operation!=="availability.get";
  return (specific&&secretaryCopyV2Enabled()?temporalFieldLabels(operation)[field]:undefined)??questionLabels[field];
}
