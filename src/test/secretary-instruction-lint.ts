import { createPaidModel, runServicesTurn, withConversationRouting, withSalonDirectory, withRequestBudgetObserver, continuationDraft, continuationRequirements,
  type ConversationRoutingContext, type Model, type RequestBudgetTelemetry, type SalonDirectory, type SecretarySkill, type SecretaryWireSchema } from '@everflair/salon-secretary';
import { entityExtractionInstructions } from '../../packages/salon-secretary/src/entity-extraction';
import { getOperationRequirements } from '../lib/service-contract';
import { expandedWire } from './secretary-wire-schema';

/** C6 (rec 15): offline lint of what Luna actually receives. Each state is compiled through the real SDK
 * serialization with a fake transport (never the network); the rule text (instructions, the system template
 * sentences, the JIT appendix, instruction strings inside requirements and the wire descriptions) is checked for
 * duplicated rules, names of modes/fields not published in that state, V1-only phrases and enumerated contradictions. */
export type LintState = { name: string; skill: SecretarySkill | 'discovery'; context?: ConversationRoutingContext;
  /** Functions (fields and requirements) are evaluated under the compiled flags, as the backend builds them per turn. */
  fields?: unknown;
  /** A function is evaluated under the compiled flags, as the backend builds requirements per turn. */
  requirements?: unknown };
/** `bytes`: the body actually sent. Request budget: `configuredBytes` is the request as the flags configure it (equal to
 * `bytes` unless it did not fit the cap and was degraded; `budget` then carries the degradation codes). */
export type CompiledRequest = { state: string; env: Record<string, string>; instructions: string; system: string; draft: string; wire: SecretaryWireSchema; bytes: number;
  configuredBytes: number; budget?: RequestBudgetTelemetry };
export type LintFinding = { state: string; flags: string; code: 'DUPLICATE_RULE' | 'RULE_COUNT' | 'UNPUBLISHED_REFERENCE' | 'V1_PHRASE' | 'CONTRADICTION'; detail: string };

const MODES = ['NEW', 'ADD', 'PATCH', 'RESUME', 'DISCARD', 'CURRENT', 'CONVERSATION', 'UNSUPPORTED', 'AMBIGUOUS'] as const;
/** Names the decoders still read but the V2 decision wire never publishes (V1 envelope and transport provenance). */
export const DECODER_ONLY_NAMES = ['disposition', 'conversation_response', 'independent', 'skills', 'temporal_evidence', 'quantity_evidence',
  'new_request', 'new_request_mode', 'resume_request', 'discard_request', 'temporal_negative_context', 'day_offset', 'weekday', 'source_day_offset', 'source_weekday'];
export const V1_PHRASES = ['Até quatro operações', 'retorne operations=[]', 'disposition=', 'conversation_response', 'independent=true', 'independent=false',
  'skills=[]', 'Selecione todas e somente as Skills', 'unavailable_capability=null', 'exatamente duas operações', 'Em SUPPORTED'];
