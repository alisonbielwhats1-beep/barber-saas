import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportFineTuning, namePools, detectNames, bankTerms, nameMapping, renameExample, sftLineIssues, withoutNames, FT_PROFILE,
  type NamePools, type SftLine } from '../../../packages/salon-secretary/evaluation/ft-export';
import { sidePools, type Pools } from '../../../packages/salon-secretary/evaluation/multi-salon/generate';
import { hash32, mulberry32 } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { bankExample, type BankExample } from '../../../packages/salon-secretary/src/examples/bank';

/** Fine-tuning-READY export (no training, no network). A tiny SYNTHETIC bank and synthetic name pools: the real bank and the
 * real pools are never read here, so the test pins the method, not the content. */
afterEach(() => { vi.unstubAllGlobals(); });
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const clock = '2027-04-12T09:00', why = 'sintético';
const person = (name: string, tags: string[]) => ({ name, tags });
const service = (name: string, aliases: string[]) => ({ key: fold(name).replace(/\W+/g, '-'), name, durationMin: 30, priceCents: 5000, specialties: [], aliases });
const salon = (id: string, services: ReturnType<typeof service>[]) => ({ id, label: id, services, professionals: { min: 2, max: 4, typical: 3, roles: [] }, hours: [] });
const POOLS = {
  names: {
    female: ['Benedita', 'Clotilde', 'Dirce', 'Eulália', 'Filomena', 'Genoveva', 'Hermínia', 'Iolanda', 'Jandira', 'Leonor', 'Marieta', 'Noêmia', 'Ivone', 'Olinda', 'Palmira', 'Quitéria']
      .map(name => person(name, ['f'])),
    male: ['Abelardo', 'Bonifácio', 'Cândido', 'Dorival', 'Epaminondas', 'Felisberto', 'Gumercindo', 'Hermes', 'Isidoro', 'Juvenal', 'Laudelino', 'Moacyr', 'Nestor', 'Otacílio', 'Porfírio', 'Quirino']
      .map(name => person(name, ['m'])),
    unisex: ['Darci', 'Jaci', 'Juraci', 'Alcione', 'Irani', 'Ariel'].map(name => person(name, ['u'])),
    compound: [], foreignOrigin: [], wordNames: [person('Rosa', ['f', 'word', 'color'])],
    nicknames: [{ nickname: 'Dedé', formal: ['Dirce'], tags: ['f', 'nickname'] }, { nickname: 'Nena', formal: ['Filomena'], tags: ['f', 'nickname'] },
      { nickname: 'Tonho', formal: ['Antônio'], tags: ['m', 'nickname'] }, { nickname: 'Juju', formal: ['Jandira'], tags: ['f', 'nickname'] }],
    surnames: ['Arruda', 'Bezerra', 'Cavalcanti', 'Dantas', 'Esteves', 'Falcão', 'Guedes', 'Holanda', 'Ibiapina', 'Jardim', 'Leitão', 'Macedo'].map(name => ({ name, tags: [] })),
    particles: ['da', 'de', 'do'], honorifics: [{ text: 'Dona', tags: ['f'] }, { text: 'Seu', tags: ['m'] }],
  },
  styles: { groups: [], verbs: [], frames: [], excluded: [] },
  salons: { types: [salon('barbearia', [service('Corte masculino', ['corte']), service('Barba', ['fazer a barba']), service('Pezinho', ['acabamento'])]),
    salon('salao-de-beleza', [service('Escova simples', ['escova']), service('Coloração', ['tintura']), service('Manicure', ['mão']), service('Hidratação', ['hidratacao'])]),
    salon('esmalteria', [service('Esmaltação em gel', ['gel'])])] },
  sha256: { 'names.json': 'synthetic' },
} as unknown as Pools;
const RESERVED = new Set(['ivone']);
const create = (id: string, message: string) => ({ id, message, clock, state: { kind: 'NEW' }, expected: { mode: 'NEW', operations: [{ item_key: 'a', operation: 'appointment.create',
  customer_name: { value: 'Zuleica', literal: 'Zuleica' }, service_name: { value: 'escova', literal: 'escova' }, professional_name: { value: 'Odila', literal: 'Odila' },
  date: { components: { kind: 'RELATIVE_DAY', offset: 1 }, legacy: { day_offset: 1 }, literal: 'amanhã' },
  time: { components: { hour: 10, minute: 0, daypart: 'UNSPECIFIED' }, legacy: '10:00', literal: '10h' } }], secretary_should: why }, tags: ['create'], source: 'own' });
