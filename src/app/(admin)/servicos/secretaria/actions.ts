"use server";
import { revalidatePath } from "next/cache";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { assertSecretaryEnvironment, salonSecretary } from "@/lib/salon-secretary-runtime";
import type { SecretaryView } from "@/lib/salon-secretary";
import { assertSecretaryRolloutAccess } from "@/lib/secretary-rollout";
import { randomUUID } from "node:crypto";
import { assertSecretaryBudget } from "@/lib/secretary-production-pilot";
import { assertCanStartRequest, chargeMessage, chargeRecording, creditsEnabled, secretaryCreditView } from "@/lib/secretary-credits";
import type { CreditView } from "@/lib/secretary-credits-rules";
import type { DictationSuggestion } from "@/lib/secretary-voice-correction";
import { secretaryCopyV2Enabled, secretaryErrorMessage } from "@/lib/secretary-error-copy";

async function context() {
  assertSecretaryEnvironment();
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  assertSecretaryRolloutAccess(ctx);
  return { salonId: ctx.salonId, userId: ctx.userId };
}
/** `copyV2` (flag SALON_SECRETARY_COPY_V2, default off): present only when on, so the chat renders the new copy (an error of a
 * sent message as that turn's reply; a review box only for a real conflict). Absent, every reply is the historical one. */
export type SecretaryReply = { ok: true; state: SecretaryView; copyV2?: true } | { ok: false; error: string; code?: string; copyV2?: true };
type Reply = SecretaryReply;
/** D1: the reattached conversation, or null when there is none to reattach (persisted state off, or nothing open). */
export type CurrentSecretaryReply = { ok: true; state: SecretaryView | null; copyV2?: true } | { ok: false; error: string; code?: string; copyV2?: true };
/** `executing`: a confirmation (an unknown failure there never says that nothing changed). */
async function safely<T = SecretaryView>(fn: () => Promise<T>, options: { executing?: boolean } = {}): Promise<{ ok: true; state: T; copyV2?: true } | { ok: false; error: string; code?: string; copyV2?: true }> {
  const marker = secretaryCopyV2Enabled() ? { copyV2: true as const } : {};
  try { return { ok: true, state: await fn(), ...marker }; }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    // Stable diagnostic codes only: exception text may contain database/provider secrets.
    console.error("SECRETARY_OPERATION_REJECTED", /^[A-Z][A-Z0-9_]{1,79}$/.test(code) ? code : "UNCLASSIFIED_ERROR");
    // ERR-COPY: the code→pt-BR table lives in secretary-error-copy.ts (shared with the no-plan turn and the harnesses).
    const copy = secretaryErrorMessage(code, options);
    return { ok: false, code: copy.code, error: copy.text, ...marker };
  }
}
export async function startSecretary() { return safely(async () => salonSecretary.start(await context(), "auto")); }
/** D1: the actor's latest open conversation (SALON_SECRETARY_PERSISTED_STATE), reattached after a reload or on another
 * worker; null otherwise. Read and authorize only: nothing is sent, selected or confirmed. */
export async function currentSecretary(): Promise<CurrentSecretaryReply> { return safely(async () => salonSecretary.current(await context())); }
/** Owner 05/10 and 06/10: a message is a model call; in the Production pilot the salon's daily and monthly caps are checked first,
 * and with prepaid requests on (SALON_SECRETARY_CREDITS_ENABLED) at least one request must be left. */
async function budgeted() { const actor = await context(); await assertSecretaryBudget(actor); await assertCanStartRequest(actor); return actor; }
/** Owner 06/10: a message that finished takes the real cost of its model calls from the credit (a refusal or a failure is not
 * charged). The reply is never lost to a charging failure; each call is charged once. */
async function charged(actor: { salonId: string; userId: string }, startedAt: Date, view: SecretaryView) {
  try { await chargeMessage(actor, { sessionId: view.sessionId, startedAt }); } catch { console.error("SECRETARY_CREDIT_DEBIT_FAILED"); }
  return view;
}
export async function sendSecretary(input: unknown) {
  return safely(async () => { const actor = await budgeted(), startedAt = new Date(); return charged(actor, startedAt, await salonSecretary.send(actor, input)); });
}
/** Owner, 03/10 ("mandei um oi e demorou cinco segundos"): the first message of a new conversation opens it and is read in the
 * same request, one round trip instead of two. A message that fails closes the conversation it opened (nothing was said in it
 * yet), so a retry opens a fresh one and no empty conversation keeps one of the user's open slots. */