/** Rules that cannot hold together in one prompt (enumerated from the rule set, including its V1/V2 and components variants). */
export const CONTRADICTIONS: readonly [RegExp, RegExp][] = [
  [/Até quatro operações/, /Não há limite de quatro/],
  [/retorne operations=\[\]/, /Retorne todas as operações explícitas/],
  [/independent=true/, /O backend deriva a independência/],
  [/Selecione todas e somente as Skills/, /O backend deriva todas e somente as Skills/],
  [/disposition=/, /turn\.mode=/],
  [/não calcule datas/, /date value YYYY-MM-DD|use day_offset|(?:day_offset|weekday)=\{value/],
  [/Datas e horas vão em components/, /Para hoje\/amanhã\/depois de amanhã use day_offset/],
  [/Não copie data\/hora\/serviço\/profissional para a criação dependente/, /preserve o serviço explicitamente informado/],
  [/exatamente duas operações Scheduling/, /São permitidas cadeias/],
];
export type StateFacts = { active: boolean; open: boolean; suspended: boolean; candidates: boolean; daypart: boolean; calendar: boolean; pendingDiscard: boolean; clarification: boolean; components: boolean; jit: boolean };
/** Registered rules: how many times each may appear in one compiled prompt. The static prompt (JIT off) states
 * each rule once for every state; with the JIT appendix a state-bound rule appears exactly when its state holds. */
export const RULES: readonly { id: string; pattern: RegExp; expected: (f: StateFacts) => number }[] = [
  { id: 'NEGATION', pattern: /Nunca transforme uma negação em operação afirmativa/g, expected: () => 1 },
  { id: 'ENTITY_EXTRACTION', pattern: new RegExp(entityExtractionInstructions.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), expected: () => 1 },
  { id: 'ONE_DATE_SELECTOR', pattern: /só um seletor de data por papel/gi, expected: () => 1 },
  { id: 'TEMPORAL_ROLES', pattern: /source_\*\s*(?:é|identifica|=)\s*origem/gi, expected: () => 1 },
  { id: 'PERIOD_WITHOUT_CLOCK', pattern: /período (?:sem relógio|sozinho)/gi, expected: () => 1 },
  { id: 'LITERAL_EXACT_COPY', pattern: /Copie literal EXATAMENTE/g, expected: () => 1 },
  { id: 'CHANGE_IS_SUPPORTED', pattern: /appointment\.change[^.]{0,40}(?:SUPORTADO|para remarcação)/g, expected: () => 1 },
  { id: 'DAYPART_ANSWER', pattern: /requested_component=daypart/g, expected: f => !f.jit || f.daypart ? 1 : 0 },
  { id: 'CALENDAR_ANSWER', pattern: /requested_component=calendar_reference/g, expected: f => !f.jit || f.calendar ? 1 : 0 },
  { id: 'OPTION_CHOICE', pattern: /choice=\{option_id,literal\}/g, expected: f => !f.jit || f.candidates ? 1 : 0 },
  { id: 'SHORT_ANSWERS', pattern: /respostas curtas/g, expected: f => !f.jit || f.clarification ? 1 : 0 },
  { id: 'PENDING_DISCARD', pattern: /pending_discard aceito/g, expected: f => !f.jit || f.pendingDiscard ? 1 : 0 },
  { id: 'ADD_MODE', pattern: /ADD acrescenta/g, expected: f => !f.jit || f.active ? 1 : 0 },
  { id: 'PATCH_MODE', pattern: /PATCH é o único formato/g, expected: f => !f.jit || f.open ? 1 : 0 },
  { id: 'DISCARD_MODE', pattern: /DISCARD desiste/g, expected: f => !f.jit || f.open ? 1 : 0 },
  { id: 'RESUME_MODE', pattern: /RESUME usa exclusivamente/g, expected: f => !f.jit || f.suspended ? 1 : 0 },
  { id: 'COMPONENTS_LEGACY_SELECTORS', pattern: /Seletores date\/time antigos só respondem/g, expected: f => !f.components ? 0 : !f.jit || f.daypart || f.calendar ? 1 : 0 },
];

function withEnv<T>(env: Record<string, string>, work: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  return work().finally(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}
/** The exact Responses body of one Secretary request, through the real SDK, with a fake transport. */
export async function compileRequest(state: LintState, env: Record<string, string>, directory?: SalonDirectory, message = 'Pedido sintético offline'): Promise<CompiledRequest> {
  const flags = { SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS: '8192', SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_TEMPORAL_COMPONENTS: 'false', SALON_SECRETARY_JIT_INSTRUCTIONS: 'false', SALON_SECRETARY_EXAMPLES: 'off', ...env };
  return withEnv(flags, async () => {
    let body = '';
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body);
      const name = (JSON.parse(body) as { tools: { name: string }[] }).tools[0].name;
      return new Response(JSON.stringify({ id: 'resp_offline', object: 'response', created_at: 0, status: 'completed', model: 'gpt-6-luna',
        output: [{ id: 'fc_offline', call_id: 'call_offline', type: 'function_call', name, arguments: JSON.stringify({ turn: { mode: 'CONVERSATION', response: 'Oi!' } }), status: 'completed' }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    let budget: RequestBudgetTelemetry | undefined;
    try {
      const model = await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-offline-not-a-key', SALON_SECRETARY_OPENAI_PROJECT: 'proj_offline' });
      const turn = () => (runServicesTurn as (m: Model, msg: string, fields: unknown, req: unknown, skill: SecretarySkill | 'discovery', v2: boolean) => Promise<unknown>)(model, message, (typeof state.fields === 'function' ? state.fields() : state.fields) ?? {}, (typeof state.requirements === 'function' ? state.requirements() : state.requirements) ?? {}, state.skill, true);
      const routed = () => state.context ? withConversationRouting(turn, state.context) : turn();
      await withRequestBudgetObserver(entry => { budget = entry; }, () => (directory ? withSalonDirectory(directory, routed) : routed()).catch(() => undefined));
    } finally { globalThis.fetch = original; }
    if (!body) throw Error((budget && !budget.fit ? 'LINT_REQUEST_TOO_LARGE:' : 'LINT_NO_REQUEST:') + state.name);
    const payload = JSON.parse(body) as { instructions: string; input: { content: string }[]; tools: { parameters: SecretaryWireSchema }[] };
    const bytes = Buffer.byteLength(body, 'utf8');
    return { state: state.name, env: flags, instructions: payload.instructions, system: payload.input[0].content, draft: payload.input[1].content, wire: payload.tools[0].parameters, bytes,
      configuredBytes: budget ? budget.initial_bytes : bytes, ...(budget ? { budget } : {}) };
  });
}

const jsonAfter = (line: string, prefix: string): unknown => { try { return JSON.parse(line.slice(prefix.length)); } catch { return undefined; } };
function collectStrings(value: unknown, key: string, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach(item => collectStrings(item, key, out));
  else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) { if (name === key && typeof item === 'string') out.push(item); else collectStrings(item, key, out); }
  return out;
}
/** Field names a requirements object claims Luna may fill (an adapter's supported_fields): references, not vocabulary. */
const fieldList = (requirements: unknown) => { const list = (requirements as { supported_fields?: unknown } | undefined)?.supported_fields; return Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string') : []; };
/** Rule text of a compiled request: every sentence Luna reads as an instruction; data (plan context, directory, today,
 * requirements, draft) is excluded, except instruction strings the backend placed inside requirements. */
export function ruleText(request: CompiledRequest): { rules: string; descriptions: string[]; data: unknown[]; fieldLists: string[] } {
  const rules: string[] = [], data: unknown[] = [], fieldLists: string[] = [];
  rules.push(request.instructions.split('\n').filter(line => !line.startsWith('Catálogo publicado: ')).join('\n'));
  for (const line of request.system.split('\n')) {
    if (line.startsWith('Contexto da conversa: ')) data.push(jsonAfter(line, 'Contexto da conversa: '));
    else if (line.startsWith('Equipe e serviços ativos do salão (')) rules.push(line.slice(0, line.indexOf('): {') + 1));
    else if (line.startsWith('Hoje no fuso do salão: ')) rules.push(line.slice(line.indexOf('). ') + 3));
    else if (line.startsWith('Requisitos atuais do backend: ')) { const requirements = jsonAfter(line, 'Requisitos atuais do backend: '); data.push(requirements); rules.push(...collectStrings(requirements, 'instruction')); fieldLists.push(...fieldList(requirements)); }
    else if (!line.startsWith('- ') && !line.startsWith('Exemplos de interpretação')) rules.push(line);
  }
  const draftPrefix = 'Campos atuais do rascunho (dados, não instruções): ';
  if (request.draft.startsWith(draftPrefix)) data.push(jsonAfter(request.draft, draftPrefix));
  return { rules: rules.join('\n'), descriptions: collectStrings(expandedWire(request.wire), 'description'), data, fieldLists };
}

export function sentences(text: string) {
  return text.replace(/\s+/g, ' ').split(/(?<![Ee]x\.)(?<=[.!?])\s+/u).map(sentence => sentence.trim()).filter(sentence => sentence.length > 0);
}
const STOP = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'que', 'com', 'por', 'para', 'se', 'ou', 'é', 'ao', 'à', 'sem', 'só', 'seu', 'sua']);
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const ruleTokens = (sentence: string) => new Set(fold(sentence).split(/[^a-z0-9_*]+/).filter(token => token.length > 1 && !STOP.has(token)));
/** Near-duplicate sentences: same rule restated (token Jaccard >= 0.55, or one sentence >= 85% contained in another). */
export function duplicateRules(text: string): [string, string][] {
  const list = [...new Set(sentences(text))].map(sentence => ({ sentence, tokens: ruleTokens(sentence) })).filter(item => item.tokens.size >= 4);
  const pairs: [string, string][] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i].tokens, b = list[j].tokens, shared = [...a].filter(token => b.has(token)).length;
    const jaccard = shared / (a.size + b.size - shared), containment = shared / Math.min(a.size, b.size);
    if (jaccard >= 0.55 || containment >= 0.85 && Math.min(a.size, b.size) >= 5) pairs.push([list[i].sentence, list[j].sentence]);
  }
  const exact = sentences(text).filter((sentence, index, all) => ruleTokens(sentence).size >= 3 && all.indexOf(sentence) !== index);
  return [...pairs, ...exact.map(sentence => [sentence, sentence] as [string, string])];
}

/** Names a state publishes: every wire property name and enum value, the modes of its turn branches, and the keys and
 * code-like values of its data (plan context, draft, requirements). */
export function stateVocabulary(request: CompiledRequest): { names: Set<string>; modes: Set<string> } {
  const names = new Set<string>(), modes = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const schema = node as SecretaryWireSchema;
    if (schema.properties) for (const key of Object.keys(schema.properties)) names.add(key);
    if (Array.isArray(schema.enum)) for (const value of schema.enum) if (typeof value === 'string') names.add(value);
    Object.values(schema).forEach(walk);
  };
  const wire = expandedWire(request.wire);
  walk(wire);
  for (const branch of wire.properties?.turn?.anyOf ?? []) for (const mode of branch.properties?.mode?.enum ?? []) modes.add(String(mode));
  const data = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(data); return; }
    if (typeof value === 'string') { if (/^[A-Za-z][A-Za-z0-9_.]{1,63}$/.test(value)) names.add(value); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) { names.add(key); if (key !== 'supported_fields') data(item); }
  };
  ruleText(request).data.forEach(data);
  return { names, modes };
}
/** Field-like names (snake_case, name= assignments, slash lists, dotted paths) and mode names a text mentions. */
export function mentionedNames(text: string, universe: ReadonlySet<string>) {
  const found = new Set<string>();
  const add = (token: string) => { if (universe.has(token)) found.add(token); };
  for (const match of text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) add(match[0]);
  for (const match of text.matchAll(/\b([a-z][a-z0-9_]*)=/g)) add(match[1]);
  for (const match of text.matchAll(/\b[a-z_]+(?:\/[a-z_*]+)+/g)) match[0].split('/').forEach(add);
  for (const match of text.matchAll(/\b[a-z_]+(?:\.[a-z_]+)+\b/g)) { if (universe.has(match[0])) continue; match[0].split('.').forEach(add); }
  const modes = new Set([...text.matchAll(new RegExp(`\\b(${MODES.join('|')})\\b(?![_A-Za-z])`, 'g'))].map(match => match[1]));
  return { names: found, modes };
}

