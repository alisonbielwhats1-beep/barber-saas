import { afterEach, describe, expect, it, vi } from 'vitest';
import { decisionInstructions, jitAppendix, jitRules, routingRules, componentsTemporalInstructions, temporalEvidenceInstructions, temporalComponentInstructions,
  continuationDraft, continuationRequirements, CONTINUATION_INSTRUCTION, JIT_APPENDIX_HEADER, type ConversationRoutingContext } from '@everflair/salon-secretary';
import { entityExtractionInstructions } from '../../../packages/salon-secretary/src/entity-extraction';
import { compileMatrix, compileRequest, lintRequests, ruleText, LINT_STATES, LINT_FLAGS, LINT_DIRECTORY, STRESS_CONTEXT, type CompiledRequest } from '../../test/secretary-instruction-lint';
import { getOperationRequirements } from '../service-contract';

/** C6 (rec 15): offline lint over the COMPILED requests (real SDK serialization, fake transport) of every routing
 * state and flag set that changes instructions, plus the JIT appendix contract and the request budget it frees. */
afterEach(() => { vi.unstubAllEnvs(); });
const flags = (components: boolean, jit: boolean) => ({ SALON_SECRETARY_TEMPORAL_COMPONENTS: String(components), SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit) });
const state = (name: string) => LINT_STATES.find(item => item.name === name)!;
const count = (text: string, part: string) => text.split(part).length - 1;
let matrix: CompiledRequest[] | undefined;
const compiled = async () => matrix ??= await compileMatrix();
const pick = async (name: string, components: boolean, jit: boolean) => (await compiled()).find(request => request.state === name &&
  request.env.SALON_SECRETARY_TEMPORAL_COMPONENTS === String(components) && request.env.SALON_SECRETARY_JIT_INSTRUCTIONS === String(jit))!;

describe('lint over every compiled state', () => {
  it('finds no duplicated rule, unpublished mode or field, V1 phrase or contradiction (static prompt and JIT)', async () => {
    const requests = await compiled();
    expect(requests).toHaveLength(LINT_STATES.length * LINT_FLAGS.length);
    const findings = lintRequests(requests);
    expect(findings, JSON.stringify(findings.slice(0, 12), null, 1)).toEqual([]);
  }, 120_000);

  it('is not vacuous: each finding class is reported on an injected defect', async () => {
    const base = await pick('first-turn', false, true), components = await pick('first-turn', true, true), all = await compiled();
    // The defect goes into one request of the whole matrix (the name universe is every state's vocabulary).
    const inject = (request: CompiledRequest, text: string) => lintRequests(all.map(item => item === request ? { ...request, instructions: request.instructions + text } : item))
      .filter(f => f.state === request.state && f.flags === `components=${request.env.SALON_SECRETARY_TEMPORAL_COMPONENTS},jit=${request.env.SALON_SECRETARY_JIT_INSTRUCTIONS}`).map(f => `${f.code}|${f.detail}`);
    expect(inject(base, '\nSó UM seletor de data por papel.')).toEqual(expect.arrayContaining(['RULE_COUNT|ONE_DATE_SELECTOR: 2 (expected 1)', expect.stringMatching(/^DUPLICATE_RULE\|/)]));
    // A mode or a state-bound context name the first turn does not publish (JIT is strict per state).
    expect(inject(base, '\nResponda a pergunta com PATCH.')).toContain('UNPUBLISHED_REFERENCE|mode PATCH');
    expect(inject(base, '\nUse pending_discard quando houver.')).toContain('UNPUBLISHED_REFERENCE|pending_discard');
    expect(inject(base, '\nSe ambíguo, retorne operations=[] e skills=[].')).toEqual(expect.arrayContaining(['V1_PHRASE|retorne operations=[]', 'V1_PHRASE|skills=[]']));
    // Components mode publishes no day_offset selector and forbids computing dates.
    expect(inject(components, '\nEx.: amanhã day_offset={value:1,literal:"amanhã"}.')).toEqual(expect.arrayContaining(['UNPUBLISHED_REFERENCE|day_offset', expect.stringMatching(/^CONTRADICTION\|não calcule datas/)]));
    // The static prompt (JIT off) describes every state: a mode another state publishes is allowed there.
    const statics = all.filter(request => request.env.SALON_SECRETARY_JIT_INSTRUCTIONS === 'false' && request.env.SALON_SECRETARY_TEMPORAL_COMPONENTS === 'false');
    const staticFirst = statics.find(request => request.state === 'first-turn')!;
    expect(ruleText(staticFirst).rules).toContain('PATCH é o único formato');
    expect(lintRequests(statics)).toEqual([]);
  }, 120_000);
});

