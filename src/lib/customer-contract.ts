import { z } from "zod";
import { isValidPhoneBR } from "./phone";

// Administrative customer registration: phone/email are optional (public signup differs).
export const customerFields = {
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(32).refine(isValidPhoneBR, "Telefone inválido").nullable(),
  email: z.string().trim().email().max(320).nullable(),
};
export const customerPatch = z.object(customerFields).partial().strict();
export const customerInput = customerPatch.extend({ name: customerFields.name });
export const customerDTO = z.object({ id: z.string(), name: z.string(), phone: z.string().nullable(), email: z.string().nullable() }).strict();
export type CustomerPatch = z.infer<typeof customerPatch>;
export type CustomerDTO = z.infer<typeof customerDTO>;
/** Presentation whitelist only: database reads still use the fixed T02 DTO.
 * A read projection is not a mutation mask or a caller-controlled SQL select. */
export const customerReadField = z.enum(["name", "phone", "email"]);
export const customerReadProjection = z.array(customerReadField).max(3).transform(fields => [...new Set(fields)]);
export type CustomerReadField = z.infer<typeof customerReadField>;
export const customerOperation = z.enum(["customer.create", "customer.change"]);
export function customerRequirements(operation: "customer.create" | "customer.change") {
  return { operation, requirements_version: "customer-v1", required_fields: operation === "customer.create" ? ["name"] : [],
    patch_fields: ["name", "phone", "email"], clearable_fields: ["phone", "email"], photo_enabled: false,
    backend_customer_resolution_required: operation === "customer.change", nonempty_patch_required: true };
}
