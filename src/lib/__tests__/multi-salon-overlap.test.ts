import { describe, expect, it } from 'vitest';
import { MULTI_SALON_OVERLAP_THRESHOLD, OVERLAP_NEAR_MIN_TOKENS, bankOverlap, holdoutSkeletons, multiSalonCorpora, overlapHits, overlapNames } from '../../../packages/salon-secretary/evaluation/multi-salon/overlap';

// Evaluation-only gate: what teaches the Secretária (few-shot bank, fine-tuning rows) never holds a holdout-side template
// phrasing (templates.ts is readable by anyone) nor a committed multi-salon dev instance. Codes, ids and scores only.
describe('multi-salon overlap gate', () => {
  it('the few-shot bank holds no holdout-side phrasing and no multi-salon dev instance', () => {
    expect(bankOverlap()).toEqual([]);
  }, 60_000);

  it('catches a copied phrasing whatever its names, days, clocks, punctuation or word order; generic requests and short replies pass', () => {
    const corpora = [{ name: 'held', texts: ['Remarca a Fulana de terça, dia 29, pras 10h... não, pras 15h.'] }], names = overlapNames(process.cwd(), ['Kelly Moraes', 'Joana Prado']);
    expect(overlapHits([{ id: 'A', text: 'remarca a kelly de sexta dia 2 pras 9h nao pras 11h' }], corpora, names)).toEqual([{ id: 'A', corpus: 'held', score: 1 }]);
    expect(overlapHits([{ id: 'A2', text: 'remarca a kelly de sexta dia 2 pras 9h nao pras 11h por favor' }], corpora, names)).toEqual([{ id: 'A2', corpus: 'held', score: 0.818 }]);
    expect(overlapHits([{ id: 'B', text: 'Cancela a Joana de sexta, ela vai viajar.' }], corpora, names)).toEqual([]);
    expect(overlapHits([{ id: 'C', text: 'pras 10h' }], corpora, names)).toEqual([]); // under the frame size
    // Short generic texts: one function word apart is chance, not a copy (identity still counts from 5 tokens).
    const short = [{ name: 'held', texts: ['Quem a Fulana atende na terça?'] }];
    expect(overlapHits([{ id: 'D', text: 'quem a kelly atende quinta?' }], short, names)).toEqual([]);
    expect(overlapHits([{ id: 'E', text: 'Quem a Joana atende na sexta?' }], short, names)).toEqual([{ id: 'E', corpus: 'held', score: 1 }]);
    expect([MULTI_SALON_OVERLAP_THRESHOLD, OVERLAP_NEAR_MIN_TOKENS]).toEqual([0.8, 8]);
  });

  it('builds its corpora from the holdout side of the templates and the committed dev instances', () => {
    const [held, dev] = multiSalonCorpora();
    expect([held.name, dev.name]).toEqual(['multi-salon-holdout', 'multi-salon-dev']);
    expect(held.texts.length).toBeGreaterThan(50);
    expect(dev.texts.length).toBeGreaterThan(100);
    expect(holdoutSkeletons().some(t => /[{}⟦⟧]/.test(t))).toBe(false);
  });
});
