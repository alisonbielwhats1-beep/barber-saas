import type { PlanAction } from "@everflair/salon-secretary";
import type { SecretaryView } from "./salon-secretary";
import { formatLocal } from "./secretary-datetime-format";

/** B7: pure display helpers shared by the backend presentation and the chat (no tenant access; client-safe). */

/** First line of the preview of a text Luna drafted (message_mode GENERATED): a suggestion the owner reviews; it is
 * never sent without the explicit confirmation (local fake provider only). */
export const suggestedTextLabel = "Sugestão de texto — revise antes de confirmar";

/** An upcoming appointment of the customer a NEW booking proposal found (C7), journaled beside the proposal. */
export type ExistingBooking = { appointment_ref: string; start_local: string; overlaps: boolean };
/** C7 (review): the customer's upcoming appointments beside a NEW booking, the overlapping one first and marked. Screen
 * only: it is never part of the proposal preview or of the model's context. `excluded`: appointments another action of the
 * same plan cancels or moves (not listed). Empty when none remains. */
export function existingBookingNotice(customer: string, bookings: readonly ExistingBooking[], excluded: ReadonlySet<string> = new Set(), reference?: string) {
  const shown = bookings.filter(item => !excluded.has(item.appointment_ref));
  if (!shown.length) return "";
  const listed = shown.slice(0, 2).map(item => `${formatLocal(item.start_local, reference)}${item.overlaps ? " (mesmo horário)" : ""}`);
  return `\nAtenção: ${customer} já tem ${shown.length > 1 ? "horários marcados" : "horário marcado"}: ${listed.join(" e ")}${shown.length > 2 ? ", entre outros" : ""}. ` +
    "Isto cria um novo agendamento; para mudar o existente, peça para remarcar.";
}

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
/** The display name the backend RESOLVED from the salon's own records for an action's subject, once resolved (a proposal,
 * receipt or located appointment, or an option the owner chose); undefined while only the owner's words exist. The subject
 * follows the confirmation labels: a block's professional, an appointment's customer, a message's recipient, the
 * customer, service or product changed. Never a ref, phone or free text. */
export function resolvedSubject(action: Pick<PlanAction, "operation">, view?: SecretaryView): string | undefined {
  if (!view) return undefined;
  const operation = action.operation;
  if (view.batch && (operation === "appointment.cancel" || operation === "appointment.create")) {
    const snapshot = view.batch.proposal?.snapshot ?? view.batch.draft?.snapshot;
    return text(operation === "appointment.cancel" ? snapshot?.cancel?.customer_name : snapshot?.create?.customer_name);
  }
  const scheduling = view.scheduling ?? (operation === "appointment.cancel" ? view.communication?.cancel : undefined);
  if (scheduling && (operation.startsWith("appointment.") || operation === "schedule.block")) {
    const moved = scheduling.receipt?.action_snapshot ?? scheduling.proposal?.action_snapshot ?? scheduling.draft?.action_snapshot;
    const created = scheduling.receipt?.snapshot ?? scheduling.proposal?.snapshot ?? scheduling.draft?.snapshot;
    // A ref the adapter resolved (single match, keyed by that ref) or the option the owner chose for it.
    const chosen = (role: "customer_name" | "professional_name", ref: "customer_ref" | "professional_ref") => {
      const id = scheduling.fields?.[ref];
      return id ? text(scheduling.resolved_names?.[id]) ?? text(scheduling.selected_names?.[role]) : undefined;
    };
    if (operation === "schedule.block") return text(moved?.professional_name) ?? chosen("professional_name", "professional_ref");
    return text(operation === "appointment.create" ? created?.customer_name : moved?.customer_name ?? created?.customer_name) ?? chosen("customer_name", "customer_ref");
  }
  if (operation === "customer.message") return text(view.communication?.proposal?.recipient?.name ?? view.communication?.draft?.recipient?.name);
  if (operation === "customer.change" || operation === "customer.read") {
    const customer = view.customer;
    return text(customer?.receipt?.customer?.name ?? customer?.proposal?.change?.before?.name ?? customer?.draft?.change?.before?.name ?? customer?.customer?.name ?? (customer?.target ? customer.selected_name : undefined));
  }
  if (operation === "service.change") return text(view.receipt?.service?.name ?? view.proposal?.change?.before?.name ?? view.draft?.change?.before?.name);
  if (operation === "stock.movement" || operation === "stock.balance") return text(view.inventory?.proposal?.product?.name ?? view.inventory?.draft?.product?.name);
  return undefined;
}
