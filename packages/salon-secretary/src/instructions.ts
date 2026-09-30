import { turnDiscoveryInstructions, replacedInstruction, publishedOptionIds, withAlterationRule, withReferencesRule } from "./skill-registry";
import { alterAppointmentEnabled } from "./alter-appointment";
import { referencesV2Enabled } from "./same-as";
import { conversationRoutingInstructions, routingRules, jitInstructionsEnabled, type ConversationRoutingContext } from "./conversation-routing";
import { temporalEvidenceInstructions } from "./scheduling-skill";
import { temporalComponentInstructions, legacySelectorExample } from "./temporal-components";

/** C6 (rec 15): the decision-mode prompt, composed once per flag set. Every derivation below is a checked replace
 * (replacedInstruction): a source edit that removes a target fails at module load instead of leaking a rule. */
const replaced = (text: string, edits: readonly (readonly [string, string])[]) => edits.reduce((out, [target, replacement]) => replacedInstruction(out, target, replacement), text);

/** Components mode publishes neither day_offset/weekday selectors: the temporal contract names only what it publishes. */
export const componentsTemporalInstructions = replaced(temporalEvidenceInstructions, [
  ['Ex.: weekday={value:2,literal:"terça"}. ', ''],
  ['source_* identifica origem; date/day_offset/weekday/time, destino; end_*, fim.', 'source_* identifica origem; date/time, destino; end_*, fim.'],
]);

/** State-bound sentences of the temporal and components contracts (exact substrings of the static texts). */
const daypartRule = 'Exceção: pending_temporal_ambiguities com clarification.requested_component=daypart permite selecionar somente um candidato publicado de requested_field. Nesse horário retorne {value:candidato,literal:período atual}, sem repetir campos aceitos.';
const calendarRule = 'pending_calendar_conflicts com requested_component=calendar_reference: escolha somente calendar_date ou stated_weekday publicados para requested_field, usando o seletor correspondente e a resposta atual completa como literal. Não repita ambos nem invente outra data; os demais campos aceitos permanecem.';
const componentsLegacyRule = ' Seletores date/time antigos só respondem a pending_temporal_ambiguities/pending_calendar_conflicts (DATE_CHOICE: date={value:um dos candidates,literal:resposta atual}); stated_weekday vai em components.';

/** JIT: each state-bound rule, stated only while its mode or context is published this turn (see jitAppendix). */
export const jitRules = Object.freeze({
  add: `${routingRules.add} Se o cancelamento está no plano ativo, use ADD com released_slot_of e depends_on na chave publicada dele.`,
  patch: routingRules.patch,
  ambiguousTarget: 'Várias ações abertas e alvo ambíguo: AMBIGUOUS, sem escolher item.',
  discard: `${routingRules.discard} ${routingRules.discardVsCancel}`,
  pendingDiscard: routingRules.pendingDiscard,
  resume: routingRules.resume,
  resumeActive: routingRules.resumeActive,
  clarification: 'Quando houver clarification, use requested_field e previous_response para entender respostas curtas.',
  current: 'Preserve os campos aceitos não corrigidos explicitamente. Retorne somente campos novos/corrigidos, sem repetir o rascunho.',
  choice: routingRules.choice,
  daypart: daypartRule,
  calendar: calendarRule,
  componentsLegacy: 'Seletores date/time antigos só respondem a pendências publicadas.',
  dateChoice: 'DATE_CHOICE: date={value:um dos candidates,literal:resposta atual}.',
  statedWeekday: 'stated_weekday vai em components.',
});
export const JIT_APPENDIX_HEADER = 'Regras do estado atual:';

const decisionCatalog = (components: boolean) => components ? replacedInstruction(turnDiscoveryInstructions, ...legacySelectorExample) : turnDiscoveryInstructions;
/** The stable prefix with JIT on: the whole catalog and every state-free rule (never a mode the state may not publish). */
function jitBase(components: boolean) {
  const catalog = replaced(decisionCatalog(components), [
    ['Pedido suportado, inclusive incompleto, usa NEW/PATCH;', 'Pedido novo suportado, inclusive incompleto, usa NEW;'],
    [' Se o cancelamento está no plano ativo, use ADD com released_slot_of e depends_on na chave publicada dele.', ''],
  ]);
  const routing = '\n' + [`${routingRules.core} ${routingRules.operations}`, replacedInstruction(routingRules.safety, 'preserve a intenção em NEW/PATCH', 'preserve a intenção como operação'),
    routingRules.identify].join('\n') + '\n';
  const temporal = replaced(components ? componentsTemporalInstructions : temporalEvidenceInstructions, [[' ' + daypartRule, ''], ['\n' + calendarRule, '']]);
  return catalog + routing + '\n' + temporal + (components ? '\n' + replacedInstruction(temporalComponentInstructions, componentsLegacyRule, '') : '');
}
const composed = new Map<string, string>();
/** Instructions of a decision-envelope turn (V2 or routed). JIT off: the static prompt with every rule once.
 * `alter` (P2a, flag SALON_SECRETARY_ALTER_APPOINTMENT): the alteration rule replaces the catalog's prohibition.
 * `refs` (P3a, flag SALON_SECRETARY_REFERENCES_V2): the reference rules amend their sentences (withReferencesRule). */
export function decisionInstructions(components: boolean, jit: boolean, alter = alterAppointmentEnabled(), refs = referencesV2Enabled()) {
  const key = `${components}:${jit}${alter ? ':alter' : ''}${refs ? ':refs' : ''}`;
  if (!composed.has(key)) {
    const text = jit ? jitBase(components) :
      decisionCatalog(components) + conversationRoutingInstructions + '\n' + (components ? componentsTemporalInstructions : temporalEvidenceInstructions) + (components ? '\n' + temporalComponentInstructions : '');
    const altered = alter ? withAlterationRule(text) : text;
    composed.set(key, refs ? withReferencesRule(altered) : altered);
  }
  return composed.get(key)!;
}

