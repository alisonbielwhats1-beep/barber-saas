import { clarificationContext } from "./secretary-clarification";
import { applyDraftTransition } from "./secretary-draft-transition";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { communicationInterpretation,communicationRequirements,runServicesTurn,type CommunicationInterpretation,type Model,type CapabilitySelection } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { searchSalonCustomer } from "./customer-catalog";
import { getCustomerMessageContext,messagePatch,upsertMessageDraft,proposeCustomerMessage,confirmCustomerMessage,dispatchLocalMessage } from "./communication-actions";
import { schedulingState,applySchedulingInterpretation,sendSchedulingTurn,selectScheduling,type SchedulingState,type SchedulingReferences } from "./secretary-scheduling";
import { schedulingPatch } from "./scheduling-contract";
// B7: a text Luna drafted (message_mode GENERATED) is previewed under this label: a suggestion the owner reviews, never
// sent without the explicit confirmation (local fake provider only).
import { suggestedTextLabel } from "./secretary-display";

/** `references` (C5): the recipient follows another action's customer ("avisa ela"); see SchedulingReferences. */
export type CommunicationState={references?:SchedulingReferences;operation:"customer.message";query?:string;target?:string;fields:ReturnType<typeof messagePatch.parse>;message:string;
  candidates?:Awaited<ReturnType<typeof searchSalonCustomer>>;draft?:Awaited<ReturnType<typeof upsertMessageDraft>>;proposal?:Awaited<ReturnType<typeof proposeCustomerMessage>>;
  receipt?:Awaited<ReturnType<typeof confirmCustomerMessage>>;delivery?:Awaited<ReturnType<typeof dispatchLocalMessage>>;cancel?:SchedulingState;batch_ref?:string;
  metrics:Record<string,number>;interpretation_source:"MODEL"|"DETERMINISTIC_FAST_PATH"};
export const communicationState=():CommunicationState=>({operation:"customer.message",fields:{},message:"Informe destinatário, canal e texto. Somente simulação local.",metrics:{},interpretation_source:"MODEL"});