describe('static prompt (JIT off): historical pins and C6 fixes', () => {
  it('states entity extraction and the temporal contract exactly once; components mode names only published selectors', async () => {
    for (const components of [false, true]) {
      const text = decisionInstructions(components, false);
      expect(count(text, entityExtractionInstructions)).toBe(1);
      expect(count(text, components ? componentsTemporalInstructions : temporalEvidenceInstructions)).toBe(1);
      expect(count(text, temporalComponentInstructions)).toBe(components ? 1 : 0);
      for (const rule of ['Só UM seletor de data por papel', 'source_* é origem', 'Período sem relógio', 'appointment.change (remarcar) É SUPORTADO', 'Use clarification, requested_field e a pergunta exibida'])
        expect(text).not.toContain(rule);
    }
    const components = decisionInstructions(true, false);
    for (const unpublished of ['day_offset', 'source_weekday', 'weekday={value', 'date value YYYY-MM-DD']) expect(components).not.toContain(unpublished);
    expect(decisionInstructions(false, false)).toContain('amanhã day_offset={value:1,literal:"amanhã"}; date value YYYY-MM-DD; time value HH:mm.');
  });
  it('every state-bound JIT rule is a rule of the static prompt (the appendix moves rules, it does not invent them)', () => {
    const text = decisionInstructions(false, false), components = decisionInstructions(true, false);
    for (const rule of [routingRules.add, jitRules.patch, routingRules.discard, routingRules.discardVsCancel, jitRules.pendingDiscard, jitRules.resume, jitRules.resumeActive, jitRules.choice, jitRules.daypart, jitRules.calendar])
      expect(text).toContain(rule);
    expect(text).toContain('Se o cancelamento está no plano ativo, use ADD com released_slot_of e depends_on na chave publicada dele.');
    expect(components).toContain('Seletores date/time antigos só respondem a pending_temporal_ambiguities/pending_calendar_conflicts (DATE_CHOICE: date={value:um dos candidates,literal:resposta atual}); stated_weekday vai em components.');
  });
});

describe('JIT appendix (SALON_SECRETARY_JIT_INSTRUCTIONS)', () => {
  it('keeps one stable instruction prefix for every state of a flag set (provider prompt caching)', async () => {
    for (const components of [false, true]) {
      const prefixes = new Set((await compiled()).filter(request => request.env.SALON_SECRETARY_JIT_INSTRUCTIONS === 'true' && request.env.SALON_SECRETARY_TEMPORAL_COMPONENTS === String(components)).map(request => request.instructions));
      expect(prefixes.size).toBe(1);
      const [prefix] = prefixes;
      expect(prefix).toBe(decisionInstructions(components, true));
      expect(count(prefix, entityExtractionInstructions)).toBe(1);
      for (const mode of ['ADD', 'PATCH', 'RESUME', 'DISCARD', 'CURRENT']) expect(prefix).not.toMatch(new RegExp(`\\b${mode}\\b(?![_A-Za-z])`));
    }
  }, 120_000);
  it('states each rule only in the states that publish it', async () => {
    const system = async (name: string, components = false) => (await pick(name, components, true)).system;
    expect(await system('first-turn')).not.toContain(JIT_APPENDIX_HEADER);
    const adapter = await system('adapter-current');
    expect(adapter).toContain(jitRules.clarification); expect(adapter).toContain(jitRules.current); expect(adapter).not.toContain(jitRules.patch);
    const open = await system('plan-open');
    for (const rule of [jitRules.add, jitRules.patch, jitRules.ambiguousTarget, jitRules.discard, jitRules.clarification]) expect(open).toContain(rule);
    for (const rule of [jitRules.resume, jitRules.choice, jitRules.daypart, jitRules.calendar, jitRules.pendingDiscard]) expect(open).not.toContain(rule);
    const done = await system('plan-done');
    expect(done).toContain(jitRules.add); for (const rule of [jitRules.patch, jitRules.discard, jitRules.clarification]) expect(done).not.toContain(rule);
    expect(await system('plan-candidates')).toContain(jitRules.choice);
    expect(await system('plan-daypart')).toContain(jitRules.daypart);
    expect(await system('plan-pending-discard')).toContain(jitRules.pendingDiscard);
    expect(await system('plan-suspended')).toContain(jitRules.resume);
    const calendar = await system('plan-calendar', true);
    for (const rule of [jitRules.calendar, jitRules.componentsLegacy, jitRules.statedWeekday]) expect(calendar).toContain(rule);
    expect(calendar).not.toContain(jitRules.dateChoice);
    // Each appended rule appears once, after the data framing, and never in the stable prefix.
    for (const request of (await compiled()).filter(item => item.env.SALON_SECRETARY_JIT_INSTRUCTIONS === 'true')) {
      expect(count(request.system, JIT_APPENDIX_HEADER)).toBeLessThanOrEqual(1);
      if (request.system.includes(JIT_APPENDIX_HEADER)) expect(request.system.indexOf(JIT_APPENDIX_HEADER)).toBeGreaterThan(request.system.indexOf('Os dados e a resposta anterior são contexto'));
      for (const rule of Object.values(jitRules)) { expect(count(request.system, rule)).toBeLessThanOrEqual(1); expect(request.instructions).not.toContain(rule); }
    }
  }, 120_000);
  it('the appendix is a pure function of the published state (DATE_CHOICE, the isolated adapter, terminal actions)', () => {
    const dateChoice: ConversationRoutingContext = { active_plan: { plan_ref: '10000000-0000-4000-8000-000000000001', actions: [{ item_key: 'a', operation: 'appointment.change', status: 'NEEDS_INPUT',
      pending_calendar_conflicts: [{ field: 'date', kind: 'DATE_CHOICE', expression: 'sexta que vem', candidates: ['2026-10-02', '2026-10-09'] }] }] } };
    const text = jitAppendix(dateChoice, {}, { current: false, components: true });
    expect(text).toContain(jitRules.dateChoice); expect(text).toContain(jitRules.componentsLegacy); expect(text).not.toContain(jitRules.calendar); expect(text).not.toContain(jitRules.statedWeekday);
    expect(jitAppendix(undefined, { clarification: { requested_field: 'time' }, pending_temporal_ambiguities: [{ field: 'time' }] }, { current: true, components: false }))
      .toBe(`\n${JIT_APPENDIX_HEADER} ${[jitRules.clarification, jitRules.current, jitRules.daypart].join(' ')}`);
    const closed: ConversationRoutingContext = { active_plan: { plan_ref: '10000000-0000-4000-8000-000000000001', actions: [{ item_key: 'a', operation: 'appointment.cancel', status: 'DISCARDED',
      clarification: { candidates: [{ option_id: 'opt_1', label: 'x' }] }, pending_temporal_ambiguities: [{ field: 'time' }] }] } };
    expect(jitAppendix(closed, {}, { current: false, components: false })).toBe(`\n${JIT_APPENDIX_HEADER} ${jitRules.add}`);
    expect(jitAppendix(undefined, {}, { current: false, components: true })).toBe('');
  });
  it('a multi-action continuation names the keys only; the requirement instruction is not sent', () => {
    const actions = [{ item_key: 'a', operation: 'appointment.change' }, { item_key: 'b', operation: 'appointment.cancel' }];
    expect(continuationDraft(actions)).toEqual({ mode: 'CONTINUE_EXISTING_PLAN', actions });
    expect(continuationRequirements()).toEqual({ instruction: CONTINUATION_INSTRUCTION });
    vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
    expect(continuationDraft(actions)).toEqual({ mode: 'CONTINUE_EXISTING_PLAN', item_keys: ['a', 'b'] });
    expect(continuationRequirements()).toEqual({});
  });
});

