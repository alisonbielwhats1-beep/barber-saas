import { communicationRequirements } from "../../packages/salon-secretary/src/communication-skill";
import { inventoryRequirements } from "../../packages/salon-secretary/src/inventory-skill";
import { financialRequirements } from "../../packages/salon-secretary/src/financial-skill";
import { schedulingRequirements, schedulingOperation } from "./scheduling-contract";
import { z } from "zod";
import { customerRequirements } from "./customer-contract";
import { batchRequirements } from "./scheduling-contract";

// One source for the existing form, domain and the narrow service-create MVP.
export const serviceFields = {
  name: z.string().trim().min(2, "Nome muito curto"),
  durationMin: z.number().int().min(5).max(600),
  priceCents: z.number().int().min(0).max(2_147_483_647),
  costCents: z.number().int().min(0).max(2_147_483_647),
  description: z.string().nullable(),
  category: z.string().nullable(),
  imageUrl: z.string().url().or(z.literal("")).nullable(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  priceType: z.enum(["FIXED", "FROM"]),
  priceNote: z.string().trim().max(240).nullable(),
  variantGroup: z.string().trim().max(100).nullable(),
  variantLabel: z.string().trim().max(100).nullable(),
  processingMin: z.number().int().min(0).max(599),
  finishingMin: z.number().int().min(0).max(599),
  physicalResourceId: z.string().nullable(),
};

export const serviceCreateInput = z.object({
  ...serviceFields,
  costCents: serviceFields.costCents.optional(),
  description: serviceFields.description.optional(),
  category: serviceFields.category.optional(),
  imageUrl: serviceFields.imageUrl.optional(),
  colorHex: serviceFields.colorHex.optional(),
  priceType: serviceFields.priceType.optional(),
  priceNote: serviceFields.priceNote.optional(),
  variantGroup: serviceFields.variantGroup.optional(),
  variantLabel: serviceFields.variantLabel.optional(),
  processingMin: serviceFields.processingMin.optional(),
  finishingMin: serviceFields.finishingMin.optional(),
  physicalResourceId: serviceFields.physicalResourceId.optional(),
}).strict();

export const servicePatchInput = z.object(serviceFields).partial().strict();
export type ServiceInput = z.infer<typeof serviceCreateInput>;
export type ServicePatch = z.infer<typeof servicePatchInput>;

export const serviceMvpInput = serviceCreateInput.pick({
  name: true, durationMin: true, priceCents: true,
});
export const serviceMvpPatch = serviceMvpInput.partial().strict();
export type ServiceMvpFields = z.infer<typeof serviceMvpInput>;

export const SERVICE_REQUIREMENTS_VERSION = "service-create-v1";
export function getOperationRequirements(operation: "customer.message"): ReturnType<typeof communicationRequirements>;
export function getOperationRequirements(operation: "stock.movement"): ReturnType<typeof inventoryRequirements>;
export function getOperationRequirements(operation: "financial.report"): ReturnType<typeof financialRequirements>;
export function getOperationRequirements(operation?: "service.create" | "service.change"): ReturnType<typeof serviceRequirements>;
export function getOperationRequirements(operation: "action.batch"): ReturnType<typeof batchRequirements>;
export function getOperationRequirements(operation: "customer.create" | "customer.change"): ReturnType<typeof customerRequirements>;
export function getOperationRequirements(operation: z.infer<typeof schedulingOperation>): ReturnType<typeof schedulingRequirements>;
export function getOperationRequirements(operation: "customer.message" | "stock.movement" | "financial.report" | "action.batch" | "service.create" | "service.change" | "customer.create" | "customer.change" | z.infer<typeof schedulingOperation> = "service.create") {
  if(operation==="customer.message")return communicationRequirements();
  if(operation==="stock.movement")return inventoryRequirements();
  if(operation==="financial.report")return financialRequirements();
  if(operation==="action.batch")return batchRequirements();
  if(schedulingOperation.safeParse(operation).success)return schedulingRequirements(schedulingOperation.parse(operation));
  return operation.startsWith("customer.") ? customerRequirements(operation as "customer.create" | "customer.change") : serviceRequirements(operation as "service.create" | "service.change");
}
function serviceRequirements(operation: "service.create" | "service.change" = "service.create") {
  if (operation === "service.change") return {
    operation, requirements_version: SERVICE_REQUIREMENTS_VERSION,
    required_fields: [] as const, patch_fields: ["name", "priceCents", "durationMin"] as const,
    nonempty_patch_required: true, backend_service_resolution_required: true,
    professional_required: false, duration_bounds: { min: 5, max: 600, integer: true }, defaults: {},
  };
  return {
    operation: "service.create" as const,
    requirements_version: SERVICE_REQUIREMENTS_VERSION,
    required_fields: ["name", "durationMin", "priceCents"] as const,
    professional_required: false,
    duration_bounds: { min: 5, max: 600, integer: true },
    defaults: {},
  };
}

export function assessServiceDraft(fields: Partial<ServiceMvpFields>) {
  const missing_fields = getOperationRequirements().required_fields.filter(
    (key) => fields[key] === undefined,
  );
  return {
    status: missing_fields.length ? "NEEDS_INPUT" as const : "READY" as const,
    missing_fields,
    question: missing_fields.includes("durationMin")
      ? "Qual é a duração do serviço, em minutos?" : null,
  };
}

/** Deliberately bounded demo grammar, not an agent or general NL interpreter. */
export function parseServiceMvpMessage(message: string) {
  const text = z.string().trim().min(1).max(200).parse(message);
  const duration = /^(\d+)\s*minutos?\.?$/i.exec(text);
  if (duration) return serviceMvpPatch.parse({ durationMin: Number(duration[1]) });
  const create = /^cadastre\s+(?:uma?\s+)?(.+?)\s+por\s+R\$\s*(\d+)(?:[,.](\d{1,2}))?\.?$/i.exec(text);
  if (!create) throw new Error("INPUT_NOT_SUPPORTED");
  const name = create[1].charAt(0).toUpperCase() + create[1].slice(1);
  return serviceMvpPatch.parse({
    name,
    priceCents: Number(create[2]) * 100 + Number((create[3] ?? "").padEnd(2, "0")),
  });
}
