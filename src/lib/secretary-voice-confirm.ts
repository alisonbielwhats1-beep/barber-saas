/** Owner decision of 05/10/2026 (flow window, "voz confirma, com proteção"): what a spoken answer to the confirmation step means.
 * Only a clear confirmation word confirms ("confirma", "pode confirmar", "confirmado"); a refusal or a "wait" never confirms;
 * a bare "sim"/"ok" is not enough (the window asks for "confirma"); anything else is a correction sent to the action. The screen
 * still shows what was heard and counts 3 s with a Cancelar before anything is recorded. */
export type VoiceConfirmIntent = 'confirm' | 'cancel' | 'bare' | 'other';
const CANCEL = /^\s*(n[aã]o|cancel[ae]r?|volt[ae]r?|esper[ae]|par[ae]r?|desist[eo]|deixa)\b/i;
const NEGATION = /\bn[aã]o\b/i;
const CONFIRM = /\bconfirm(a|ar|o|ado|e)?\b/i;
const BARE = /^\s*(sim|isso|ok|okay|pode|beleza|certo)[\s.!,]*$/i;
export function voiceConfirmIntent(text: string): VoiceConfirmIntent {
  if (CANCEL.test(text)) return 'cancel';
  if (CONFIRM.test(text) && !NEGATION.test(text)) return 'confirm';
  if (BARE.test(text)) return 'bare';
  return 'other';
}
/** The wait between a spoken confirmation and the execution, while the screen offers Cancelar. */
export const VOICE_CONFIRM_DELAY_MS = 3_000;