export async function startAndSendSecretary(input: unknown) {
  return safely(async () => {
    // The first message is a model call too: the caps are checked before the conversation opens.
    const actor = await budgeted(), startedAt = new Date();
    const opened = await salonSecretary.start(actor, "auto");
    const fields = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    try { return await charged(actor, startedAt, await salonSecretary.send(actor, { ...fields, sessionId: opened.sessionId })); }
    catch (error) {
      await Promise.resolve().then(() => salonSecretary.cancel(actor, opened.sessionId)).catch(() => undefined);
      throw error;
    }
  });
}
export async function selectSecretaryService(sessionId: string, serviceRef: string) {
  return safely(async () => salonSecretary.selectService(await context(), sessionId, serviceRef));
}
export async function confirmSecretary(sessionId: string, input: unknown) {
  return safely(async () => {
    const result = await salonSecretary.confirm(await context(), sessionId, input);
    return refreshConfirmedState(result);
  }, { executing: true });
}
export async function cancelSecretary(sessionId: string) { return safely(async () => salonSecretary.cancel(await context(), sessionId)); }

export async function selectSecretaryCustomer(sessionId: string, customerRef: string) { return safely(async () => salonSecretary.selectCustomer(await context(), sessionId, customerRef)); }

export async function selectSecretaryOperation(sessionId: string, operationRef: string, ref: string) {
  return safely(async()=>salonSecretary.selectAutomatic(await context(),sessionId,operationRef,ref));
}
/** B4: one time-slot option the backend offered for this action (positional id, plan revision shown).
 * Prepares the proposal again with that clock; never confirms, never calls the model. */
export async function selectSecretaryOption(sessionId: string, operationRef: string, optionId: string, revision?: number) {
  return safely(async()=>salonSecretary.selectOption(await context(),sessionId,{operation_ref:operationRef,option_id:optionId,...(revision===undefined?{}:{revision})}));
}
export async function confirmSecretaryOperation(sessionId: string, operationRef: string, input: unknown) {
  return safely(async()=>{
    const state=await salonSecretary.confirmAutomatic(await context(),sessionId,operationRef,input);
    return refreshConfirmedState(state);
  }, { executing: true });
}
/** A discard refused because the action already ran gets its own code: ALREADY_CONFIRMED elsewhere
 * (confirm/draft flows) keeps its conservative generic handling. */
const discarding = (work: () => Promise<SecretaryView>) => async () => {
  try { return await work(); }
  catch (error) { throw error instanceof Error && error.message === "ALREADY_CONFIRMED" ? Error("DISCARD_ALREADY_CONFIRMED") : error; }
};
export async function cancelSecretaryOperation(sessionId: string, operationRef: string) {
  return safely(discarding(async()=>salonSecretary.cancelAutomaticOperation(await context(),sessionId,operationRef)));
}
/** "Descartar esta ação": {plan_ref, action_key} of the current plan. Withdraws only; never confirms or executes. */
export async function discardSecretaryAction(sessionId: string, input: unknown) {
  return safely(discarding(async () => salonSecretary.discardAction(await context(), sessionId, input)));
}

/** Transport only: the validated coordinator remains the sole group authority. */
export async function confirmSecretaryGroup(sessionId: string, input: unknown) {
  return safely(async () => {
    const state = await salonSecretary.confirmActionPlanGroup(await context(), sessionId, input);
    return refreshConfirmedState(state);
  }, { executing: true });
}
/** Transport only: every current group approval in one call; the coordinator validates all before executing any. */
export async function confirmSecretaryReadyGroups(sessionId: string, approvals: unknown) {
  return safely(async () => {
    const state = await salonSecretary.confirmReadyGroups(await context(), sessionId, approvals);
    return refreshConfirmedState(state);
  }, { executing: true });
}

async function refreshConfirmedState(state: SecretaryView) {
  const views = [state, ...(state.operations?.map(operation => operation.state) ?? [])];
  if (!views.some(view => view.receipt || view.customer?.receipt || view.scheduling?.receipt || view.inventory?.receipt || view.batch?.receipt || view.communication?.receipt)) return state;
  try {
    for (const route of ["/servicos", "/produtos", "/clientes", "/agenda", "/financeiro", "/hoje", "/notificacoes"]) revalidatePath(route);
    revalidatePath("/book/[salonSlug]", "layout");
  } catch { return { ...state, execution_warnings: [...(state.execution_warnings ?? []), "VIEW_REFRESH_UNAVAILABLE"] }; }
  return state;
}

export async function resumeSecretaryPlan(sessionId: string, planRef: string): Promise<Reply> {
  return safely(async () => salonSecretary.resumePlan(await context(), sessionId, planRef));
}