export function stateFacts(request: CompiledRequest): StateFacts {
  // data = [routing context, requirements, draft] (ruleText order).
  const data = ruleText(request).data, context = data[0] as ConversationRoutingContext | undefined;
  const actions = (context?.active_plan?.actions ?? []) as { status?: string; clarification?: { candidates?: unknown[] }; pending_temporal_ambiguities?: unknown[]; pending_calendar_conflicts?: unknown[] }[];
  const draftText = JSON.stringify(data.slice(1));
  const open = actions.filter(action => action.status !== 'DONE' && action.status !== 'DISCARDED');
  return { active: !!context?.active_plan, open: open.length > 0, suspended: (context?.suspended_plans?.length ?? 0) > 0,
    candidates: open.some(action => (action.clarification?.candidates ?? []).length > 0),
    daypart: open.some(action => (action.pending_temporal_ambiguities ?? []).length > 0) || draftText.includes('"pending_temporal_ambiguities"'),
    calendar: open.some(action => (action.pending_calendar_conflicts ?? []).length > 0) || draftText.includes('"pending_calendar_conflicts"'),
    pendingDiscard: !!context?.active_plan?.pending_discard, clarification: open.some(action => !!action.clarification) || draftText.includes('"clarification"'),
    components: request.env.SALON_SECRETARY_TEMPORAL_COMPONENTS === 'true', jit: request.env.SALON_SECRETARY_JIT_INSTRUCTIONS === 'true' };
}
const flagLabel = (request: CompiledRequest) => `components=${request.env.SALON_SECRETARY_TEMPORAL_COMPONENTS},jit=${request.env.SALON_SECRETARY_JIT_INSTRUCTIONS}`;