/** Quoted UTF-16 slice is preserved, including whitespace/newlines/emoji. No normalization. */
export function exactMessageContent(message:string){
  const quotes=[...message.matchAll(/“([^”]*)”|‘([^’]*)’|"([^"\n]*(?:\n[^"\n]*)*)"|'([^'\n]*)'/gu)];
  if(quotes.length!==1)return;
  return quotes[0][1]??quotes[0][2]??quotes[0][3]??quotes[0][4];
}
/** B7 rec 4 behind a flag (review): SALON_SECRETARY_GENERATED_SUGGESTION (default off) trusts Luna's GENERATED mode without
 * an explicit request of the owner. Off, a drafted text needs the owner's explicit request (the historical words, in the
 * inflections the question itself uses: "solicite ... uma sugestão" is answered by "pode sugerir"). */
export const generatedSuggestionEnabled=(env:Record<string,string|undefined>=process.env)=>env.SALON_SECRETARY_GENERATED_SUGGESTION==="true";
const draftRequest=/\b(?:redija|redigir|redige|escreva|escrever|escreve|sugira|sugerir|sugere|sugestao|sugestoes|elabore|elaborar|elabora|gere|gerar|gera|educadamente|gentilmente)\b/i;
const draftRequested=(message:string)=>draftRequest.test(message.normalize("NFD").replace(/\p{M}/gu,""));
/** The message questions (they reach the model as data; presentation digest). The content question states the rule in
 * force (review): an explicit request, or with the flag simply a request. */
export const channelQuestion="Qual canal? Neste teste, WhatsApp usa somente provider fake/local.";
export const contentQuestion=(relaxed:boolean)=>relaxed?"Informe o texto exato entre aspas ou peça uma sugestão de mensagem.":"Informe o texto exato entre aspas ou solicite explicitamente uma sugestão de mensagem.";
export function reconcileMessageContent(previous:CommunicationState["fields"],raw:CommunicationInterpretation,message:string){
  const patch=Object.fromEntries(Object.entries(raw).filter(([,v])=>v!=null));
  const quoted=exactMessageContent(message);
  if(quoted!==undefined&&(patch.content!==undefined||patch.message_mode!==undefined||/exatamente|mande|envie|avise/iu.test(message))){patch.content=quoted;patch.message_mode="EXACT";}
  else if(patch.content!==undefined||patch.message_mode!==undefined){
    // EXACT always needs the owner's own quoted text (above). GENERATED is Luna's drafted text, a suggestion the owner
    // reviews before any confirmation: accepted on the owner's explicit request, or always with the flag (B7).
    if(patch.message_mode!=="GENERATED"||!generatedSuggestionEnabled()&&!draftRequested(message))throw Error("MESSAGE_CONTENT_REVIEW_REQUIRED");
    if(typeof patch.content==="string"&&!patch.content.trim())delete patch.content;
  }
  const {recipient_name:_recipient,...fields}=patch;void _recipient;
  return messagePatch.parse({...previous,...fields});
}
export function communicationChannelFastPath(c:CommunicationState,message:string){
  if(c.proposal||c.receipt||c.candidates||c.cancel?.waiting_for||c.draft?.missing_fields.length!==1||c.draft.missing_fields[0]!=="channel")return;
  if(/^whatsapp$/i.test(message.trim()))return {channel:"WHATSAPP" as const};
}
async function prepare(a:ServiceActor,c:CommunicationState){
  c.proposal=undefined;
  if(c.references)delete c.references.blocked;
  // C5: the recipient waits for another action's customer (unknown, or a stale copy): a note, never a question or a draft.
  if(!c.cancel&&c.references?.waiting?.includes("customer")){c.references.blocked=true;c.message=c.references.note??"";return;}
  if(c.cancel){
    if(c.cancel.candidates||!c.cancel.draft?.action_snapshot){c.message=c.cancel.message;return;}
    const snapshot=c.cancel.draft.action_snapshot;
    if(c.target&&c.target!==snapshot.customer_ref)throw Error("DEPENDENCY_RECIPIENT_MISMATCH");
    // Resolve any explicitly named recipient independently; never silently replace it.
    if(c.query&&!c.target){
      const rows=await withTenant(a,tx=>searchSalonCustomer(tx,a,c.query!));
      if(!rows.some(r=>r.id===snapshot.customer_ref))throw Error("DEPENDENCY_RECIPIENT_MISMATCH");
      if(rows.length!==1){c.candidates=rows;c.message="Selecione o destinatário; deve ser o cliente do cancelamento.";return;}
    }
    c.target=snapshot.customer_ref;
  }
  if(!c.target){
    if(!c.query){c.message="Quem deve receber a mensagem?";return;}
    const t=performance.now();const rows=await withTenant(a,tx=>searchSalonCustomer(tx,a,c.query!));c.metrics.recipient_resolution=performance.now()-t;
    if(rows.length!==1){c.candidates=rows.length>1&&rows.length<=20?rows:undefined;c.message=!rows.length?"Não encontrei esse cliente neste salão.":rows.length>20?"Informe um nome mais específico.":"Qual cliente? Selecione uma opção real.";return;}
    c.target=rows[0].id;
  }
  const context=await withTenant(a,tx=>getCustomerMessageContext(tx,a,c.target!));
  if(!context.channel_eligible){c.message="O cliente não possui telefone válido para este canal. Atualize o cadastro antes de preparar a mensagem.";return;}
  const t=performance.now();
  c.draft=await withTenant(a,tx=>upsertMessageDraft(tx,a,{customer_ref:c.target,patch:c.fields,
    ...(c.cancel?{dependency:{snapshot:c.cancel.draft!.action_snapshot,fields:c.cancel.fields}}:{}),
    ...(c.draft?{draft_ref:c.draft.draft_ref,expected_revision:c.draft.draft_revision}:{})}));
  c.metrics.message_preparation=performance.now()-t;
  if(c.draft.status!=="READY"){
    c.message=c.draft.missing_fields.includes("channel")?channelQuestion:contentQuestion(generatedSuggestionEnabled());return;
  }
  const p=performance.now();c.proposal=await withTenant(a,tx=>proposeCustomerMessage(tx,a,{draft_ref:c.draft!.draft_ref,draft_revision:c.draft!.draft_revision}));
  c.metrics.proposal=performance.now()-p;c.message=c.proposal.fields?.message_mode==="GENERATED"?`${suggestedTextLabel}\n${c.proposal.preview}`:c.proposal.preview;
}
async function applyCommunicationInterpretationMutable(a:ServiceActor,c:CommunicationState,input:CommunicationInterpretation,message:string){
  const p=communicationInterpretation.parse(input);c.proposal=undefined;
  if(p.recipient_name&&c.target&&p.recipient_name!==c.query)throw Error("TARGET_ALREADY_SELECTED");
  c.query=p.recipient_name??c.query;c.fields=reconcileMessageContent(c.fields,p,message);await prepare(a,c);
}
export async function applyCommunicationInterpretation(a:ServiceActor,c:CommunicationState,input:CommunicationInterpretation,message:string){
  return applyDraftTransition(c,next=>applyCommunicationInterpretationMutable(a,next,input,message));
}
/** C5: the recipient follows another action's accepted customer (a backend ref and its name, never Luna's words). Another
 * recipient starts a new message draft (a draft never changes its recipient). No model call. Review: a text written for
 * the previous recipient (it may name her and her appointment) never follows to another person: when a known recipient
 * changes, the content and its mode are dropped and the text is asked (or suggested) again. */
export async function reseedCommunication(a:ServiceActor,c:CommunicationState,recipient:{ref:string;name:string}|undefined,references:SchedulingReferences){
  return applyDraftTransition(c,async next=>{
    next.references=references;
    if(recipient&&next.target!==recipient.ref){
      if(next.target!==undefined){const {content:_content,message_mode:_mode,...kept}=next.fields;void _content;void _mode;next.fields=kept;}
      next.target=recipient.ref;next.query=recipient.name;next.candidates=undefined;next.draft=undefined;
    }
    await prepare(a,next);
  });
}
async function selectCommunicationMutable(a:ServiceActor,c:CommunicationState,ref:string,origin:{clicked?:boolean}){
  if(c.receipt)throw Error("ALREADY_CONFIRMED");
  // D1: the cancel card is a scheduling card; only the owner's click (origin) may confirm an alias proposal there.
  if(c.cancel?.candidates){await selectScheduling(a,c.cancel,ref,origin);await prepare(a,c);return;}
  if(!c.candidates?.some(x=>x.id===ref))throw Error("SELECTION_INVALID");
  const fresh=await withTenant(a,tx=>searchSalonCustomer(tx,a,c.query!));if(!fresh.some(x=>x.id===ref))throw Error("SELECTION_INVALID");
  c.target=ref;c.candidates=undefined;await prepare(a,c);
}
export async function selectCommunication(a:ServiceActor,c:CommunicationState,ref:string,origin:{clicked?:boolean}={}){
  return applyDraftTransition(c,next=>selectCommunicationMutable(a,next,ref,origin));
}
export async function startCancellationMessage(a:ServiceActor,selection:CapabilitySelection,message:string,publish?:(state:CommunicationState)=>void){
  const cancel=selection.operations.find(o=>o.operation==="appointment.cancel"),send=selection.operations.find(o=>o.operation==="customer.message");
  if(selection.independent||selection.operations.length!==2||!cancel?.item_key||!send?.item_key||cancel.depends_on.length||send.depends_on.length!==1||send.depends_on[0]!==cancel.item_key||cancel.released_slot_of||send.released_slot_of)throw Error("UNSUPPORTED_BATCH");
  const c=communicationState();c.batch_ref=randomUUID();c.cancel={...schedulingState(),proposal_deferred:true};
  publish?.(c); // Keep any accepted child draft reachable if later preparation fails.
  const keys=Object.keys(schedulingPatch.shape);
  // B5: only a contradicted role's marker travels (no quote proof here, as before): that role is asked.
  const conflicts=cancel.temporal_evidence?.filter(entry=>entry.conflict)??[];
  await applySchedulingInterpretation(a,c.cancel,{operation:"appointment.cancel",...Object.fromEntries(Object.entries(cancel).filter(([k,v])=>keys.includes(k)&&v!=null)),...(conflicts.length?{temporal_evidence:conflicts}:{})},message);
  await applyCommunicationInterpretation(a,c,send.communication??{},message);return c;
}
export async function sendCommunicationTurn(a:ServiceActor,c:CommunicationState,model:()=>Promise<Model>,message:string,assertLive:()=>unknown){
  c.proposal=undefined;const t=performance.now();
  if(c.cancel&&!c.cancel.draft?.action_snapshot){
    await applyDraftTransition(c,async next=>{await sendSchedulingTurn(a,next.cancel!,await model(),message,assertLive);await prepare(a,next);});return;
  }
  const p=await runServicesTurn(await model(),message,{...clarificationContext({...c,fields:{...c.fields,recipient_name:c.query},operation:"customer.message",missing_fields:c.draft?.missing_fields,waiting_for:c.draft?.missing_fields.includes("channel")?"channel":undefined}),recipient_selected:Boolean(c.target)},communicationRequirements(),"communication");
  c.metrics.interpretation=performance.now()-t;assertLive();await applyCommunicationInterpretation(a,c,p,message);
}