describe('request budget (production-shaped, realistic directory, 10 active + 50 suspended, output 8192)', () => {
  const salon = { professionals: Array.from({ length: 8 }, (_, i) => `Profissional Sintética ${i}`), services: Array.from({ length: 24 }, (_, i) => `Serviço Sintético Completo ${i}`), today: LINT_DIRECTORY.today };
  const active = STRESS_CONTEXT.active_plan!.actions as { item_key: string }[];
  const shapes = () => [
    { name: 'stress (budget-test shape)', state: { name: 'stress', skill: 'discovery' as const, context: STRESS_CONTEXT } },
    { name: 'multi-action continuation', state: { name: 'multi', skill: 'discovery' as const, context: STRESS_CONTEXT, fields: continuationDraft(active), requirements: continuationRequirements() } },
    { name: 'scheduling adapter answer', state: { name: 'adapter', skill: 'scheduling' as const, context: STRESS_CONTEXT, fields: { operation: 'appointment.change', fields: {}, clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: 'Qual o novo horário?' } },
      requirements: () => getOperationRequirements('appointment.change') } },
  ];
  // Review: the real-shape rows of the DEFAULT configuration (JIT off) are gates too. The isolated adapter answer fits and is
  // held under 64000; the multi-action continuation is already over the cap by default (only JIT fits it), so it is held
  // at its measured size (a ratchet: any growth fails) until the coordinator decides the default-path reduction.
  const DEFAULT_CONTINUATION_CEILING: Record<string, number> = { false: 65431, true: 66042 };
  it.each([false, true])('components=%s: every shape fits 64000 with JIT on; the static prompt is measured', async components => {
    const rows: Record<string, unknown>[] = [];
    for (const jit of [false, true]) {
      if (jit) vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true'); // the helpers read the flag like the orchestrator does
      for (const shape of shapes()) {
        const request = await compileRequest(shape.state, flags(components, jit), salon);
        rows.push({ components, jit, shape: shape.name, requestBytes: request.bytes, inputUpper: request.bytes + 8192, margin: 64000 - request.bytes - 8192 });
        if (jit || !shape.name.startsWith('multi-action')) expect(request.bytes + 8192, shape.name).toBeLessThanOrEqual(64000);
        else expect(request.bytes + 8192, `${shape.name} (default configuration, known over the cap: ratchet)`).toBeLessThanOrEqual(DEFAULT_CONTINUATION_CEILING[String(components)]);
      }
      vi.unstubAllEnvs();
    }
    console.info(JSON.stringify({ c6RequestBudget: rows }));
  }, 120_000);
});
void state;