const friday = { components: { kind: 'WEEKDAY', weekday: 5, week: 'NEAREST' }, legacy: { weekday: 5 }, literal: 'sexta' };
const BANK = [
  create('S901', 'marca a Zuleica amanhã 10h pra escova com a Odila'),
  { id: 'S902', message: 'cancela o seu Florindo de sexta pq ele viajou', clock, state: { kind: 'NEW' }, expected: { mode: 'NEW', operations: [{ item_key: 'a', operation: 'appointment.cancel',
    customer_name: { value: 'seu Florindo', literal: 'seu Florindo' }, date: friday, reason: { value: 'ele viajou', literal: 'ele viajou' } }], secretary_should: why }, tags: ['cancel'], source: 'own' },
  { id: 'R901', message: 'fica pras 4 da tarde', clock, state: { kind: 'ANSWER', requested_field: 'time', question: 'Qual horário pra escova da Zuleica na sexta?', operation: 'appointment.create' },
    expected: { mode: 'PATCH', operations: [{ item_key: 'a', operation: 'appointment.create', time: { components: { hour: 4, minute: 0, daypart: 'TARDE' }, legacy: '16:00', literal: '4 da tarde' } }],
      secretary_should: why }, tags: ['answer'], source: 'own' },
  { id: 'M901', message: 'deixa pra sexta então', clock, state: { kind: 'PLAN', actions: [{ item_key: 'a', operation: 'appointment.change', summary: 'remarcar Zuleica para qui 15/04 16h' }] },
    expected: { mode: 'PATCH', operations: [{ item_key: 'a', operation: 'appointment.change', date: friday }], secretary_should: why }, tags: ['plan'], source: 'own' },
  { id: 'S903', message: 'muda o horário de abrir o salão pra 8h', clock, state: { kind: 'NEW' }, expected: { mode: 'UNSUPPORTED', operations: [], unavailable_capability: 'salon_hours', secretary_should: why },
    tags: ['limite'], source: 'own' },
  { ...create('S904', 'agenda a Zuleica amanhã 10h escova, com a Odila'), requires: ['polarity'] },
  create('S905', 'marca a Zuleica amanhã 10h pra escova com a Odila por favor'),
  { id: 'S906', message: 'sem formato' },
];
const ORIGINAL = ['zuleica', 'odila', 'florindo'];
type Run = Awaited<ReturnType<typeof exportFineTuning>>;
let pools: NamePools, first: Run, again: Run, other: Run, overlapped: Run, fetchSpy: ReturnType<typeof vi.fn>, fetchAfter: unknown;
const lineOf = (run: Run, id: string) => JSON.parse(run.lines[run.manifest.lines.find(row => row.id === id)!.line - 1]) as SftLine;
const argsOf = (line: SftLine) => { const last = line.messages.at(-1)!; return JSON.parse('tool_calls' in last ? last.tool_calls[0].function.arguments : '{}') as { turn: { mode: string; operations: Record<string, unknown>[] } }; };
const text = (line: SftLine, index: number) => { const m = line.messages[index]; return 'content' in m ? m.content : ''; };

beforeAll(async () => {
  pools = namePools(POOLS, RESERVED);
  fetchSpy = vi.fn(async () => { throw Error('NETWORK_USED'); }); vi.stubGlobal('fetch', fetchSpy);
  const before = Object.fromEntries(Object.keys(FT_PROFILE).map(name => [name, process.env[name]]));
  first = await exportFineTuning({ bank: BANK, pools, reserved: RESERVED, seed: 'unit-seed' });
  again = await exportFineTuning({ bank: BANK, pools, reserved: RESERVED, seed: 'unit-seed' });
  other = await exportFineTuning({ bank: BANK, pools, reserved: RESERVED, seed: 'unit-seed-2' });
  // An evaluation corpus holding S902's frame with other names, day and reason words kept: the row must not be taught.
  overlapped = await exportFineTuning({ bank: BANK, pools, reserved: RESERVED, seed: 'unit-seed',
    overlap: { corpora: [{ name: 'held', texts: ['Cancela o seu Fulano de terça, pq ele viajou.'] }], names: new Set(['fulano']) } });
  fetchAfter = globalThis.fetch;
  expect(Object.fromEntries(Object.keys(FT_PROFILE).map(name => [name, process.env[name]]))).toEqual(before);
}, 120_000);