/** Lints every compiled request. `universe` = every name any state publishes plus the decoder-only names. With the JIT
 * appendix off the prompt is static: a name is allowed when some state under the same flags publishes it; with it on,
 * only the names of that very state are. */
export function lintRequests(requests: readonly CompiledRequest[]): LintFinding[] {
  const vocab = new Map(requests.map(request => [request, stateVocabulary(request)]));
  const universe = new Set([...DECODER_ONLY_NAMES, ...[...vocab.values()].flatMap(v => [...v.names])]);
  const findings: LintFinding[] = [];
  for (const request of requests) {
    const flags = flagLabel(request), push = (code: LintFinding['code'], detail: string) => findings.push({ state: request.state, flags, code, detail });
    const { rules, descriptions } = ruleText(request), all = [rules, ...descriptions].join('\n'), facts = stateFacts(request);
    for (const phrase of V1_PHRASES) if (all.includes(phrase)) push('V1_PHRASE', phrase);
    for (const [a, b] of CONTRADICTIONS) if (a.test(all) && b.test(all)) push('CONTRADICTION', `${a.source} <> ${b.source}`);
    for (const rule of RULES) { const count = rules.match(rule.pattern)?.length ?? 0, expected = rule.expected(facts); if (count !== expected) push('RULE_COUNT', `${rule.id}: ${count} (expected ${expected})`); }
    for (const [a, b] of duplicateRules(rules)) push('DUPLICATE_RULE', `${a} <> ${b}`);
    const peers = facts.jit ? [request] : requests.filter(other => flagLabel(other) === flags);
    const allowed = new Set(peers.flatMap(peer => [...vocab.get(peer)!.names])), modes = new Set(peers.flatMap(peer => [...vocab.get(peer)!.modes]));
    const mentioned = mentionedNames(all, universe);
    for (const name of mentioned.names) if (!allowed.has(name)) push('UNPUBLISHED_REFERENCE', name);
    for (const name of new Set(ruleText(request).fieldLists)) if (universe.has(name) && !allowed.has(name)) push('UNPUBLISHED_REFERENCE', 'supported_fields:' + name);
    for (const mode of mentioned.modes) if (!modes.has(mode)) push('UNPUBLISHED_REFERENCE', 'mode ' + mode);
  }
  return findings;
}

