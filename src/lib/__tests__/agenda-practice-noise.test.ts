import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyNoise, foldNoise, noiseFacts, noiseLevel, noisePreflight, noiseProfile, noiseSeed, noiseSources, noiseViolations, numberWords, scenarioNoiseContext, spokenClock,
  type NoiseContext, type NoiseParams,
} from '../../../packages/salon-secretary/evaluation/agenda-practice-noise';
import { legacyOracle, renderTemplate, validateScenarios, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

// Synthetic texts only (DEV and legacy tuning batteries); the sealed holdout is never loaded here.
const SUNDAY = '2026-09-27';
const evaluation = 'packages/salon-secretary/evaluation';
const BATTERIES = ['agenda-practice-variations.json', 'agenda-practice-scenarios.json', 'agenda-practice-scenarios-r2.json', 'agenda-practice-scenarios-r3.json'];
const all = () => BATTERIES.flatMap(f => JSON.parse(readFileSync(join(evaluation, f), 'utf8')) as AgendaScenario[]);
const NAMES = ['Amanda Souza', 'João Pereira', 'Fábio Santos', 'Carla Mendes', 'Rosa Viana', 'Tatiana Rocha', 'Ricardo Alves', 'Rodrigo Lima', 'Corte Completo', 'Escova', 'Barba', 'Coloração'];
const NONE: NoiseParams = { subst: 0, numbers: 0, double: 0, comma: 0, period: 0, filler: 0, tail: 0, maxFillers: 0 };
const ALL_ON: NoiseParams = { subst: 1, numbers: 1, double: 1, comma: 1, period: 1, filler: 1, tail: 1, maxFillers: 9 };
const only = (p: Partial<NoiseParams>) => ({ ...NONE, ...p });
const words = (text: string) => [...foldNoise(text).matchAll(/[\p{L}\p{N}]+(?:[-:/'’][\p{L}\p{N}]+)*/gu)].map(m => m[0]);
const countWord = (text: string, w: string) => words(text).filter(x => x === w).length;
const WEEKDAYS = new Set(['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']);
const NUMBER_WORDS = new Set(['uma', 'um', 'duas', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis',
  'dezessete', 'dezoito', 'dezenove', 'vinte', 'trinta', 'primeiro', 'meio-dia', 'meia']);

describe('agenda practice noise: profiles, levels and seeds', () => {
  it('is off by default; mixed = clean first attempt, then light/heavy alternating; noise:false is always clean', () => {
    expect(noiseProfile()).toBe('off');
    expect(() => noiseProfile('loud')).toThrow('AGENDA_NOISE_ARGUMENT');
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(k => noiseLevel('mixed', k))).toEqual(['off', 'light', 'heavy', 'light', 'heavy', 'light', 'heavy', 'light']);
    expect([noiseLevel('off', 3), noiseLevel('light', 1), noiseLevel('heavy', 1)]).toEqual(['off', 'light', 'heavy']);
    expect(noiseLevel('heavy', 3, { noise: false })).toBe('off');
    expect(noiseSeed('V01', 2, 'say:1')).toBe('noise|V01#k2|say:1');
    const text = 'Passa o Fábio para amanhã às 10h.';
    expect(applyNoise(text, 'off', 'x', { names: NAMES }, ALL_ON)).toEqual({ text, rules: [] });
  });
  it('is deterministic by seed and samples different texts across attempts', () => {
    const text = 'Altere o horário do Fábio para amanhã às 10 horas, cancele o horário da Amanda e feche a agenda do Rodrigo das 10h às 11h do dia 28.';
    const ctx = { names: NAMES, finalClocks: ['10:00', '11:00'] };
    for (const level of ['light', 'heavy'] as const) {
      const seeds = Array.from({ length: 24 }, (_, k) => noiseSeed('V01', k + 1, 'say:1'));
      const first = seeds.map(s => applyNoise(text, level, s, ctx));
      expect(seeds.map(s => applyNoise(text, level, s, ctx))).toEqual(first);
      expect(new Set(first.map(r => r.text)).size).toBeGreaterThan(level === 'heavy' ? 12 : 1);
    }
    // Pinned outputs: a change here changes what pass^k runs send (comparability across versions).
    expect(applyNoise(text, 'light', noiseSeed('V01', 2, 'say:1'), ctx).text).toBe(PINNED.light);
    expect(applyNoise(text, 'heavy', noiseSeed('V01', 3, 'say:1'), ctx).text).toBe(PINNED.heavy);
  });
});

describe('agenda practice noise: rules', () => {
  const light = (t: string, p: Partial<NoiseParams> = { subst: 1 }, ctx: NoiseContext = { names: NAMES }) => applyNoise(t, 'light', 's', ctx, p);
  const heavy = (t: string, p: Partial<NoiseParams>, ctx: NoiseContext = { names: NAMES }) => applyNoise(t, 'heavy', 's', ctx, only(p)).text;
  it('light: accents, case, final punctuation, spaces and chat abbreviations', () => {
    expect(light('Você também está no horário, porque a Amanda disse que vem para o salão.')).toEqual({ text: 'vc tb ta no horario, pq a amanda disse q vem pro salao',
      rules: ['ACCENTS', 'ESTA_TA', 'FINAL_PUNCT', 'HORARIO', 'LOWERCASE', 'PARA_ARTICLE', 'PORQUE_PQ', 'QUE_Q', 'TAMBEM_TB', 'VOCE_VC'] });
    expect(light('Passa a Amanda para as 16h e a Rosa para a sexta.').text).toBe('passa a amanda pras 16h e a rosa pra sexta');
    expect(light('Marca para amanhã e para de mandar mensagem para').text).toBe('marca pra amanha e para de mandar mensagem para'); // 'para de' and a final 'para' stay
    expect(light('Marca esta semana, ESTÁ livre?').text).toBe('marca esta semana, ta livre'); // only the accented verb becomes 'ta'
    expect(light('  Marca   a Carla\n amanhã às 10h!!  ')).toEqual({ text: 'marca a carla amanha as 10h', rules: ['ACCENTS', 'AS_CRASE', 'FINAL_PUNCT', 'LOWERCASE', 'SPACES'] });
    expect(light('Você está aí?', { subst: 0 }).text).toBe('voce esta ai');
    // light never touches inner punctuation, never fills, doubles or spells numbers
    expect(light('Cancela a Amanda, ela viajou. Marca o João às 10h do dia 28.').text).toBe('cancela a amanda, ela viajou. marca o joao as 10h do dia 28');
  });
  it('heavy: clocks and days in words only where unambiguous (afternoon only for a final-state clock)', () => {
    const nums = (t: string, finalClocks: string[] = []) => heavy(t, { numbers: 1 }, { names: NAMES, finalClocks });
    expect(nums('às 10h')).toBe('as dez horas');
    expect(nums('às 10 horas')).toBe('as dez horas');
    expect(nums('às 10:30')).toBe('as dez e meia');
    expect(nums('às 9h45, 9h30 ou 12h')).toBe('as nove e quarenta e cinco, nove e meia ou meio-dia');
    expect(nums('do dia 28 e do dia 1')).toBe('do dia vinte e oito e do dia primeiro');
    expect(nums('daqui a 3 dias')).toBe('daqui a tres dias');
    expect(nums('às 14h', ['14:00'])).toBe('as duas da tarde');
    expect(nums('às 14h')).toBe('as 14h');
    expect(nums('às 16h30 e 13h', ['13:00', '16:30'])).toBe('as quatro e meia da tarde e uma da tarde');
    expect(nums('até as 19h, das 10 às 11, 10h20, 14h-16h', ['19:00'])).toBe('ate as 19h, das 10 as 11, 10h20, 14h-16h');
    expect(nums('dia 29/09 ou 2026-09-28')).toBe('dia 29/09 ou 2026-09-28');
    expect([spokenClock(13, 0, ['13:00']), spokenClock(10, 20), spokenClock(20, 0, ['20:00']), numberWords(21), numberWords(30)]).toEqual(['uma da tarde', null, null, 'vinte e um', 'trinta']);
  });
  it('heavy: drops most commas/periods without joining words, adds fillers at clause boundaries and repeats one command verb', () => {
    expect(heavy('Cancela a Amanda, ela desmarcou. Bloqueia o Ricardo,amanhã.', { comma: 1, period: 1 })).toBe('cancela a amanda ela desmarcou bloqueia o ricardo amanha');
    expect(heavy('Valor 10.5, ok.', { comma: 1, period: 1 })).toBe('valor 10.5 ok');
    expect(heavy('Cancela a Amanda', { double: 1 })).toBe('cancela cancela a amanda');
    expect(heavy('A Amanda Souza e a Carla Mendes', { double: 1 })).toBe('a amanda souza e a carla mendes'); // no command verb, nothing repeated
    const text = 'Cancela a Amanda, ela desmarcou, e bloqueia o Ricardo amanhã.', F = '(eh|tipo|entao|ai)';
    expect(heavy(text, { filler: 1, maxFillers: 9 })).toMatch(new RegExp(`^${F} cancela a amanda, ${F} ela desmarcou, ${F} e (ai|entao) bloqueia o ricardo amanha$`));
    expect(heavy(text, { filler: 1, maxFillers: 2 })).toMatch(new RegExp(`^${F} cancela a amanda, ${F} ela desmarcou, e bloqueia o ricardo amanha$`));
    expect(heavy('Marca a Carla amanhã', { tail: 1, maxFillers: 2 })).toBe('marca a carla amanha ne');
    expect(heavy('Às 11h.', { filler: 1, tail: 1, maxFillers: 2 })).toBe('as 11h'); // short answers get no filler
    // A literal core (graded cancellation reason) keeps its inner comma and gets nothing inserted inside it.
    const literal = heavy('Cancela o João porque ele ficou doente, coitado, e marca a Carla.', { comma: 1, period: 1, filler: 1, maxFillers: 9 }, { names: NAMES, literals: ['ficou doente, coitado'] });
    expect(literal).toMatch(new RegExp(`^${F} cancela o joao porque ele ficou doente, coitado ${F} e (ai|entao) marca a carla$`));
  });
  it('never touches a negation scope: no repeated negated verb, no filler right after a negation, no eh within two words after one', () => {
    const texts = ['Não, deixa. Não marca nada.', 'Não cancela a Amanda, só remarca pra 11h.', 'Cancela a Rosa, não, a Carla, ela viajou.', 'Cancela a Rosa, não pera, a Carla.',
      'Nunca marca a Carla, nem remarca o João. Não.'];
    for (const text of texts) for (let k = 1; k <= 400; k++) {
      const out = applyNoise(text, 'heavy', noiseSeed('NEG', k, 'say:1'), { names: NAMES }).text, at = `${text} → ${out}`;
      expect(noiseViolations(text, out, { names: NAMES }), at).toEqual([]);
      expect(out, at).not.toMatch(/\b(?:nao|nunca|nem) (\w+) \1\b/);
      expect(out, at).not.toMatch(/\b(?:nao|nunca|nem) (?:eh|tipo|entao|ai|ne)\b/);
      expect(out, at).not.toMatch(/\b(?:nao|nunca|nem) (?:\S+ )?eh\b/);
    }
    expect(heavy('Não, deixa. Não marca nada.', { double: 1, comma: 1, period: 1 })).toBe('nao deixa nao marca nada');
    expect(heavy('Não, deixa. Não marca nada.', { filler: 1, maxFillers: 9, comma: 1, period: 1, tail: 1 })).toMatch(/^(?:eh|tipo|entao|ai) nao deixa (?:tipo|entao|ai) nao marca nada ne$/);
    expect(heavy('Cancela a Rosa, não, a Carla, ela viajou.', { filler: 1, maxFillers: 9, comma: 1 })).toMatch(/^(?:eh|tipo|entao|ai) cancela a rosa (?:eh |tipo |entao |ai )?nao a carla (?:eh|tipo|entao|ai) ela viajou$/);
    expect(heavy('Não cancela a Amanda, só remarca pra 11h.', { double: 1 })).toBe('nao cancela a amanda, so remarca remarca pra 11h'); // the verb not negated may repeat
  });
  it('changes entity names only by accents/case: never typos, nicknames, truncation, repetition or inner fillers', () => {
    const ctx = { names: [...NAMES, 'Rosa Que'] };
    const text = 'Passa o Fábio Santos para a Tatiana Rocha, marca a Rosa Que para Coloração, cancela a Tatiane.';
    for (let k = 1; k <= 20; k++) {
      const out = applyNoise(text, 'heavy', noiseSeed('N', k, 'say:1'), ctx, { ...ALL_ON, maxFillers: 2 }).text;
      for (const name of ['fabio santos', 'tatiana rocha', 'rosa que', 'coloracao', 'tatiane']) expect(out).toContain(name); // 'que' inside a name is never 'q'
      expect(noiseViolations(text, out, ctx)).toEqual([]);
    }
  });
  it('keeps templated dates structurally intact: dd/mm, dd/mm/yyyy and ISO verbatim, weekdays only folded, day numbers only spelled', () => {
    const text = renderTemplate('Passa o Fábio para {{d:+2|ddmm}} ({{d:+2|ddmmyyyy}} ou {{d:+1|iso}}) na {{d:+2|weekdayfull}}, dia {{d:+1|dd}}.', SUNDAY);
    expect(text).toBe('Passa o Fábio para 29/09 (29/09/2026 ou 2026-09-28) na terça-feira, dia 28.');
    const outs = new Set<string>();
    for (let k = 1; k <= 16; k++) for (const level of ['light', 'heavy'] as const) {
      const out = applyNoise(text, level, noiseSeed('T', k, 'say:1'), { names: NAMES }).text; outs.add(out);
      for (const d of ['29/09 ', '(29/09/2026 ', ' 2026-09-28)']) expect(out).toContain(d);
      expect(out).toMatch(/ na terca-feira\b/);
      expect(out).toMatch(/ dia (28|vinte e oito)\b/);
    }
    expect([...outs].some(o => o.includes('dia vinte e oito'))).toBe(true);
  });
  it('respects noise:false scenarios and noNoise regions (templates allowed)', () => {
    const say = 'Manda para a Carla: "Oi Carla, seu horário de amanhã está confirmado!" e marca o João no dia {{d:+1|dd}} às 10h.';
    const s: AgendaScenario = { id: 'N01', title: 'mensagem exata', capability: ['communication'], steps: [{ say }], noNoise: ['Oi Carla, seu horário de amanhã está confirmado!', 'dia {{d:+1|dd}}'] };
    expect(validateScenarios([s])).toHaveLength(1);
    const ctx = scenarioNoiseContext(s, SUNDAY), text = renderTemplate(say, SUNDAY);
    expect(ctx.protect).toEqual(['Oi Carla, seu horário de amanhã está confirmado!', 'dia 28']);
    for (let k = 1; k <= 10; k++) {
      const out = applyNoise(text, 'heavy', noiseSeed('N01', k, 'say:1'), ctx, { ...ALL_ON, maxFillers: 2 }).text;
      expect(out).toContain('pra carla: "Oi Carla, seu horário de amanhã está confirmado!" ');
      expect(out).toContain(' dia 28 as dez horas');
      expect(noiseViolations(text, out, ctx)).toEqual([]);
    }
    const clean: AgendaScenario = { ...s, id: 'N02', noise: false, noNoise: undefined };
    expect(noiseLevel('heavy', 2, clean)).toBe('off');
    expect(noisePreflight([s, clean], { profile: 'heavy', repeat: 2, today: SUNDAY })).toMatchObject({ levels: ['heavy', 'heavy'], texts: 2, clean: ['N02'], violations: [] });
    expect(noisePreflight([s], { profile: 'off', repeat: 3, today: SUNDAY })).toMatchObject({ levels: ['off', 'off', 'off'], texts: 0 });
    expect(() => validateScenarios([{ ...s, noNoise: ['não existe no texto'] }])).toThrow('AGENDA_SCENARIO_INVALID:N01:NO_NOISE');
    expect(() => validateScenarios([{ ...s, noNoise: [] }])).toThrow('NO_NOISE');
    expect(() => validateScenarios([{ ...s, noise: 'no' as never }])).toThrow('AGENDA_SCENARIO_INVALID:N01:NOISE');
  });
});

describe('agenda practice noise: meaning preservation', () => {
  it('the invariant catches every change a correct secretary could not absorb', () => {
    const ctx = { names: NAMES, literals: ['viajou'], protect: ['Oi Carla!'] };
    const original = 'Não cancela a Amanda Souza amanhã às 10h na sexta 29/09, ela viajou. Oi Carla!';
    const good = 'eh nao cancela a amanda souza amanha as dez horas na sexta 29/09 ela viajou ne Oi Carla!';
    expect(noiseViolations(original, good, ctx)).toEqual([]);
    // A negation's scope is untouchable: a repeated negated verb is a bare affirmative command, 'nao eh' inverts it.
    expect(noiseViolations(original, good.replace('nao cancela', 'nao cancela cancela'), ctx)).toEqual(['NEG_SCOPE']);
    expect(noiseViolations(original, good.replace('nao cancela', 'nao eh cancela'), ctx)).toEqual(['NEG_SCOPE']);
    expect(noiseViolations('Cancela a Rosa, não, a Carla, ela viajou.', 'cancela a rosa nao eh a carla ela viajou', { names: NAMES })).toEqual(['NEG_SCOPE']);
    expect(noiseViolations('Cancela a Rosa, não pera, a Carla.', 'cancela a rosa nao pera eh a carla', { names: NAMES })).toEqual(['NEG_SCOPE']);
    expect(noiseViolations('Não passa para o João, passa para a Carla às 10h.', 'nao passa pro joao passa passa pra carla as dez horas', { names: NAMES })).toEqual([]);
    const bad = (from: string, to: string) => noiseViolations(original, good.replace(from, to), ctx);
    expect(bad('nao ', '')).toEqual(['FACTS', 'WORD_LOST']); // a negation is never dropped
    expect(bad('dez horas', 'onze horas')).toEqual(['FACTS']); // number words may be added, the clock may not change
    expect(bad('sexta', 'sabado')).toEqual(['FACTS', 'WORD_ADDED', 'WORD_LOST']);
    expect(bad('29/09', '30/09')).toEqual(['FACTS', 'WORD_ADDED']);
    expect(bad('amanha', 'depois de amanha')).toEqual(['WORD_ADDED']);
    expect(bad('amanda souza', 'amandaa souza')).toEqual(['FACTS', 'NAME', 'WORD_ADDED', 'WORD_LOST']); // typo
    expect(bad('amanda souza', 'amanda')).toEqual(['FACTS', 'NAME', 'WORD_LOST']); // truncation
    expect(bad('amanda souza', 'mandinha souza')).toEqual(['FACTS', 'NAME', 'WORD_ADDED', 'WORD_LOST']); // nickname
    expect(bad('ela viajou ne', 'ela viajoune')).toEqual(['LITERAL', 'WORD_ADDED', 'WORD_LOST']); // STT-like join
    expect(bad('Oi Carla!', 'oi carla')).toEqual(['VERBATIM']);
    expect(noiseViolations('Às 10h.', '')).toEqual(['EMPTY', 'FACTS']);
    expect(noiseFacts('dez e meia, duas da tarde, meio-dia, 9h45 e 10 horas; dia vinte e oito, 3 dias, 29/09, terça-feira, amanhã, não')).toEqual(
      ['C:3', 'D:28', 'DATE:29/09', 'NEG', 'R:amanha', 'T:09:45', 'T:10:00', 'T:10:30', 'T:12:00', 'T:14:00', 'W:terca']);
  });
  it('preserves meaning on every DEV and legacy battery text, on several run days, for light and heavy attempts', () => {
    let texts = 0, changed = 0; const rules = new Set<string>();
    for (const today of [SUNDAY, '2026-10-02', '2026-12-30']) {
      const legacy = legacyOracle(today).E;
      for (const s of all()) {
        const ctx = scenarioNoiseContext(s, today, legacy), nameWords = [...new Set((ctx.names ?? []).flatMap(n => words(n)).filter(w => w.length >= 3))];
        for (const [source, text] of noiseSources(s, today)) for (let k = 2; k <= 7; k++) {
          const r = applyNoise(text, noiseLevel('mixed', k), noiseSeed(s.id, k, source), ctx), at = `${s.id} ${source} k${k}`;
          texts++; if (r.text !== text) changed++; r.rules.forEach(x => rules.add(x));
          expect(noiseViolations(text, r.text, ctx), at).toEqual([]);
          const before = words(text), after = words(r.text);
          // weekday names and every entity word survive (only accents/case may change)
          for (const w of before.filter(x => WEEKDAYS.has(x.replace(/-feira$/, '')))) expect(after, at).toContain(w);
          for (const w of nameWords) expect(countWord(r.text, w), `${at} ${w}`).toBe(countWord(text, w));
          // a token with digits is either still there or was spelled in number words
          for (const w of before.filter(x => /\d/.test(x) && !after.includes(x))) expect(after.some(x => NUMBER_WORDS.has(x)), `${at} ${w}`).toBe(true);
          if (!(ctx.protect ?? []).length) expect(r.text, at).toBe(foldNoise(r.text)); // typed without accents or capitals
        }
      }
    }
    expect(texts).toBeGreaterThan(2500);
    expect(changed / texts).toBeGreaterThan(0.85);
    for (const rule of ['ACCENTS', 'LOWERCASE', 'FINAL_PUNCT', 'PARA_PRA', 'PARA_ARTICLE', 'QUE_Q', 'PORQUE_PQ', 'ESTA_TA', 'CLOCK_WORDS', 'DAY_WORDS', 'COMMA', 'PERIOD', 'FILLER', 'DOUBLE'])
      expect(rules.has(rule), rule).toBe(true);
  });
});

const PINNED = {
  light: 'altere o horario do fabio pra amanha as 10 horas, cancele o horario da amanda e feche a agenda do rodrigo das 10h as 11h do dia 28',
  heavy: 'altere o horario do fabio pra amanha as dez horas cancele cancele o horario da amanda e ai feche a agenda do rodrigo das 10h as onze horas do dia 28',
};
