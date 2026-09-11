"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withHq } from "@/lib/hq/access";
import { askSupport, loadSupportState } from "@/lib/hq/support-service";
import { reviewSupport } from "@/lib/hq/support-repository";
import { list } from "@/lib/hq/repository";
import { HqError } from "@/lib/hq/validation";
export async function askSupportAction(input:unknown){return askSupport(input);}
export async function supportStateAction(customerId?:string,query="",cursor?:string){return loadSupportState(customerId,query,cursor);}
export async function supportItemsAction(kind:"bug"|"feature",query:string){
 z.enum(["bug","feature"]).parse(kind);z.string().max(100).parse(query);
 return withHq(async tx=>{const result=await list(tx,kind==="bug"?"bugs":"features",{q:query});return {items:result.rows.map(row=>({id:row.id,title:String(row.title),status:String(row.status)})),hasMore:result.hasMore};});
}
export async function reviewSupportAction(input:unknown){
 // Authentication outside catch keeps redirects intact.
 await withHq(async()=>undefined);
 try{const review=await withHq((tx,actor)=>reviewSupport(tx,actor,input));revalidatePath("/hq","layout");return {ok:true as const,review};}
 catch(error){return {ok:false as const,error:error instanceof HqError?error.message:"Não foi possível registrar. Confira os campos e atualize o histórico antes de tentar novamente."};}
}