// ---------------------------------------------------------------- the state matrix
const PLAN = '10000000-0000-4000-8000-000000000001';
const action = (item_key: string, operation: string, extra: Record<string, unknown> = {}, missing: string[] = ['time']) => ({ item_key, operation, status: 'NEEDS_INPUT', depends_on: [],
  fields: { customer_name: 'Pessoa Sintética' }, clarification: { missing_fields: missing, requested_field: missing.length === 1 ? missing[0] : null, previous_response: 'Pergunta sintética' }, ...extra });
const suspended = (index: number) => ({ plan_ref: '20000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'), actions: [action('saved_' + index, 'appointment.change')] });
const stressActions = ['service.create', 'service.change', 'customer.create', 'customer.change', 'appointment.create', 'appointment.change', 'appointment.cancel', 'stock.movement', 'financial.report', 'customer.message']
  .map((operation, i) => ({ item_key: 'item_' + i, operation, status: 'NEEDS_INPUT', depends_on: [], fields: {}, clarification: { missing_fields: [], requested_field: null, previous_response: 'Questão sintética' } }));
export const STRESS_CONTEXT: ConversationRoutingContext = { active_plan: { plan_ref: PLAN, actions: stressActions }, suspended_plans: Array.from({ length: 5 }, (_, i) => ({ plan_ref: '20000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
  actions: stressActions.map(a => ({ ...a, item_key: a.item_key + '_p' + i })) })) };