describe('fine-tuning export: eligibility and format', () => {
  it('keeps only NEW/ANSWER entries with a complete, available, in-scope output; excluded ids carry their reasons', () => {
    expect(first.manifest.lines.map(row => row.id)).toEqual(['S901', 'S902', 'R901']);
    expect(Object.fromEntries(first.manifest.excluded.map(item => [item.id, item.reasons.map(reason => reason.split(':').slice(0, 2).join(':'))]))).toEqual({
      M901: ['STATE_PLAN'], S903: ['OUT_OF_SCOPE_ONLY'], S904: ['REQUIRES_UNAVAILABLE:polarity'], S905: ['NEAR_DUPLICATE:S901'], S906: ['BANK_INVALID'] });
    expect(first.manifest.counts).toMatchObject({ byTransition: { 'ANSWER>PATCH': 1, 'NEW>NEW': 2 }, byGroup: { cancel: 1, create: 2 }, multiAction: 0, bySource: { R: 1, S: 2 },
      nameValues: { total: 3, distinct: 3, maxCount: 1 } });
    expect(first.manifest).toMatchObject({ rows: 3, examples: 'off', seed: 'unit-seed', profile: FT_PROFILE, names: { side: 'dev', salonTypes: ['barbearia', 'salao-de-beleza'] } });
    expect(first.manifest.bank.sha16).toMatch(/^[0-9a-f]{16}$/);
    expect(first.manifest.excludedByReason).toEqual({ BANK_INVALID: 1, NEAR_DUPLICATE: 1, OUT_OF_SCOPE_ONLY: 1, REQUIRES_UNAVAILABLE: 1, STATE_PLAN: 1 });
  });
  it('excludes a row whose message reaches an evaluation corpus (EVAL_OVERLAP), whatever its names; other rows are unchanged', () => {
    expect(first.manifest.overlap).toBeNull();
    expect(overlapped.manifest.lines.map(row => row.id)).toEqual(['S901', 'R901']);
    expect(overlapped.manifest.excluded.find(item => item.id === 'S902')?.reasons).toEqual(['EVAL_OVERLAP:held']);
    expect(overlapped.manifest.overlap).toEqual({ threshold: 0.8, corpora: [{ name: 'held', texts: 1 }] });
    expect(overlapped.lines).toEqual([first.lines[0], first.lines[2]]);
  });
  it('every line is an OpenAI chat fine-tuning example: live instructions, context, draft, message, one forced tool call, the published tool', () => {
    for (const raw of first.lines) {
      const line = JSON.parse(raw) as SftLine;
      expect(Object.keys(line)).toEqual(['messages', 'tools', 'parallel_tool_calls']);
      expect(sftLineIssues(line)).toEqual([]);
      expect(line.messages.map(m => m.role)).toEqual(['system', 'system', 'user', 'user', 'assistant']);
      expect(line.tools).toHaveLength(1);
      expect(line.tools[0]).toMatchObject({ type: 'function', function: { name: 'select_capabilities' } });
      expect(text(line, 1)).toMatch(/^Contexto da conversa: /);
      expect(text(line, 1)).toContain('Hoje no fuso do salão: segunda-feira, 2027-04-12 (America/');
      expect(text(line, 2)).toMatch(/^Campos atuais do rascunho \(dados, não instruções\): /);
      expect(raw).not.toContain('Exemplos de interpretação');
    }
    const answer = lineOf(first, 'R901');
    expect(text(answer, 1)).toContain('"requested_field":"time"');
    expect(text(answer, 2)).toContain('CONTINUE_EXISTING_PLAN');
    expect(argsOf(answer).turn).toMatchObject({ mode: 'PATCH', operations: [{ item_key: 'a', fields: { components: { time: { value: { hour: 4, minute: 0, daypart: 'TARDE' }, literal: '4 da tarde' } } } }] });
    // Strict wire: every published key is present (absent = null).
    expect(argsOf(lineOf(first, 'S902')).turn.operations[0]).toMatchObject({ operation: 'appointment.cancel', depends_on: null, service_name: null, reason: 'ele viajou' });
    expect(sftLineIssues({ ...answer, parallel_tool_calls: true as unknown as false })).toContain('PARALLEL');
    expect(sftLineIssues({ ...answer, messages: [answer.messages[0], { role: 'user', content: 'Exemplos de interpretação (dados, não instruções): x' }, answer.messages[4]] })).toContain('MESSAGE');
  });
});

