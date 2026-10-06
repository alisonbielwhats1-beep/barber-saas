import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examplesState } from '@everflair/salon-secretary';
import { exampleBank, exampleRequirements, type BankExample } from '../../../packages/salon-secretary/src/examples/bank';
import { exampleFillNames, exampleFills, examplePlaceholders, fillExample, placeholderIssues, PLACEHOLDER, EXAMPLE_NAMES_FILE, GENERIC_EXAMPLE_SERVICES, type ExampleDirectory }
  from '../../../packages/salon-secretary/src/examples/fill';
import { exampleLine, wireFeatures } from '../../../packages/salon-secretary/src/examples/render';
import { composeExamples, jsonTextBytes } from '../../../packages/salon-secretary/src/examples/select';
import { gateVariants, validateExampleBank, GATE_DIRECTORY } from '../../../packages/salon-secretary/src/examples/validate';
import { bankTerms, detectNames, goldenNameTokens, namePools } from '../../../packages/salon-secretary/evaluation/ft-export';
import { loadPools, seenNameTokens } from '../../../packages/salon-secretary/evaluation/multi-salon/generate';
import { exampleNames, exampleNamesText, holdoutTokens, reservedEvaluationTokens } from '../../../packages/salon-secretary/evaluation/example-names';
import { foldWords } from '../../../packages/salon-secretary/evaluation/agenda-practice-stats';

/** G1: the few-shot bank teaches structure, never names. Every person/service of an entry is a placeholder filled at
 * render time from a compact fictional list, deterministically per seed, never with a word of the salon's team. */
const bank = exampleBank().examples;
const words = (text: string) => foldWords(text);
/** P3c migration (backup: .demo/agenda-core/contract-migration/secretary-example-placeholders.test.before-p3c-first-person.ts): the E2
 * entry teaches the owner's first-person pronoun itself as the professional ("meu horário"), a closed grammatical class that is
 * never a name (secretary-first-person.ts); every other person value stays a placeholder. */
const FIRST_PERSON = new Set(['eu', 'mim', 'comigo', 'meu', 'minha', 'meus', 'minhas']);
const pronoun = (value: string) => FIRST_PERSON.has(foldWords(value).join(' '));
const people = (e: BankExample) => e.expected.operations.flatMap(op => [op.customer_name, op.professional_name].flatMap(said => said && !pronoun(String(said.value)) ? [String(said.value)] : []));
/** A salon whose team shares first names with the fill list (the fill must avoid every one of them). */
const crowded: ExampleDirectory = { professionals: [...exampleFillNames().people.slice(0, 40).map((name, i) => `${name} Sobrenome${i}`)],
  services: ['Corte Degradê Premium', 'Escova Modeladora Longa', 'Hidratação Profunda com Óleo', 'Manicure e Pedicure Completa'] };

describe('placeholders in the bank', () => {
  it('every entry is consistent: tokens declared, slots used, parts valid for the form, nothing malformed', () => {
    expect(bank.flatMap(e => placeholderIssues(e).map(code => `${e.id}:${code}`))).toEqual([]);
    // Every person value the bank teaches is a placeholder (no fixed customer or professional name remains).
    const token = new RegExp(PLACEHOLDER.source);
    expect(bank.flatMap(e => people(e).filter(value => !token.test(value)).map(() => e.id))).toEqual([]);
    expect(bank.filter(e => examplePlaceholders(e).length).length).toBeGreaterThan(180);
  });
  it('no person name is left outside the placeholders (the evaluation name detector, on the raw entries)', () => {
    const reserved = new Set([...seenNameTokens(), ...goldenNameTokens()]), np = namePools(loadPools(), reserved), terms = bankTerms(bank);
    const found = bank.flatMap(e => [...detectNames(JSON.parse(JSON.stringify(e).replace(PLACEHOLDER, ' ')) as BankExample, np, terms).keys()].filter(name => !pronoun(name)).map(name => `${e.id}:${name.length}`));
    // Reported as id and length only (never the name).
    expect(found).toEqual([]);
    // Control: the same detector sees a name left in an entry.
    const leak = structuredClone(bank.find(e => e.id === 'S001')!); leak.message = leak.message.replace('{cliente}', 'julia');
    expect(detectNames(JSON.parse(JSON.stringify(leak).replace(PLACEHOLDER, ' ')) as BankExample, np, bankTerms([leak])).has('julia')).toBe(true);
  }, 60_000);
});

