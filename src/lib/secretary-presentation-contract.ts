import { createHash } from "node:crypto";
import { temporalFieldLabels, schedulingMissingLabels, confirmInstruction, unprovenServiceQuestion } from "./secretary-scheduling";
import { appointmentCreatePreview } from "./scheduling-actions";
import { schedulingActionPreview, actionSnapshot } from "./scheduling-mutations";
import { blockedPlanCodes, blockedPlanMessage } from "./scheduling-batch";
import { deferredReadPreview } from "./secretary-action-plan";
import { channelQuestion, contentQuestion } from "./secretary-communication";
import { suggestedTextLabel } from "./secretary-display";
import { expiredProposalMessage } from "./secretary-proposal-lifetime";

/** Review (C6 × backend text): the contract version hashes the model's templates and wire, but the backend also writes
 * text the model reads as DATA: field labels of its questions, proposal previews (an action's previous_response), the
 * line after a proposal, deferred-read and blocked-plan sentences, the message questions. This digest renders those
 * presentation templates on fixed synthetic inputs, so a change of their wording changes secretaryContractVersion
 * (secretaryContractParts `presentation`). Digits and weekday abbreviations are masked and spaces normalized: the
 * template, not the calendar, the year or the ICU version, is what is hashed. Per-turn data never enters it. */
export function backendPresentationTexts() {
  const year = new Date().getFullYear(), at = (day: string, time: string) => `${year}-${day}T${time}`;
  const base = { timezone: "America/Sao_Paulo", services: [{ id: "«serviço»", name: "«serviço»", durationMin: 60, priceCents: 8000, priceType: "FIXED", priceNote: null, processingMin: 0, finishingMin: 0 }], resource_ids: [], waiting_count: 0,
    waiting_hash: "", requires_acceptance: false, affected: [] as { id: string; version: number; name: string; startLocal: string }[] };
  const person = { appointment_ref: "«ref»", revision: 1, customer_ref: "«ref»", customer_name: "«cliente»", professional_ref: "«ref»", professional_name: "«profissional»",
    before_start: at("06-15", "10:00"), before_end: at("06-15", "11:00"), before_timezone: "America/Sao_Paulo", priceCents: 8000 };
  const snapshots = [
    { ...base, ...person, kind: "appointment.change", startLocal: at("06-16", "14:00"), endLocal: at("06-16", "15:00") },
    { ...base, ...person, kind: "appointment.change", startLocal: at("06-16", "14:00"), endLocal: at("06-16", "15:00"), requires_acceptance: true, waiting_count: 2 },
    { ...base, ...person, kind: "appointment.cancel", startLocal: at("06-15", "10:00"), endLocal: at("06-15", "11:00"), waiting_count: 1 },
    { ...base, kind: "schedule.block", professional_ref: "«ref»", professional_name: "«profissional»", startLocal: at("06-17", "09:00"), endLocal: at("06-17", "12:00") },
    { ...base, kind: "schedule.block", professional_ref: "«ref»", professional_name: "«profissional»", startLocal: at("06-17", "09:00"), endLocal: at("06-18", "12:00"),
      affected: [{ id: "«ref»", version: 1, name: "«cliente»", startLocal: at("06-17", "10:00") }] },
  ].map(item => actionSnapshot.parse(item));
  const create = { customer_name: "«cliente»", service_name: "«serviço»", professional_name: "«profissional»", startLocal: at("06-15", "10:00"), endLocal: at("06-15", "10:45"), priceCents: 8000 };
  return {
    labels: Object.fromEntries(["appointment.create", "appointment.change", "appointment.cancel", "appointment.read", "appointment.list", "availability.get", "schedule.block"]
      .map(operation => [operation, temporalFieldLabels(operation)])),
    missing: schedulingMissingLabels, confirm: confirmInstruction, unprovenService: unprovenServiceQuestion,
    previews: [appointmentCreatePreview({ ...create, priceType: "FIXED" }), appointmentCreatePreview({ ...create, priceType: "FROM", overbook: { reason: "«motivo»", conflict_hash: "" } }),
      ...snapshots.map(item => schedulingActionPreview(item, "«motivo»"))],
    deferred: [deferredReadPreview({ depends_on: ["a"] }), deferredReadPreview({ depends_on: ["a", "b"] })],
    blocked: [...blockedPlanCodes, "«outro»"].map(blockedPlanMessage),
    communication: { channel: channelQuestion, content: [contentQuestion(false), contentQuestion(true)], suggested: suggestedTextLabel },
    expired: expiredProposalMessage,
  };
}
const mask = (text: string) => text.replace(/[\u00a0\u202f]/g, " ").replace(/\b(?:dom|seg|ter|qua|qui|sex|s[áa]b)\.?(?=,)/giu, "«d»").replace(/\d/g, "0");
/** sha256 of the canonical rendering, each text masked (before JSON escaping, so a weekday after a line break is masked too). */
export const presentationDigest = (texts: unknown = backendPresentationTexts()) => createHash("sha256").update(JSON.stringify(texts, (_key, value) => typeof value === "string" ? mask(value) : value)).digest("hex");
let memo: string | undefined;
/** The backend presentation digest (memoized: its inputs are code constants). */
export const backendPresentationDigest = () => memo ??= presentationDigest();
