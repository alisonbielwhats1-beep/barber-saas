import "server-only";
import { z } from "zod";
import { completeSupport, SUPPORT_VERSION } from "@everflare/agents/support";
import { estimateChiefMicros } from "@everflare/agents/chief";
import { withHq } from "./access";
import { chiefConfig } from "./chief-config";
import * as runs from "./chief-repository";
import * as support from "./support-repository";
import { searchKnowledge, knowledgeVersion, type KnowledgeArticle } from "./knowledge";
import { HqError } from "./validation";
import { supportDraftSchema, type SupportDraft, type SupportState } from "./support-contract";

function config(){const chief=chiefConfig();return {...chief,ready:chief.ready&&process.env.HQ_SUPPORT_ENABLED==="true",reason:process.env.HQ_SUPPORT_ENABLED!=="true"?"O Suporte aguarda ativação do piloto.":chief.reason};}
export function validateSupportDraft(raw:unknown,articles:KnowledgeArticle[]):SupportDraft {
 const draft=supportDraftSchema.parse(raw);
 const valid=articles.length>0&&draft.articleIds.length>0&&draft.articleIds.every(id=>articles.some(a=>a.id===id));
 if(!valid)return {...draft,reply:"Preciso conferir essa orientação com o responsável pelo Everflare antes de confirmar. Pode descrever o que precisa fazer e o que aconteceu, sem incluir senhas ou dados pessoais?",needsHuman:true,recommendation:"human",reason:"Não há fontes suficientes e válidas na base para confirmar uma resposta.",articleIds:[]};
 if(articles.some(a=>a.humanOnly))return {...draft,needsHuman:true,recommendation:draft.recommendation==="reply"?"human":draft.recommendation};
 return draft;
}
export async function loadSupportState(customerId?:string,query="",cursor?:string):Promise<SupportState> {
 if(customerId)z.string().uuid().parse(customerId);if(cursor)z.string().uuid().parse(cursor);
 return withHq(async tx=>{
  const c=config(),ready=await runs.chiefReady(tx);
  const customers=await support.supportCustomers(tx,query);
  const context=customerId?await support.supportContext(tx,customerId):null;
  return {...customers,customerId:customerId??null,context:context?{business:context.business,status:context.status,tickets:context.tickets,activities:context.activities}:null,ready:c.ready&&ready,reason:ready?c.reason:"Histórico ainda não disponível.",budgetMicros:c.budgetMicros,committedMicros:ready?await runs.committed(tx):0,...(customerId&&ready?await support.supportHistory(tx,customerId,cursor):{runs:[],nextCursor:null})};
 });
}
const request=z.object({id:z.string().uuid(),customerId:z.string().uuid(),question:z.string().trim().min(3).max(1000)}).strict();
export async function askSupport(raw:unknown) {
 const actorId=await withHq(async(_tx,actor)=>actor);
 const parsed=request.safeParse(raw);if(!parsed.success)return {ok:false as const,error:"Selecione um cliente e informe uma dúvida de 3 a 1.000 caracteres."};
 const c=config();if(!c.ready)return {ok:false as const,error:c.reason};
 try{
  const input=parsed.data,articles=searchKnowledge(input.question);
  const prepared=await withHq(async(tx,actor)=>{
   if(actor!==actorId)throw new HqError("A sessão mudou.");
   if(!await runs.chiefReady(tx))throw new HqError("Histórico indisponível.");
   const context=await support.supportContext(tx,input.customerId);
   const snapshot={kind:"support",requestContext:"support:"+input.customerId,customerId:input.customerId,accountId:context.accountId,context,knowledgeVersion,articles};
   const reservation=await runs.reserveChief(tx,{...input,actorId,snapshot,sources:articles.map(a=>({label:a.title,href:"/hq/agents/knowledge#"+a.id})),budgetMicros:c.budgetMicros,contextKey:snapshot.requestContext,promptVersion:SUPPORT_VERSION});
   return {...reservation,snapshot};
  });
  if(!prepared.created)return {ok:true as const,id:input.id};
  let result=null;
  try{
   const completion=await completeSupport({question:input.question,snapshot:JSON.stringify(prepared.snapshot),apiKey:c.apiKey});
   const draft=validateSupportDraft(completion.output,articles);
   result={answer:JSON.stringify(draft),inputTokens:completion.inputTokens,outputTokens:completion.outputTokens,chargeMicros:estimateChiefMicros(completion.inputTokens,completion.outputTokens)};
  }catch{/* Preserve reservation on unconfirmed result; no raw provider logs. */}
  await withHq((tx,actor)=>{if(actor!==actorId)throw new HqError("A sessão mudou.");return runs.finishChief(tx,input.id,actorId,result);});
  return {ok:true as const,id:input.id};
 }catch(error){return {ok:false as const,error:error instanceof HqError?error.message:"Não foi possível gerar o rascunho. Atualize o histórico antes de tentar novamente."};}
}
