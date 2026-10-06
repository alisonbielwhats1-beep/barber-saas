import { performance } from "node:perf_hooks";
import { clarificationContext } from "./secretary-clarification";
import { sameAcceptedQuery } from "./secretary-entity-context";
import { inventoryInterpretation, runServicesTurn, type InventoryInterpretation, type Model } from "@everflair/salon-secretary";
import { getOperationRequirements } from "./service-contract";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { getStockBalance, getProduct, searchProducts, assertInventoryAccess } from "./inventory-catalog";
import { inventoryReferenceCatalog } from "./inventory-reference-catalog";
import { inventoryPatch, upsertInventoryDraft, proposeStockMovement, confirmStockMovement } from "./inventory-actions";
import { groundInventoryQuantity, missingInventoryQuantity, inventoryQuantityQuestion, sourceHasInventoryCount, inventoryProductInSource, inventoryProductCorrectionInSource, type InventoryQuantityContext, type InventoryQuantityResolution, type InventoryQuantityWitness } from "./inventory-quantity";
import type {InventoryOperationScope} from "./inventory-source-scope";
import { singularProductQuery } from "./product-name-singular";

export type InventoryState = {
  operation?: "product.search" | "stock.balance" | "stock.movement"; query?: string; target?: string;
  fields: ReturnType<typeof inventoryPatch.parse>; low_stock?: boolean; status: "NEEDS_INPUT" | "READY" | "DONE";
  candidates?: Awaited<ReturnType<typeof searchProducts>>; products?: Awaited<ReturnType<typeof searchProducts>>;
  draft?: Awaited<ReturnType<typeof upsertInventoryDraft>>; proposal?: Awaited<ReturnType<typeof proposeStockMovement>>;
  receipt?: Awaited<ReturnType<typeof confirmStockMovement>>; message: string; metrics: Record<string, number>;
  interpretation_source: "MODEL" | "DETERMINISTIC_FAST_PATH";
  quantity_resolution?:InventoryQuantityResolution;
  pending_quantity_source?:{quantity:number;source:string;literal?:string|null};
};
export function inventoryState(): InventoryState { return { fields: {}, status: "NEEDS_INPUT", metrics: {}, interpretation_source: "MODEL", message: "Posso consultar produtos e preparar entrada ou saída de estoque." }; }
export function inventoryQuantityFastPath(s: InventoryState, message: string) {
  if (s.operation !== "stock.movement" || s.proposal || s.receipt || s.candidates || s.draft?.missing_fields.length !== 1 || s.draft.missing_fields[0] !== "quantity") return;
  const text = message.trim();
  if (!/^[1-9]\d{0,5}$/.test(text)) return;
  const quantity = Number(text); if (quantity > 100000) return;
  return { quantity };
}
function quantityContext(s:InventoryState):InventoryQuantityContext|undefined{
  const d=s.draft;
  if(!d||!d.product||!s.target||d.product.id!==s.target||
    (["mode","quantity","reason"] as const).some(key=>d.fields[key]!==(key==="reason"?s.fields.reason??"Ajuste rápido":s.fields[key]))||s.receipt||s.candidates)return;
  const waiting=d.status==="NEEDS_INPUT"&&d.missing_fields.length===1&&d.missing_fields[0]==="quantity"&&!s.proposal;
  return {draft_ref:d.draft_ref,draft_revision:d.draft_revision,expires_at:d.expires_at,product_ref:d.product.id,product_revision:d.product.revision,unit:d.product.unit,...(waiting?{requested_field:"quantity" as const,published_question:s.message}:{})};
}
async function resolved(actor: ServiceActor, s: InventoryState) {
  if (!s.target) throw Error("PRODUCT_NOT_FOUND");
  if (s.operation !== "stock.movement") {
    const t=performance.now(); const p=await withTenant(actor,tx=>getStockBalance(tx,actor,s.target!)); s.metrics.stock_query=performance.now()-t;
    s.products=[p]; s.status="DONE"; s.message=`${p.name}${p.active?"":" (inativo)"}: ${p.stock} un. Mínimo: ${p.minStock} un.`; return;
  }
  const draftStarted=performance.now();
  s.draft=await withTenant(actor,tx=>upsertInventoryDraft(tx,actor,{product_ref:s.target!,patch:s.fields,quantity_origin:"CONVERSATION",quantity_resolution:s.quantity_resolution??missingInventoryQuantity(),
    ...(s.draft?{draft_ref:s.draft.draft_ref,expected_revision:s.draft.draft_revision}:{})}));
  s.metrics.draft=performance.now()-draftStarted;
  s.status=s.draft.status;
  s.fields={...s.draft.fields};s.quantity_resolution=s.draft.quantity_resolution;
  if(s.draft.status!=="READY") { s.message=s.draft.missing_fields.includes("mode")?"É uma entrada ou uma saída de estoque?":inventoryQuantityQuestion(s.quantity_resolution); return; }
  const t=performance.now();
  s.proposal=await withTenant(actor,tx=>proposeStockMovement(tx,actor,{draft_ref:s.draft!.draft_ref,draft_revision:s.draft!.draft_revision}));
  s.metrics.proposal=performance.now()-t; s.message=`${s.proposal.preview}\nUse Confirmar para movimentar o estoque.`;
}
async function applyInventoryMutable(actor: ServiceActor, s: InventoryState, input: InventoryInterpretation,sourceMessage?:string,context?:InventoryQuantityContext,siblingWitnesses?:readonly InventoryQuantityWitness[],operationScopes?:readonly InventoryOperationScope[],onCommitted?:(state:InventoryState)=>void) {
  const parsed=inventoryInterpretation.parse(input);
  const p=Object.fromEntries(Object.entries(parsed).filter(([,v])=>v!=null)) as InventoryInterpretation;
  const operation=p.operation??s.operation;
  if(!operation){s.message="Deseja consultar, dar entrada ou dar saída no estoque?";return;}
  if(s.operation&&s.operation!==operation)throw Error("OPERATION_MISMATCH");
  if(operation!=="stock.movement"&&(p.mode!=null||p.quantity!=null||p.reason!=null||p.quantity_evidence!=null||p.reference!=null))throw Error("CAPABILITY_FIELD_MISMATCH");
  if(operation==="stock.movement"&&p.low_stock===true)throw Error("CAPABILITY_FIELD_MISMATCH");
  const correctedTarget=s.target&&p.product_name!=null&&!sameAcceptedQuery(p.product_name,s.query);
  const explicitCorrection=p.product_name!=null&&(inventoryProductCorrectionInSource(sourceMessage,[p.product_name])||
    p.reference?.kind==="NAMED"&&!!sourceMessage?.includes(p.reference.literal)&&inventoryProductInSource(p.reference.literal,[p.product_name]));
  if(correctedTarget&&(!s.draft||!context||!explicitCorrection))throw Error("TARGET_ALREADY_SELECTED");
  await withTenant(actor,tx=>assertInventoryAccess(tx,actor,operation==="stock.movement"));
  if(correctedTarget){
    // A new explicit selector releases the prior binding, even if no catalog
    // entity matches it. A later numeric reply cannot silently restore it.
    const invalidated={...s.fields};delete invalidated.quantity;
    await withTenant(actor,tx=>upsertInventoryDraft(tx,actor,{product_ref:s.target!,patch:invalidated,quantity_origin:"CONVERSATION",quantity_resolution:missingInventoryQuantity(),draft_ref:s.draft!.draft_ref,expected_revision:s.draft!.draft_revision}));
    s.target=undefined;s.draft=undefined;s.candidates=undefined;context=undefined;s.query=p.product_name!;
    delete s.fields.quantity;s.quantity_resolution=missingInventoryQuantity();s.pending_quantity_source=undefined;
    s.status="NEEDS_INPUT";s.message="Qual é a quantidade em unidades para o produto corrigido?";onCommitted?.(s);
  }
  s.proposal=undefined; s.products=undefined; s.status="NEEDS_INPUT"; s.operation=operation;
  s.query=p.product_name??s.query; s.low_stock=p.low_stock??s.low_stock;
  s.fields=inventoryPatch.parse({...s.fields,...Object.fromEntries(["mode","reason"].filter(k=>p[k as keyof typeof p]!=null).map(k=>[k,p[k as keyof typeof p]]))});
  if(s.quantity_resolution?.cause==="PRODUCT_UNPROVEN"&&!s.target&&p.product_name==null&&p.quantity!=null){
    s.message="Qual é o produto desta movimentação? A quantidade ainda precisa ser vinculada a ele.";return;
  }
  if(p.quantity!=null&&(p.quantity!==s.fields.quantity||s.quantity_resolution?.status!=="ACCEPTED"||p.quantity_evidence!=null||sourceHasInventoryCount(sourceMessage,[s.query,s.draft?.product.name].filter((name):name is string=>!!name)))){
    const proof={quantity:p.quantity,literal:p.quantity_evidence,source:sourceMessage,
      product_names:[s.query,s.draft?.product.name].filter((name):name is string=>!!name),context,sibling_witnesses:siblingWitnesses,
      reference:p.reference,source_scope:p.source_scope,reason:p.reason,operation_scopes:operationScopes};
    const provisional=groundInventoryQuantity(proof);
    const roleProof=!!p.reference||!!p.source_scope||!!(p.reason&&sourceMessage?.includes(p.reason));
    const contextualProof=context?.requested_field==="quantity"&&provisional.basis!=="CLARIFICATION";
    if(contextualProof&&context){
      const currentContext=context;
      if((await withTenant(actor,tx=>getProduct(tx,actor,currentContext.product_ref))).revision!==currentContext.product_revision)throw Error("PRODUCT_STALE");
    }
    // Self-contained legacy replies retain their audited contract; new semantic
    // boundaries and unresolved current references require factual catalog data.
    s.quantity_resolution=roleProof||contextualProof?
      groundInventoryQuantity({...proof,catalog:await withTenant(actor,tx=>inventoryReferenceCatalog(tx,actor))}):provisional;
    if(s.quantity_resolution.status==="ACCEPTED")s.fields.quantity=s.quantity_resolution.quantity;
    else delete s.fields.quantity;
    s.pending_quantity_source=s.quantity_resolution.status!=="ACCEPTED"&&sourceMessage!==undefined?{quantity:p.quantity,source:sourceMessage,literal:p.quantity_evidence}:undefined;
  }else if(p.product_name!=null&&s.pending_quantity_source&&s.quantity_resolution?.cause==="PRODUCT_UNPROVEN"){
    // The original measure remains evidence, not an accepted value. Revalidate
    // it against the corrected identity before recovering any executable count.
    if(inventoryProductCorrectionInSource(sourceMessage,[p.product_name]))s.quantity_resolution=groundInventoryQuantity({...s.pending_quantity_source,product_names:[p.product_name]});
    if(s.quantity_resolution.status==="ACCEPTED"){s.fields.quantity=s.quantity_resolution.quantity;s.pending_quantity_source=undefined;}
  }else if(operation==="stock.movement"&&!s.quantity_resolution){s.quantity_resolution=missingInventoryQuantity();delete s.fields.quantity;}
  if(operation==="stock.movement"&&s.quantity_resolution?.cause==="PRODUCT_UNPROVEN"){
    // A failed proof of this measure is not a contradiction of an accepted target.
    if(s.target&&s.draft&&s.quantity_resolution.identity_status==="UNRESOLVED"){await resolved(actor,s);return;}
    if(s.target&&s.draft){
      // Invalidate a former proposal in its journal before releasing its target.
      s.draft=await withTenant(actor,tx=>upsertInventoryDraft(tx,actor,{product_ref:s.target!,patch:s.fields,quantity_origin:"CONVERSATION",quantity_resolution:s.quantity_resolution,
        draft_ref:s.draft!.draft_ref,expected_revision:s.draft!.draft_revision}));
    }
    s.target=undefined;s.query=undefined;s.candidates=undefined;s.draft=undefined;delete s.fields.quantity;
    s.message="Não consegui vincular essa quantidade ao produto informado. Qual é o produto desta movimentação?";return;
  }
  if(s.target){await resolved(actor,s);return;}
  if(!s.query&&!s.low_stock){s.message="Qual é o produto?";return;}
  const t=performance.now();
  let candidates=await withTenant(actor,tx=>searchProducts(tx,actor,{...(s.query?{query:s.query}:{}),low_stock:s.low_stock??false}));
  // A product said in the plural ("quatro Óleos Aurora") is kept in the singular by the catalog: when the name as said found
  // nothing, ONE more search with it in the singular; several matches still ask (identity only, the quantity proof is unchanged).
  const singular=s.query&&!candidates.length?singularProductQuery(s.query):undefined;
  if(singular&&singular!==s.query)candidates=await withTenant(actor,tx=>searchProducts(tx,actor,{query:singular,low_stock:s.low_stock??false}));
  s.metrics.product_resolution=performance.now()-t;
  if(operation==="product.search"||s.low_stock){
    s.products=candidates.slice(0,20); s.status="DONE";
    s.message=candidates.length?`${s.low_stock?"Estoque baixo (saldo ≤ mínimo)":"Produtos"}:\n${s.products.map(p=>`${p.name}${p.active?"":" (inativo)"}: ${p.stock} un; mínimo ${p.minStock} un`).join("\n")}${candidates.length>20?"\nMostrando os primeiros 20; refine pelo nome.":""}`:"Nenhum produto encontrado para esta consulta.";return;
  }
  if(candidates.length!==1){s.candidates=candidates.length<=20?candidates:undefined;s.message=!candidates.length?"Não encontrei esse produto neste salão.":candidates.length>20?"Muitos produtos encontrados. Informe um nome mais específico.":"Encontrei mais de um produto. Selecione qual deseja.";return;}
  s.target=candidates[0].id;s.candidates=undefined;await resolved(actor,s);
}
function publishCommittedDraft(current:InventoryState,next:InventoryState){
  if(next.draft&&(!current.draft||next.draft.draft_ref!==current.draft.draft_ref||next.draft.draft_revision>current.draft.draft_revision)){
    next.proposal=undefined;next.message="Os dados estão preservados. Não consegui preparar a confirmação. Tente novamente.";
    Object.assign(current,next);
  }
}
/** A committed draft is authoritative even when later proposal preparation fails. */
export async function applyInventoryInterpretation(actor:ServiceActor,s:InventoryState,input:InventoryInterpretation,sourceMessage?:string,siblingWitnesses?:readonly InventoryQuantityWitness[],operationScopes?:readonly InventoryOperationScope[]){
  const context=quantityContext(s);s.proposal=undefined;
  const next=structuredClone(s);let committed:InventoryState|undefined;
  try{await applyInventoryMutable(actor,next,input,sourceMessage,context,siblingWitnesses,operationScopes,state=>{committed=structuredClone(state);});Object.assign(s,next);}
  catch(error){if(committed)Object.assign(s,committed);publishCommittedDraft(s,next);throw error;}
}
export async function selectInventory(actor: ServiceActor,s:InventoryState,ref:string){
  if(s.receipt||s.status==="DONE"||!s.candidates?.some(p=>p.id===ref))throw Error("SELECTION_INVALID");
  const fresh=await withTenant(actor,tx=>searchProducts(tx,actor,{query:s.query!}));
  if(!fresh.some(p=>p.id===ref))throw Error("SELECTION_INVALID");
  const next=structuredClone(s);next.target=ref;next.candidates=undefined;
  try{await resolved(actor,next);Object.assign(s,next);}catch(error){publishCommittedDraft(s,next);throw error;}
}
export async function sendInventoryTurn(actor:ServiceActor,s:InventoryState,model:Model,message:string,assertLive:()=>unknown){
  s.proposal=undefined;const t=performance.now();
  const patch=await runServicesTurn(model,message,{...clarificationContext({...s,fields:{...s.fields,product_name:s.query},missing_fields:s.draft?.missing_fields,waiting_for:s.draft?.missing_fields.includes("mode")?"mode":s.draft?.missing_fields.includes("quantity")?"quantity":undefined}),quantity_context:{catalog_unit:s.draft?.product.unit??"un",resolution:s.quantity_resolution},target_selected:Boolean(s.target)},getOperationRequirements("stock.movement"),"inventory");
  s.metrics.interpretation=performance.now()-t;s.interpretation_source="MODEL";assertLive();await applyInventoryInterpretation(actor,s,patch,message);
}
export async function persistInventoryMetrics(actor:ServiceActor,sessionId:string,s:InventoryState){
  await withTenant(actor,tx=>tx.auditLog.create({data:{salonId:actor.salonId,userId:actor.userId,actorName:"Secretária — latência",entityType:"SECRETARY_LATENCY",entityId:sessionId,action:"INVENTORY",metadata:{operation:s.operation??null,interpretation_source:s.interpretation_source,durations_ms:s.metrics,...(s.interpretation_source==="DETERMINISTIC_FAST_PATH"?{model_avoided:true,model_requests:0,model_cost:0}:{})}}}));
}
