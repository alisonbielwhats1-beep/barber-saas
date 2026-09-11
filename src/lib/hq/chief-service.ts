import "server-only";
import { z } from "zod";
import { completeChief, estimateChiefMicros } from "@everflare/agents/chief";
import { withHq } from "./access";
import { chiefConfig } from "./chief-config";
import { chiefSnapshot, chiefSources } from "./chief-snapshot";
import * as repo from "./chief-repository";
import { HqError } from "./validation";
import type { ChiefRun, ChiefState } from "./chief-contract";

export async function loadChiefState(cursor?: string): Promise<ChiefState> {
 if(cursor) z.string().uuid().parse(cursor);
 return withHq(async tx=>{
  const config=chiefConfig();
  if(!await repo.chiefReady(tx)) return {ready:false,reason:"O piloto aguarda a migration do histórico.",budgetMicros:config.budgetMicros,committedMicros:0,runs:[],nextCursor:null};
  return {ready:config.ready,reason:config.reason,budgetMicros:config.budgetMicros,committedMicros:await repo.committed(tx),...await repo.chiefHistory(tx,cursor)};
 });
}
const request = z.object({id:z.string().uuid(),question:z.string().trim().min(3).max(1000)}).strict();
export async function askChief(input: unknown): Promise<{ok:true;run:ChiefRun}|{ok:false;error:string}> {
 // Fora do catch: redirects/autorização mantêm o comportamento nativo.
 const actorId = await withHq(async (_tx,actor)=>actor);
 const parsed=request.safeParse(input);
 if(!parsed.success) return {ok:false,error:"Informe uma pergunta de 3 a 1.000 caracteres e uma solicitação válida."};
 const config=chiefConfig();
 if(!config.ready) return {ok:false,error:config.reason};
 try {
  const prepared=await withHq(async (tx,actor)=>{
   if(actor!==actorId) throw new HqError("A sessão mudou. Recarregue a página.");
   if(!await repo.chiefReady(tx)) throw new HqError("O histórico do piloto ainda não está disponível.");
   const snapshot=await chiefSnapshot(tx);
   const reservation=await repo.reserveChief(tx,{...parsed.data,actorId,snapshot,sources:chiefSources,budgetMicros:config.budgetMicros});
   return {snapshot,...reservation};
  });
  if(!prepared.created) return {ok:true,run:prepared.run};
  // Nenhuma transação/conexão fica aberta durante a chamada externa.
  let completed: Awaited<ReturnType<typeof completeChief>>|null = null;
  try {
   completed=await completeChief({question:parsed.data.question,snapshot:JSON.stringify(prepared.snapshot),apiKey:config.apiKey});
  } catch { /* Sem payload, tokens de acesso ou erro bruto do provedor nos logs. */ }
  const result=completed?{answer:completed.output,inputTokens:completed.inputTokens,outputTokens:completed.outputTokens,chargeMicros:estimateChiefMicros(completed.inputTokens,completed.outputTokens)}:null;
  const run=await withHq((tx,actor)=>{
   if(actor!==actorId) throw new HqError("A sessão mudou. Consulte o histórico.");
   return repo.finishChief(tx,parsed.data.id,actorId,result);
  });
  return {ok:true,run};
 } catch(error) {
  return {ok:false,error:error instanceof HqError?error.message:"Não foi possível concluir a consulta. Atualize o histórico antes de tentar novamente; uma reserva pode estar pendente."};
 }
}