export type FeedbackReply = { ok: true } | { ok: false; error: string; code?: string };
/** B7 owner feedback (SALON_SECRETARY_FEEDBACK, default off): "Não era isso" on the latest reply. The actor comes from
 * authentication; codes come from the server's own record of the session; the conversation text is stored only when
 * the owner ticked the checkbox. Never changes the conversation or anything in the salon. */
export async function sendSecretaryFeedback(input: unknown): Promise<FeedbackReply> {
  const feedback = await import("@/lib/secretary-feedback");
  if (!feedback.secretaryFeedbackEnabled()) return { ok: false, code: "FEEDBACK_DISABLED", error: "O envio de avaliação da Secretária não está habilitado." };
  try {
    const actor = await context();
    const parsed = feedback.feedbackInput.safeParse(input);
    if (!parsed.success) throw Error("FEEDBACK_INVALID");
    // D1: with persisted state the codes are the ones saved with the conversation (this process may hold no copy).
    const recorded = salonSecretary.feedbackContext(actor, parsed.data.sessionId) ?? await salonSecretary.storedFeedbackContext?.(actor, parsed.data.sessionId);
    await feedback.storeSecretaryFeedback(actor, parsed.data, recorded);
    return { ok: true };
  } catch (error) {
    const code = voiceCode(error);
    console.error("SECRETARY_FEEDBACK_REJECTED", code);
    return { ok: false, code: code === "FEEDBACK_INVALID" || code === "SECRETARY_NOT_AVAILABLE" || code === "FEEDBACK_RATE_LIMITED" ? code : "FEEDBACK_FAILED",
      error: code === "FEEDBACK_INVALID" ? "Não foi possível registrar a avaliação. Revise o texto e tente novamente."
        : code === "SECRETARY_NOT_AVAILABLE" ? "A Secretária não está habilitada para este acesso."
        : code === "FEEDBACK_RATE_LIMITED" ? "Você já enviou muitas avaliações em pouco tempo. Tente novamente em alguns minutos."
        : "Não foi possível registrar a avaliação agora. A conversa não foi alterada." };
  }
}

/** Salon directory names only (professionals and services, never customers), for voice input. */
async function voiceVocabulary(actor: { salonId: string; userId: string }) {
  const [{ withTenant }, { secretaryDirectory }, { voiceCustomerNames }] = await Promise.all([import("@/lib/prisma-tenant"), import("@/lib/scheduling-catalog"), import("@/lib/secretary-voice-customers")]);
  const directory = await withTenant(actor, tx => secretaryDirectory(tx, actor));
  // Owner 05/10 (flag SALON_SECRETARY_TRANSCRIBE_CUSTOMER_NAMES): customers with an appointment around today, names only.
  const customers = await withTenant(actor, tx => voiceCustomerNames(tx, actor));
  return { professionals: directory.professionals, services: directory.services, ...(customers.length ? { customers } : {}) };
}
const voiceCode = (error: unknown) => { const code = error instanceof Error ? error.message : ""; return /^[A-Z][A-Z0-9_]{1,79}$/.test(code) ? code : "UNCLASSIFIED_ERROR"; };
export type DictationReply = { ok: true; suggestions: DictationSuggestion[] } | { ok: false; error: string; code?: string };
/** C3 voice (SALON_SECRETARY_VOICE_CORRECTION, default off): correction suggestions for a dictated text. Input only:
 * nothing is replaced, sent or confirmed here. */
export async function suggestSecretaryDictation(text: unknown): Promise<DictationReply> {
  const { voiceCorrectionEnabled, dictationSuggestions } = await import("@/lib/secretary-voice-correction");
  if (!voiceCorrectionEnabled()) return { ok: true, suggestions: [] };
  try {
    const actor = await context();
    if (typeof text !== "string" || text.length > 1000) throw new Error("INVALID_INPUT");
    const vocabulary = await voiceVocabulary(actor);
    return { ok: true, suggestions: dictationSuggestions(text, [...vocabulary.professionals, ...vocabulary.services]) };
  } catch (error) {
    console.error("SECRETARY_VOICE_CORRECTION_REJECTED", voiceCode(error));
    return { ok: false, code: voiceCode(error), error: "Sugestões de correção indisponíveis. Revise o texto antes de enviar." };
  }
}
export type TranscriptionReply = { ok: true; text: string } | { ok: false; error: string; code?: string };
/** C3 voice, GPT transcription (SALON_SECRETARY_TRANSCRIBE_ENABLED, default off; on in the local demo since 03/10/2026).
 * One recording → text for the input box; never sends or confirms. The reported usage is settled after the call. */