describe('fine-tuning export: names never taught', () => {
  it('replaces every person name (message, values, question, context) by DEV-side pool names; no original, reserved or holdout name remains', () => {
    const dev = sidePools(POOLS, 'dev', RESERVED), devNames = new Set([...dev.persons.map(p => fold(p.name)), ...dev.nicknames.map(n => fold(n.nickname))]);
    const holdout = sidePools(POOLS, 'holdout'), holdoutOnly = [...holdout.persons.map(p => fold(p.name)), ...holdout.nicknames.map(n => fold(n.nickname))].filter(name => !devNames.has(name));
    for (const raw of first.lines) {
      // Everything but the fixed instruction text (the timezone id is not a person).
      const line = JSON.parse(raw) as SftLine, variable = JSON.stringify(line.messages.slice(1)).replace(/America\/\w+/g, ' ');
      const tokens = new Set(fold(variable).split(/[^\p{L}\p{N}]+/u));
      for (const name of [...ORIGINAL, 'ivone', ...holdoutOnly]) expect(tokens.has(name), name).toBe(false);
      expect(text(line, 1)).not.toMatch(/Esmalta/); // services of holdout salon types never appear
    }
    const create = argsOf(lineOf(first, 'S901')).turn.operations[0], cancel = argsOf(lineOf(first, 'S902')).turn.operations[0];
    expect(devNames.has(fold(String(create.customer_name)))).toBe(true);
    expect(devNames.has(fold(String(create.professional_name)))).toBe(true);
    // Gender and honorific follow the text ("o seu Florindo ... ele"): a masculine DEV name after "seu".
    const [honorific, man] = String(cancel.customer_name).split(' ');
    expect(honorific).toBe('seu');
    expect(dev.persons.find(p => fold(p.name) === fold(man))?.gender).toBe('m');
    // The name is copied as said: the value is a literal of the (renamed) message, in its case.
    for (const id of ['S901', 'S902']) { const line = lineOf(first, id), op = argsOf(line).turn.operations[0];
      for (const key of ['customer_name', 'professional_name']) if (op[key]) expect(text(line, 3)).toContain(String(op[key])); }
    expect(text(lineOf(first, 'R901'), 1)).toMatch(/Qual horário pra escova da \p{Lu}\p{L}+ na sexta\?/u);
  });
  it('the fictional directory lists the named professional by FULL name while the expected output keeps the name as said', () => {
    const line = lineOf(first, 'S901'), said = String(argsOf(line).turn.operations[0].professional_name);
    const directory = JSON.parse(/Equipe e serviços ativos do salão[^:]*: (\{.*\})\n/.exec(text(line, 1))![1]) as { professionals: string[]; services: string[] };
    const full = directory.professionals.filter(name => fold(name.split(' ')[0]) === fold(said) || fold(name).startsWith(fold(said)));
    expect(full.length).toBeGreaterThan(0);
    expect(full.every(name => name.split(' ').length >= 2)).toBe(true);
    expect(said.split(' ')).toHaveLength(1);
    expect(directory.services).toContain('Escova simples');
    expect(directory.professionals.length).toBeGreaterThanOrEqual(2);
    expect(directory.professionals.some(name => fold(name).includes(fold(String(argsOf(line).turn.operations[0].customer_name))))).toBe(false);
  });
  it('is deterministic for a seed, draws other names with another seed, and never uses the network', () => {
    expect(again.lines).toEqual(first.lines);
    expect(again.manifest).toEqual(first.manifest);
    expect(other.lines).not.toEqual(first.lines);
    expect(other.manifest.lines.map(row => row.id)).toEqual(first.manifest.lines.map(row => row.id));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchAfter).toBe(fetchSpy);
  });
});