const daypart = { field: 'time', kind: 'CLOCK_DAYPART', expression: 'quarta às quatro', candidates: ['04:00', '16:00'] };
const calendar = { field: 'date', kind: 'WEEKDAY_DATE_CONFLICT', expression: 'terça, dia 14 de abril de 2027', calendar_date: '2027-04-14', stated_weekday: 2, actual_weekday: 3 };
/** Every routing state whose published modes, fields or state-bound rules differ. */
export const LINT_STATES: readonly LintState[] = [
  { name: 'first-turn', skill: 'discovery' },
  { name: 'adapter-current', skill: 'scheduling', fields: { operation: 'appointment.create', fields: { customer_name: 'Pessoa Sintética' }, clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: 'Qual horário?' } },
    requirements: () => getOperationRequirements('appointment.create') },
  { name: 'plan-adapter', skill: 'scheduling', context: { active_plan: { plan_ref: PLAN, actions: [action('a', 'appointment.change'), action('b', 'appointment.cancel', {}, ['reason'])] }, suspended_plans: [] },
    fields: { operation: 'appointment.change', fields: {}, clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: 'Qual o novo horário?' } }, requirements: () => getOperationRequirements('appointment.change') },
  { name: 'plan-open', skill: 'discovery', context: { active_plan: { plan_ref: PLAN, actions: [action('a', 'appointment.create'), action('b', 'appointment.cancel', {}, ['reason'])] }, suspended_plans: [] } },
  { name: 'plan-done', skill: 'discovery', context: { active_plan: { plan_ref: PLAN, actions: [{ item_key: 'a', operation: 'appointment.create', status: 'DONE', depends_on: [] }] }, suspended_plans: [] } },
  { name: 'plan-candidates', skill: 'discovery', context: { active_plan: { plan_ref: PLAN, actions: [action('a', 'appointment.create', { clarification: { missing_fields: ['customer_ref'], requested_field: 'customer_ref', previous_response: 'Qual cliente?',
    response_fields: ['customer_name'], candidates: [{ option_id: 'opt_1', label: 'Pessoa Um' }, { option_id: 'opt_2', label: 'Pessoa Dois' }] } })] }, suspended_plans: [] } },
  { name: 'plan-daypart', skill: 'discovery', context: { active_plan: { plan_ref: PLAN, actions: [action('a', 'appointment.change', { pending_temporal_ambiguities: [daypart],
    clarification: { missing_fields: ['time'], requested_field: 'time', requested_component: 'daypart', previous_response: 'Quatro da manhã ou da tarde?' } })] }, suspended_plans: [] } },
  { name: 'plan-calendar', skill: 'discovery', context: { active_plan: { plan_ref: PLAN, actions: [action('a', 'appointment.change', { pending_calendar_conflicts: [calendar],
    clarification: { missing_fields: ['date'], requested_field: 'date', requested_component: 'calendar_reference', previous_response: 'Terça ou 14/04?' } })] }, suspended_plans: [] } },
  { name: 'plan-pending-discard', skill: 'discovery', context: { active_plan: { plan_ref: PLAN, actions: [action('a', 'appointment.cancel', {}, ['reason']), action('b', 'appointment.create')],
    pending_discard: { item_keys: ['a', 'b'], question: 'Descarto as duas?' } }, suspended_plans: [] } },
  { name: 'plan-block', skill: 'discovery', context: { active_plan: { plan_ref: PLAN, actions: [action('a', 'schedule.block', { fields: { professional_name: 'Profissional Sintética' } }, ['time', 'end_time'])] }, suspended_plans: [] } },
  { name: 'plan-suspended', skill: 'discovery', context: { active_plan: { plan_ref: PLAN, actions: [action('a', 'appointment.create')] }, suspended_plans: [suspended(0), suspended(1)] } },
  { name: 'stress', skill: 'discovery', context: STRESS_CONTEXT },
  // The multi-action continuation exactly as the orchestrator builds it (draft and requirements follow the JIT flag).
  { name: 'plan-multi', skill: 'discovery', context: { active_plan: { plan_ref: PLAN, actions: [action('a', 'appointment.change'), action('b', 'schedule.block', {}, ['end_time'])] }, suspended_plans: [suspended(0)] },
    fields: () => continuationDraft([action('a', 'appointment.change'), action('b', 'schedule.block', {}, ['end_time'])]), requirements: () => continuationRequirements() },
];
export const LINT_FLAGS: readonly Record<string, string>[] = [
  { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'false', SALON_SECRETARY_JIT_INSTRUCTIONS: 'false' },
  { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'false' },
  { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'false', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true' },
  { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true' },
];
export const LINT_DIRECTORY: SalonDirectory = { professionals: ['Profissional Sintética'], services: ['Serviço Sintético'], today: { date: '2026-09-28', weekday: 'segunda-feira', timezone: 'America/Sao_Paulo' } };
export async function compileMatrix(states: readonly LintState[] = LINT_STATES, flags: readonly Record<string, string>[] = LINT_FLAGS) {
  const out: CompiledRequest[] = [];
  for (const env of flags) for (const state of states) out.push(await compileRequest(state, env, LINT_DIRECTORY));
  return out;
}