export async function transcribeSecretaryVoice(form: FormData): Promise<TranscriptionReply> {
  const transcription = await import("@/lib/secretary-transcribe");
  // Arrival, in numbers only: a recording that never shows here never left the browser.
  const sent = form.get("audio");
  console.info("SECRETARY_TRANSCRIBE_RECEIVED", JSON.stringify({ audio_bytes: sent instanceof Blob ? sent.size : 0, seconds: Number(form.get("seconds")) || 0 }));
  if (!transcription.transcribeEnabled()) return { ok: false, code: "TRANSCRIBE_DISABLED", error: "A transcrição da Secretária está desligada. Você pode digitar." };
  // Owner, 03/10 ("demora para transcrever"): how long each step took, in numbers only (never the audio or its text).
  const started = performance.now(), timing: Record<string, number> = {};
  const timed = async <T,>(stage: string, work: () => Promise<T>) => {
    const at = performance.now();
    try { return await work(); } finally { timing[stage] = Math.round(performance.now() - at); }
  };
  try {
    const actor = await timed("auth_ms", budgeted);
    const seconds = Number(form.get("seconds")), { withTenant } = await import("@/lib/prisma-tenant");
    const directory = await timed("vocabulary_ms", () => voiceVocabulary(actor));
    return { ok: true, ...(await timed("pipeline_ms", () => transcription.transcribeSecretaryAudio({ audio: form.get("audio"), seconds, directory,
      reserve: reservation => timed("reserve_ms", () => withTenant(actor, tx => transcription.reserveTranscriptionBudget(tx, actor, reservation))),
      settle: settlement => timed("settle_ms", async () => {
        await withTenant(actor, tx => transcription.settleTranscriptionUsage(tx, actor, settlement));
        // Owner 06/10: a recording takes its real cost from the credit, sent or not (a failed charge never loses the text).
        try { await chargeRecording(actor, { recordingKey: settlement.reservationId ?? randomUUID(), microUsd: settlement.actualMicroUsd ?? settlement.reservedMicroUsd }); }
        catch { console.error("SECRETARY_CREDIT_DEBIT_FAILED"); }
      }) }))) };
  } catch (error) {
    const code = voiceCode(error);
    console.error("SECRETARY_TRANSCRIBE_REJECTED", code);
    const messages: Record<string, string> = {
      TRANSCRIBE_AUDIO_TOO_LARGE: "A gravação ficou grande demais. Grave uma fala mais curta ou digite.",
      TRANSCRIBE_AUDIO_TOO_LONG: "A gravação passou de 1 minuto. Grave uma fala mais curta ou digite.",
      TRANSCRIBE_EMPTY: "Nenhuma fala foi reconhecida. Grave novamente ou digite.",
      TRANSCRIBE_BUDGET: "O limite de gasto da transcrição foi atingido. Você pode digitar.",
      TRANSCRIBE_DISABLED: "A transcrição da Secretária está desligada. Você pode digitar.",
      SECRETARY_CREDITS_EMPTY: "O crédito da Secretária acabou. O dono pode recarregar em Plano e assinatura.",
    };
    return { ok: false, code, error: messages[code] ?? "Não foi possível transcrever. Seu texto foi preservado; você pode digitar." };
  } finally {
    const audio = form.get("audio"), pipeline = timing.pipeline_ms;
    // The provider's share is the pipeline minus the two budget transactions (the local checks take well under 1 ms).
    console.info("SECRETARY_TRANSCRIBE_TIMING", JSON.stringify({ ...timing,
      ...(pipeline === undefined ? {} : { provider_ms: pipeline - (timing.reserve_ms ?? 0) - (timing.settle_ms ?? 0) }),
      total_ms: Math.round(performance.now() - started), audio_bytes: audio instanceof Blob ? audio.size : 0, seconds: Number(form.get("seconds")) || 0 }));
  }
}
export type CreditsReply = { ok: true; enabled: false } | { ok: true; enabled: true; view: CreditView; canRecharge: boolean } | { ok: false };
/** Owner 06/10: the Secretária's balance for the bar at the top of the chat (every role sees the number; only the owner
 * recharges, in Plano e assinatura). Read only. */
export async function secretaryCredits(): Promise<CreditsReply> {
  if (!creditsEnabled()) return { ok: true, enabled: false };
  try {
    const actor = await context(), { role } = await getTenantContext();
    return { ok: true, enabled: true, view: await secretaryCreditView(actor), canRecharge: role === "OWNER" };
  } catch (error) { console.error("SECRETARY_CREDITS_VIEW_REJECTED", voiceCode(error)); return { ok: false }; }
}