describe('fine-tuning export: renaming units', () => {
  const hand: NamePools = {
    given: { f: ['Benedita', 'Clotilde'], m: ['Abelardo', 'Bonifácio'], u: ['Darci'] },
    givenGender: new Map([['benedita', 'f'], ['clotilde', 'f'], ['abelardo', 'm'], ['bonifacio', 'm'], ['darci', 'u'], ['dirce', 'f']]),
    nicknames: { f: [{ name: 'Dedé', formal: ['Dirce'] }], m: [], u: [] }, surnames: [{ name: 'Arruda' }, { name: 'Bezerra' }, { name: 'Cavalcanti' }],
    lexicon: { given: new Map([['odila', 'f'], ['zuleica', 'f'], ['florindo', 'm']]), nicknames: new Map([['odi', { gender: 'f', formal: ['odila'] }]]),
      surnames: new Set(['prates', 'mendes']), wordish: new Set(['rosa']), honorifics: new Set(['dona', 'seu']) },
    salonTypes: [], stop: new Set(['escova', 'sexta']), poolSha256: 'hand',
  };
  const example = (raw: Record<string, unknown>) => bankExample.parse({ clock, tags: [], source: 'own', ...raw }) as BankExample;
  const rename = (e: BankExample, seed = 'u') => {
    const mentions = detectNames(e, hand, bankTerms([e])), mapping = nameMapping(e, mentions, hand, mulberry32(hash32(seed)));
    if ('error' in mapping) throw Error(mapping.error);
    return { mentions, renamed: renameExample(e, mapping) };
  };
  it('keeps honorifics, gender, per-occurrence case and drops accents only where the name was always typed lowercase', () => {
    const e = example({ id: 'S950', message: 'cancela a DONA ZULEICA e o seu florindo, ela e ele viajaram', state: { kind: 'NEW' }, expected: { mode: 'NEW', secretary_should: why, operations: [
      { item_key: 'a', operation: 'appointment.cancel', customer_name: { value: 'DONA ZULEICA', literal: 'DONA ZULEICA' } },
      { item_key: 'b', operation: 'appointment.cancel', customer_name: { value: 'seu florindo', literal: 'seu florindo' } }] } });
    const { mentions, renamed } = rename(e);
    expect([...mentions.keys()].sort()).toEqual(['florindo', 'zuleica']);
    const [a, b] = renamed.expected.operations.map(op => String(op.customer_name!.value));
    expect(a).toMatch(/^DONA (BENEDITA|CLOTILDE)$/);
    expect(b).toMatch(/^seu (abelardo|bonifacio)$/);
    expect(renamed.message).toBe(`cancela a ${a} e o ${b}, ela e ele viajaram`);
    expect(renamed.expected.operations.every(op => op.customer_name!.value === op.customer_name!.literal)).toBe(true);
  });
  it('maps a nickname and the formal name it abbreviates to a pool pair, surnames to pool surnames and a plural consistently', () => {
    const e = example({ id: 'R950', message: 'a Odi, a de sobrenome prates', state: { kind: 'ANSWER', requested_field: 'selection', question: 'Achei duas Odilas. Qual delas?',
      operation: 'appointment.create', candidates: ['Odila Prates', 'Odila Mendes'] }, expected: { mode: 'AMBIGUOUS', operations: [], secretary_should: why } });
    const { mentions, renamed } = rename(e);
    expect(Object.fromEntries([...mentions].map(([key, m]) => [key, m.kind]))).toEqual({ odi: 'nickname', odila: 'given', prates: 'surname', mendes: 'surname' });
    expect(renamed.message).toMatch(/^a Dedé, a de sobrenome (arruda|bezerra|cavalcanti)$/);
    const surname = renamed.message.split(' ').at(-1)!;
    expect(renamed.state).toMatchObject({ question: 'Achei duas Dirces. Qual delas?' });
    const candidates = (renamed.state as { candidates: string[] }).candidates;
    expect(candidates[0]).toBe('Dirce ' + surname[0].toUpperCase() + surname.slice(1));
    expect(candidates[1]).toMatch(/^Dirce (Arruda|Bezerra|Cavalcanti)$/);
    expect(candidates[1]).not.toBe(candidates[0]);
  });
  it('a capitalized word is a name only where a person is introduced; common words stay', () => {
    const e = example({ id: 'R951', message: 'precisa de motivo?', state: { kind: 'ANSWER', requested_field: 'reason', question: 'Qual o motivo do cancelamento da Zuleica?', operation: 'appointment.cancel' },
      expected: { mode: 'CONVERSATION', operations: [], response: 'Use o botão Confirmar do plano; qual o motivo da Zuleica?', secretary_should: why } });
    const { mentions, renamed } = rename(e);
    expect([...mentions.keys()]).toEqual(['zuleica']);
    expect(renamed.expected.response).toMatch(/^Use o botão Confirmar do plano; qual o motivo da (Benedita|Clotilde)\?$/);
    const salon = example({ id: 'S951', message: 'fecha o Salão amanhã e avisa a Zuleica', state: { kind: 'NEW' }, expected: { mode: 'AMBIGUOUS', operations: [], secretary_should: why } });
    expect([...rename(salon).mentions.keys()]).toEqual(['zuleica']);
    expect(withoutNames(hand, new Set(['benedita'])).given.f).toEqual(['Clotilde']);
  });
});
