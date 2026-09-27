import { z } from "zod";
import { inventoryClosedSemanticsV1 } from "./inventory-closed-semantics";

export const inventoryOperation = z.enum(["product.search", "stock.balance", "stock.movement"]);
export const inventoryReference = z.union([
  z.object({kind:z.literal("NAMED"),literal:z.string().min(1).max(300).regex(/\S/)}).strict(),
  z.object({kind:z.literal("CURRENT_FIELD"),literal:z.null()}).strict(),
]);
/** Language-only selectors. Domain references, balances and deltas are backend-owned. */
export const inventoryInterpretation = z.object({
  operation: inventoryOperation.nullable().optional(),
  product_name: z.string().trim().min(1).max(200).nullable().optional().describe("Nome do produto individual, sem quantidade/embalagem. Normalize só plural gramatical; preserve marca, modelo, variante e qualificadores. Nome comercial citado é literal. Backend resolve identidade real."),
  low_stock: z.boolean().nullable().optional(),
  mode: z.enum(["IN", "OUT"]).nullable().optional(),
  quantity: z.number().int().min(1).max(100000).nullable().optional(),
  quantity_evidence: z.string().min(1).max(600).nullable().optional(),
  reason: z.string().trim().min(3).max(300).nullable().optional(),
  reference: inventoryReference.nullable().optional(),
  source_scope:z.string().min(1).max(1000).regex(/\S/).nullable().optional(),
}).strict();
export type InventoryInterpretation = z.infer<typeof inventoryInterpretation>;
/** Transport keeps the interpreted count attached to its complete literal measure. */
export const inventoryQuantityWire = z.object({value:z.number().int().min(1).max(100000),literal:z.string().min(1).max(600).regex(/\S/)}).strict().nullable();
export const inventoryTransportInterpretation = inventoryInterpretation.omit({quantity:true,quantity_evidence:true}).extend({quantity:inventoryQuantityWire.optional()});
/** Structural decoding only. Unit compatibility and literal facts belong to the backend. */
export function decodeInventoryQuantityPayload(input: unknown, strictWire = false): unknown {
  if(!input||typeof input!=="object"||Array.isArray(input))return input;
  const result={...input} as Record<string,unknown>;
  const inventory=Object.prototype.hasOwnProperty.call(result,"quantity")||Object.prototype.hasOwnProperty.call(result,"quantity_evidence");
  if(inventory){
    if(strictWire&&Object.prototype.hasOwnProperty.call(result,"quantity_evidence"))throw Error("INVENTORY_QUANTITY_WIRE_INVALID");
    const value=result.quantity;
    if(value!=null&&typeof value==="object"){
      if(Object.prototype.hasOwnProperty.call(result,"quantity_evidence"))throw Error("INVENTORY_QUANTITY_WIRE_INVALID");
      const parsed=inventoryQuantityWire.parse(value)!;result.quantity=parsed.value;result.quantity_evidence=parsed.literal;
    }else if(strictWire&&value!=null)throw Error("INVENTORY_QUANTITY_WIRE_INVALID");
  }
  for(const key of ["turn","fields","new_request","resume_request","inventory","patches"]){
    if(result[key]&&typeof result[key]==="object")result[key]=decodeInventoryQuantityPayload(result[key],strictWire);
  }
  for(const key of ["patches","operations"]){
    if(Array.isArray(result[key]))result[key]=(result[key] as unknown[]).map(value=>decodeInventoryQuantityPayload(value,strictWire));
  }
  return result;
}
export const inventoryRequirements = () => ({ operation: "stock.movement", tool: "T30", version: "inventory-v1",
  required_fields: ["product", "mode", "quantity"], modes: ["IN", "OUT"], quantity: { integer: true, min: 1, max: 100000 },
  unit: "un", negative_stock_allowed: false, defaults: { reason: "Ajuste rápido", kind: "ADJUSTMENT" }, confirmation_required: true });
/** Open extraction transport is composed with, not substituted for, the audited semantics. */
export const inventorySkill = `${inventoryClosedSemanticsV1}
Transporte e clarificação: quantity no transporte é {value,literal}: literal deve conter a medida completa escrita, com unidade/embalagem ou produto contado e fatores, sem recortar só o número. value é o count literal, nunca uma conversão.
Uma contagem de embalagens fica pendente até o total na unidade real; não repita nem invente esse total. Número curto só responde quantity na unidade publicada pelo contexto vigente.
source_scope cita a ação atual completa, com conectivo inicial; nunca use trecho de outra ação como referência do produto. reference: NAMED/literal=produto completo; CURRENT_FIELD/literal=null responde quantity vinculada pelo contexto. reason cita complemento atual com conectivo. Nunca recorte variante, negação, medida ou fator.`;