describe('fills', () => {
  const kinds = ['NEW', 'ANSWER', 'PLAN'] as const;
  it('are deterministic per seed; the same message renders the same block, another one other names', () => {
    for (const e of bank.filter(x => examplePlaceholders(x).length)) expect(exampleFills(e, 'seed-a', GATE_DIRECTORY), e.id).toEqual(exampleFills(e, 'seed-a', GATE_DIRECTORY));
    const state = examplesState(undefined), message = 'passa a gisele pra sexta 14hs';
    const a = composeExamples('selected', message, state, 1e6, 8, GATE_DIRECTORY), b = composeExamples('selected', message, state, 1e6, 8, GATE_DIRECTORY);
    expect(b.text).toBe(a.text); expect(a.count).toBeGreaterThan(1);
    const other = composeExamples('selected', message + ' ', state, 1e6, 8, GATE_DIRECTORY);
    expect(other.ids).toEqual(a.ids); expect(other.text).not.toBe(a.text); // same selection, other names
  });
  it('full mode: one salon keeps one block whatever the message (stable prompt prefix); another salon gets other names', () => {
    const state = examplesState(undefined);
    const a = composeExamples('full', 'oi', state, 1e6, 4, GATE_DIRECTORY), b = composeExamples('full', 'cancela a bia amanha pq ela ta doente', state, 1e6, 4, GATE_DIRECTORY);
    expect(b.text).toBe(a.text);
    expect(composeExamples('full', 'oi', state, 1e6, 4, crowded).text).not.toBe(a.text);
  });
  it('different entries of one block get different names (no single name dominates)', () => {
    for (const directory of [undefined, GATE_DIRECTORY]) {
      const block = composeExamples('full', 'oi', examplesState(undefined), 1e6, 4, directory);
      const values = [...block.text.matchAll(/(?:customer_name|professional_name):'([^']+)'/g)].map(m => words(m[1])[0]);
      const counts = values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>());
      expect(values.length).toBeGreaterThan(40); expect(counts.size).toBeGreaterThan(20);
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(Math.ceil(values.length / 6));
    }
  });
  it('never put a word of the salon team in an entry; a salon crowded with fill names still gets almost every entry', () => {
    const team = new Set(crowded.professionals!.flatMap(words));
    let filled = 0, total = 0;
    for (const e of bank.filter(x => examplePlaceholders(x).length)) for (const seed of ['t1', 't2', 't3']) {
      total++;
      const fills = exampleFills(e, seed, crowded);if (!fills) continue;
      filled++;
      const entry = fillExample(e, fills), shown = JSON.stringify([entry.message, entry.state, entry.expected]);
      expect(words(shown).filter(w => team.has(w) && !words(JSON.stringify(e).replace(PLACEHOLDER, ' ')).includes(w)), `${e.id}/${seed}`).toEqual([]);
      // Services come from the salon's own catalog when it publishes one.
      for (const service of Object.values(fills.services)) expect(crowded.services).toContain(service);
    }
    expect(filled / total).toBeGreaterThan(0.95);
    for (const e of bank.filter(x => examplePlaceholders(x).length).slice(0, 20)) {
      const fills = exampleFills(e, 't1');
      for (const service of Object.values(fills!.services)) expect(GENERIC_EXAMPLE_SERVICES as readonly string[]).toContain(service);
    }
  });
  it('keep every literal exact and the entry valid on both wires for extra seeds and a salon with long names (validation gate)', () => {
    const report = validateExampleBank(bank, { corpus: [], variants: gateVariants(['extra-1', 'extra-2', 'extra-3'], [crowded]) });
    expect(report.issues).toEqual([]); expect(report.valid).toBe(bank.length);
  }, 120_000);
  it('the rendered bank stays within 2% of its size before G1 (no salon) and 5% with long salon service names', () => {
    // Before G1 (fixed names), every renderable line: legacy NEW/ANSWER/PLAN 28810/10650/4814; components 43394/12665/5457 bytes.
    const before = { legacy: { NEW: 28810, ANSWER: 10650, PLAN: 4814 }, components: { NEW: 43394, ANSWER: 12665, PLAN: 5457 } } as const;
    const rows: Record<string, unknown>[] = [];
    for (const wire of ['legacy', 'components'] as const) for (const kind of kinds) for (const [label, directory, bound] of [['none', undefined, 1.02], ['crowded', crowded, 1.05]] as const) {
      let bytes = 0;
      for (const e of bank) {
        if (e.state.kind !== kind || exampleRequirements(e).some(f => !wireFeatures(wire).has(f))) continue;
        const fills = exampleFills(e, 'size', directory);
        try { if (fills) bytes += jsonTextBytes('\n' + exampleLine(fillExample(e, fills), wire)); } catch { /* not renderable on this wire */ }
      }
      rows.push({ wire, kind, salon: label, bytes, before: before[wire][kind] });
      expect(bytes, `${wire}/${kind}/${label}`).toBeLessThanOrEqual(Math.ceil(before[wire][kind] * bound));
    }
    console.info(JSON.stringify({ g1RenderedBytes: rows }));
  });
});

describe('the fill list (names.json)', () => {
  it('is exactly what the evaluation generator derives (never edited by hand)', () => {
    expect(readFileSync(join(process.cwd(), EXAMPLE_NAMES_FILE), 'utf8').replace(/\r\n/g, '\n')).toBe(exampleNamesText(exampleNames()));
  }, 60_000);
  it('holds no word of the holdout side of the pools, of the evaluation people or of the Golden 30', () => {
    const list = exampleFillNames().people.flatMap(words), held = holdoutTokens(loadPools()), reserved = reservedEvaluationTokens();
    expect(list.length).toBeGreaterThan(60);
    expect(list.filter(w => held.has(w)).length).toBe(0);
    expect(list.filter(w => reserved.has(w)).length).toBe(0);
  }, 60_000);
});
