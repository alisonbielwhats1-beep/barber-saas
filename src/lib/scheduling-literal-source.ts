import { createHash } from "node:crypto";
import { z } from "zod";
import { groundSchedulingException, type SchedulingOverrideDecisionContext } from "./scheduling-conflict-contract";
import { overrideReasonSource } from "./scheduling-reason-source";

export const reasonField = z.enum(["reason", "override_reason"]);
export type ReasonField = z.infer<typeof reasonField>;
export const reasonRejection = z.object({ code:z.literal("SOURCE_REASON_CONFLICT"), field:reasonField, value:z.string().max(200) }).strict();
export type ReasonRejection = z.infer<typeof reasonRejection>;
export const reasonSource = overrideReasonSource.extend({kind:z.literal("EXPLICIT_CANCELLATION_CAUSE")});

const canonical = (value:string)=>value.normalize("NFC").toLocaleLowerCase("pt-BR");
/** Case/NFC are representation differences only. Map back to the exact source
 * graphemes so the ERP and audit retain the owner's original text. */
function literalCauseSpan(message:string,value:string){
  let text="";const starts:number[]=[],ends:number[]=[];
  for(const part of new Intl.Segmenter("pt-BR",{granularity:"grapheme"}).segment(message)){
    const normalized=canonical(part.segment);text+=normalized;
    for(let i=0;i<normalized.length;i++){starts.push(part.index);ends.push(part.index+part.segment.length);}
  }
  const at=text.indexOf(canonical(value));if(at<0)return;
  const start=starts[at],end=ends[at+canonical(value).length-1];
  const original=message.slice(start,end),before=message.slice(0,start),after=message.slice(end);
  if(/\p{L}$/u.test(before)&&/^\p{L}/u.test(original)||/\p{L}$/u.test(original)&&/^\p{L}/u.test(after))return {rejected:true};
  // Clipping a directly attached negator changes the literal cause. A negation
  // in a different action after this span is outside this field's evidence.
  if(/\b(?:não|nao|nunca|jamais|sem)\s*$/iu.test(before))return {rejected:true};
  return {start,end,original};
}

/** Luna selects the causal phrase and its role. The backend proves literal
 * provenance; it never expands a subject, substitutes a pronoun or paraphrases.
 * Accepted prior fields are untouched; rejected patches create pending input. */
export function groundSchedulingReasons(patch: Record<string,unknown>, previous: Record<string,unknown>, message?: string, context?: SchedulingOverrideDecisionContext) {
  const rejected:ReasonRejection[]=[], accepted:ReasonField[]=[];
  if(message===undefined)return {rejected,accepted}; // Backend-only historical calls.
  const consent={...patch};delete consent.override_reason;
  groundSchedulingException(consent,previous,message,context);
  for(const field of reasonField.options){
    const value=patch[field];if(typeof value!=="string")continue;
    const span=literalCauseSpan(message,value);
    if(!span&&typeof previous[field]==="string"&&canonical(value)===canonical(previous[field] as string)){delete patch[field];continue;}
    let valid=value.length>=3&&span!==undefined&&!("rejected" in span);
    if(valid&&field==="override_reason")try{groundSchedulingException({override_reason:value},{},message);}catch{valid=false;}
    if(!valid||!span||"rejected" in span){rejected.push({code:"SOURCE_REASON_CONFLICT",field,value});delete patch[field];continue;}
    const {start,end,original}=span!;patch[field]=original;
    const provenance={message_sha256:createHash("sha256").update(message).digest("hex"),start,end,original_text:original,interpreted_text:value};
    if(field==="reason")patch.reason_source=reasonSource.parse({kind:"EXPLICIT_CANCELLATION_CAUSE",...provenance});
    else patch.override_reason_source=overrideReasonSource.parse({kind:"EXPLICIT_OVERRIDE_CAUSE",...provenance});
    accepted.push(field);
  }
  return {rejected,accepted};
}
export function pendingSourceFields(previous:ReasonField[]|undefined, result:{accepted:ReasonField[];rejected:ReasonRejection[]}){
  return [...new Set([...(previous??[]).filter(field=>!result.accepted.includes(field)),...result.rejected.map(item=>item.field)])];
}
