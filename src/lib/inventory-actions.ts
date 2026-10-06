import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { actionJournal, assertCurrent, assertUnexpired, confirmJournalAction } from "./secretary-journal";
import { proposeServiceInput, confirmServiceInput } from "./service-create-mvp";
import { assertInventoryAccess, getProduct, productDTO } from "./inventory-catalog";
import { adjustProductStockReliably } from "./appointment-product-service";
import { lockProductMutations } from "./inventory-lock";
import { validateStockAdjustment } from "./operational-flows";
import { inventoryQuantityResolution } from "./inventory-quantity";

export const inventoryPatch = z.object({ mode: z.enum(["IN", "OUT"]).optional(), quantity: z.number().int().min(1).max(100000).optional(), reason: z.string().trim().min(3).max(300).optional() }).strict();
const journal = actionJournal("SECRETARY_INVENTORY");
const draftSchema = z.object({ operation: z.literal("stock.movement"), draft_ref: z.string().uuid(), draft_revision: z.number().int().min(1).max(100),
  product: productDTO, fields: inventoryPatch, expires_at: z.string().datetime(),
  quantity_origin:z.literal("CONVERSATION").optional(),quantity_resolution:inventoryQuantityResolution.optional() }).strict();
const proposalSchema = draftSchema.extend({ proposal_ref: z.string().uuid(), payload_hash: z.string().length(64), preview: z.string(), delta: z.number().int(), projected_stock: z.number().int() });
const receiptSchema = z.object({ receipt_ref: z.string().uuid(), proposal_ref: z.string().uuid(), product_ref: z.string(), draft_ref: z.string().uuid(), draft_revision: z.number().int(), previous_stock: z.number().int(), stock: z.number().int(), unit: z.literal("un") }).strict();
async function latest(tx: Tx, actor: ServiceActor, ref: string) {
  const rows = await tx.auditLog.findMany({ where: { ...journal.scope(actor), action: "DRAFT", entityId: ref }, select: { metadata: true } });
  const d = rows.map(r=>draftSchema.parse(r.metadata)).sort((a,b)=>b.draft_revision-a.draft_revision)[0];
  if (!d) throw Error("DRAFT_NOT_FOUND"); return d;
}
function assess(d: z.infer<typeof draftSchema>) {
  const missing_fields = (["mode", "quantity"] as const).filter(k=>d.fields[k]===undefined);
  if(d.quantity_origin==="CONVERSATION"&&(d.quantity_resolution?.status!=="ACCEPTED"||d.quantity_resolution.quantity!==d.fields.quantity||d.quantity_resolution.catalog_unit!==d.product.unit)&&!missing_fields.includes("quantity"))missing_fields.push("quantity");
  return { ...d, status: missing_fields.length ? "NEEDS_INPUT" as const : "READY" as const, missing_fields };
}
function amounts(d: z.infer<typeof draftSchema>) {
  if (assess(d).status !== "READY") throw Error("NEEDS_INPUT");
  const delta = (d.fields.mode === "IN" ? 1 : -1)*d.fields.quantity!;
  const projected_stock = validateStockAdjustment({ currentStock: d.product.stock, delta });
  if (projected_stock > 2147483647) throw Error("STOCK_OVERFLOW");
  return { delta, projected_stock };
}
function hash(d: z.infer<typeof draftSchema>) {
  return createHash("sha256").update(JSON.stringify({ operation: d.operation, product: d.product, fields: d.fields, requirements: "inventory-v1",
    ...(d.quantity_origin?{quantity_origin:d.quantity_origin,quantity_resolution:d.quantity_resolution}: {}) })).digest("hex");
}
async function unchanged(tx: Tx, actor: ServiceActor, d: z.infer<typeof draftSchema>) {
  if ((await getProduct(tx, actor, d.product.id)).revision !== d.product.revision) throw Error("PRODUCT_CHANGED");
}
/** U03 adapter: no stock write. Unknown fields, clears and references from the model are rejected. */
export async function upsertInventoryDraft(tx: Tx, actor: ServiceActor, input: unknown) {
  await assertInventoryAccess(tx, actor, true);
  const p = z.object({ product_ref: z.string().min(1), patch: inventoryPatch, draft_ref: z.string().uuid().optional(), expected_revision: z.number().int().min(1).optional(),
    quantity_origin:z.literal("CONVERSATION").optional(),quantity_resolution:inventoryQuantityResolution.optional() }).strict()
    .refine(x=>Boolean(x.draft_ref)===Boolean(x.expected_revision), "REVISION_REQUIRED").parse(input);
  const ref = p.draft_ref ?? randomUUID(); await journal.lock(tx, actor, ref);
  const old = p.draft_ref ? await latest(tx, actor, ref) : undefined;
  if (old) {
    assertCurrent(old, p.expected_revision!); assertUnexpired(old.expires_at);
    if (old.product.id !== p.product_ref) throw Error("OPERATION_MISMATCH");
    if (await tx.auditLog.findFirst({ where: { ...journal.scope(actor), action: "CONFIRMED", entityId: ref } })) throw Error("ALREADY_CONFIRMED");
    await unchanged(tx, actor, old);
  }
  const fields={ reason: "Ajuste rápido", ...old?.fields, ...Object.fromEntries(Object.entries(p.patch).filter(([,v])=>v!==undefined)) } as z.infer<typeof inventoryPatch>;
  const origin=p.quantity_origin??old?.quantity_origin;
  const resolution=p.quantity_resolution??old?.quantity_resolution;
  if(origin==="CONVERSATION"){
    if(!resolution)throw Error("QUANTITY_PROOF_REQUIRED");
    // Effective quantity is replaced, never recovered from old accepted fields.
    if(resolution.status==="ACCEPTED"){
      if(p.patch.quantity!==undefined&&p.patch.quantity!==resolution.quantity)throw Error("QUANTITY_PROOF_MISMATCH");
      fields.quantity=resolution.quantity;
    }else delete fields.quantity;
  }else if(p.quantity_resolution)throw Error("QUANTITY_ORIGIN_REQUIRED");
  const d = draftSchema.parse({ operation: "stock.movement", draft_ref: ref, draft_revision: (old?.draft_revision ?? 0)+1,
    product: old?.product ?? await getProduct(tx, actor, p.product_ref), fields,
    ...(origin?{quantity_origin:origin,quantity_resolution:resolution}:{}),
    expires_at: old?.expires_at ?? new Date(Date.now()+30*60000).toISOString() });
  if (assess(d).status === "READY") amounts(d);
  await journal.append(tx, actor, "DRAFT", ref, d); return assess(d);
}
/** T30: backend calculation and preview of exactly the approved movement. */
export async function proposeStockMovement(tx: Tx, actor: ServiceActor, input: unknown) {
  await assertInventoryAccess(tx, actor, true);
  const p = proposeServiceInput.parse(input); await journal.lock(tx, actor, p.draft_ref);
  const d = await latest(tx, actor, p.draft_ref); assertCurrent(d, p.draft_revision); assertUnexpired(d.expires_at);
  await unchanged(tx, actor, d); const values = amounts(d);
  const old = await tx.auditLog.findMany({ where: { ...journal.scope(actor), action: "PROPOSAL", entityId: d.draft_ref }, select: { metadata: true } });
  const existing = old.map(r=>proposalSchema.parse(r.metadata)).find(x=>x.draft_revision===d.draft_revision);
  if (existing) { assertUnexpired(existing.expires_at); return existing; }
  const proposal = proposalSchema.parse({ ...d, ...values, proposal_ref: randomUUID(), payload_hash: hash(d),
    preview: `${d.fields.mode === "IN" ? "ENTRADA" : "SAÍDA"} DE ESTOQUE\n${d.product.name}${d.product.active ? "" : " (inativo)"}\nAtual: ${d.product.stock} un\nMovimento: ${values.delta>0?"+":""}${values.delta} un\nProjetado: ${values.projected_stock} un\nMotivo: ${d.fields.reason}`,
    expires_at: new Date(Math.min(Date.parse(d.expires_at), Date.now()+10*60000)).toISOString() });
  await journal.append(tx, actor, "PROPOSAL", d.draft_ref, proposal, proposal.proposal_ref); return proposal;
}
export async function confirmStockMovement(tx: Tx, actor: ServiceActor, input: unknown) {
  return confirmJournalAction<z.infer<typeof draftSchema>, z.infer<typeof proposalSchema>, z.infer<typeof receiptSchema>>(tx, actor, confirmServiceInput.parse(input), {
    journal, proposalAction: "PROPOSAL", confirmedAction: "CONFIRMED", authorize: ()=>assertInventoryAccess(tx, actor, true),
    parseProposal: x=>proposalSchema.parse(x), parseReceipt: x=>receiptSchema.parse(x), latest: ref=>latest(tx, actor, ref), proposalHash: hash, draftHash: hash,
    execute: async (p,d) => {
      await lockProductMutations(tx, [d.product.id]);
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${d.product.id} AND "salonId"=${actor.salonId} FOR UPDATE`;
      await unchanged(tx, actor, d); const values = amounts(d);
      if (values.delta!==p.delta || values.projected_stock!==p.projected_stock) throw Error("PROPOSAL_MISMATCH");
      const result = await adjustProductStockReliably(tx, { salonId: actor.salonId, productId: d.product.id, delta: values.delta,
        userId: actor.userId, actorName: "Equipe autenticada", reason: d.fields.reason!, kind: "ADJUSTMENT" });
      return receiptSchema.parse({ receipt_ref: randomUUID(), proposal_ref: p.proposal_ref, draft_ref: d.draft_ref, draft_revision: d.draft_revision,
        product_ref: d.product.id, previous_stock: result.previousStock, stock: result.newStock, unit: "un" });
    },
  });
}