type ContextAction = { status?: unknown; clarification?: { candidates?: unknown } | null; pending_temporal_ambiguities?: unknown; pending_calendar_conflicts?: unknown };
const list = (value: unknown) => Array.isArray(value) ? value : [];
const kinds = (conflicts: unknown) => new Set(list(conflicts).map(item => (item as { kind?: unknown } | null)?.kind));
/** The state-bound rules of this turn, derived from what the backend publishes (routing context, the isolated
 * adapter's draft, the CURRENT branch). Empty string when none applies. Only for decision-envelope turns. */
export function jitAppendix(context: ConversationRoutingContext | undefined, draft: unknown, options: { current: boolean; components: boolean }) {
  const active = context?.active_plan;
  const actions = list(active?.actions) as ContextAction[];
  const open = actions.filter(action => action.status !== "DONE" && action.status !== "DISCARDED");
  // The isolated adapter (CURRENT) publishes its own clarification in the draft, not in a plan.
  const pending = options.current && draft && typeof draft === "object" ? [draft as ContextAction, ...open] : open;
  const daypart = pending.some(action => list(action.pending_temporal_ambiguities).length > 0);
  const conflicts = pending.flatMap(action => [...kinds(action.pending_calendar_conflicts)]);
  const rules: string[] = [];
  if (active) rules.push(jitRules.add);
  if (open.length) rules.push(jitRules.patch, ...(open.length > 1 ? [jitRules.ambiguousTarget] : []), jitRules.discard);
  if (active?.pending_discard) rules.push(jitRules.pendingDiscard);
  if (context?.suspended_plans?.length) rules.push(jitRules.resume, ...(open.length ? [jitRules.resumeActive] : []));
  if (pending.some(action => action.clarification && typeof action.clarification === "object")) rules.push(jitRules.clarification);
  if (options.current) rules.push(jitRules.current);
  if (open.some(action => publishedOptionIds(action).length)) rules.push(jitRules.choice);
  if (daypart) rules.push(jitRules.daypart);
  if (conflicts.includes("WEEKDAY_DATE_CONFLICT")) rules.push(jitRules.calendar);
  if (options.components && (daypart || conflicts.length)) rules.push(jitRules.componentsLegacy);
  if (conflicts.includes("DATE_CHOICE")) rules.push(jitRules.dateChoice);
  if (options.components && conflicts.includes("WEEKDAY_DATE_CONFLICT")) rules.push(jitRules.statedWeekday);
  return rules.length ? `\n${JIT_APPENDIX_HEADER} ${rules.join(" ")}` : "";
}

/** Instruction text the backend places in `requirements` for plan-level turns (contract text, hashed by the contract
 * version). With JIT on it is not sent: the appendix states the same rules once, bound to the published modes. */
export const CONTINUATION_INSTRUCTION = "Este é um turno sobre o plano existente: pode responder a uma pergunta ou corrigir uma ação já preparada. Para continuação/correção retorne APENAS os deltas explícitos às ações acima, usando seus mesmos item_key e preservando a operação. Não repita campos anteriores. O backend preserva o grafo de dependências. Escolha a decisão e o payload correspondentes conforme o schema do turno, inclusive para novo pedido, adição de ações, descarte de ações do plano, retomada ou conversa casual. Se o alvo for ambíguo, indique ambiguidade sem fabricar ação ou selecionar um alvo.";
export const ROUTED_TURN_INSTRUCTION = "Interprete o turno no contexto dos planos. Pode ser um novo pedido, conversa casual ou retomada. Não execute nada.";
/** Draft of a multi-action continuation. JIT: the routing context already publishes every action in full, so the
 * draft names only the addressed keys instead of repeating their context (state-narrowing, C6). */
export function continuationDraft(actions: readonly { item_key: string }[]) {
  return jitInstructionsEnabled() ? { mode: "CONTINUE_EXISTING_PLAN", item_keys: actions.map(action => action.item_key) } : { mode: "CONTINUE_EXISTING_PLAN", actions };
}
export const continuationRequirements = () => jitInstructionsEnabled() ? {} : { instruction: CONTINUATION_INSTRUCTION };
export const routedTurnRequirements = () => jitInstructionsEnabled() ? {} : { instruction: ROUTED_TURN_INSTRUCTION };
/** Request budget (index.ts): a draft/requirements built for the static prompt, as continuationDraft and the requirement
 * helpers above build them with JIT on. Anything else is returned unchanged. */
export function jitContinuationDraft<T>(draft: T): T {
  const value = draft as { mode?: unknown; actions?: unknown } | null;
  if (!value || typeof value !== "object" || value.mode !== "CONTINUE_EXISTING_PLAN" || !Array.isArray(value.actions) || Object.keys(value).length !== 2) return draft;
  return { mode: "CONTINUE_EXISTING_PLAN", item_keys: value.actions.map(action => (action as { item_key?: unknown })?.item_key) } as T;
}
export function jitRequirements<T>(requirements: T): T {
  const value = requirements as { instruction?: unknown } | null;
  if (!value || typeof value !== "object" || Array.isArray(value) || (value.instruction !== CONTINUATION_INSTRUCTION && value.instruction !== ROUTED_TURN_INSTRUCTION)) return requirements;
  const { instruction: _stated, ...rest } = value;void _stated;
  return rest as T;
}
// Every composition is derived at module load: a drifted replace target fails here, never in a live turn.
for (const components of [false, true]) for (const jit of [false, true]) for (const alter of [false, true]) for (const refs of [false, true]) decisionInstructions(components, jit, alter, refs);
