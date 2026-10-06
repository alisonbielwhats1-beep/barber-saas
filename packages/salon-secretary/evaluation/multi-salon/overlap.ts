/** Overlap of texts meant for teaching (the few-shot example bank, fine-tuning rows) with the multi-salon evaluation material
 * (evaluation only; codes, ids and scores only, never a text). Two corpora:
 * - multi-salon-holdout: the HOLDOUT-side phrasings of templates.ts as neutral skeletons (neutralText). The sealed holdout
 *   is generated from them and anyone can read templates.ts, so a holdout phrasing copied into the bank must be caught;
 * - multi-salon-dev: every say and scripted answer of the committed dev instances (generated-dev.json).
 * src/examples/validate.ts gates the bank against the legacy batteries and the Golden 30 only: the multi-salon test runs
 * this gate on the bank (bankOverlap), ft-export excludes rows that trip it, and --gap measures held runs against the dev
 * instances (heldSimilarity). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgendaScenario } from '../agenda-practice-lib';
import { STATS, devBatteryMessages, exampleBankCorpus, foldWords, jaccard, maskedTokens, nameTokens, renderedBankMessages, scenarioNames } from '../agenda-practice-stats';
import { DEV_FILE, EXTRA_SLOTS, NEUTRAL_NAME, neutralText, sideVariants } from './generate';
import { TEMPLATES, type Template } from './templates';

/** A text overlaps a corpus text when its plain folded-word Jaccard or its masked-token Jaccard (names, digits, spoken
 * numbers and weekday words masked) reaches this. Above the bank gate's 0.6 because the corpora are generic booking
 * skeletons: plain requests reach 0.6 against them without copying, while a copied phrasing with other names, days, clocks
 * or word order scores 1. */
export const MULTI_SALON_OVERLAP_THRESHOLD = 0.8;
/** Identity counts from the methodology's frame size (STATS.frameMinTokens, 5 masked tokens); a near match (below 1) only
 * when both sides have this many: in a 5-7 token text one function word ("na", "às") moves the Jaccard by 0.15-0.2, so
 * short generic questions and replies ("quem a <nome> atende <dia>?", "pode ser <hora> da tarde") reach 0.8 by chance. */
export const OVERLAP_NEAR_MIN_TOKENS = 8;
export type OverlapCorpus = { name: string; texts: readonly string[] };
export type OverlapHit = { id: string; corpus: string; score: number };

/** Neutral skeletons of every holdout-side phrasing (says, scripted answers and, v3, the extra reply slots), retired ones
 * included (a copy of a consumed phrasing is still caught). */
export const holdoutSkeletons = (templates: readonly Template[] = TEMPLATES) => [...new Set([...templates.flatMap(t => [...t.says, ...Object.values(t.answers ?? {})]),
  ...EXTRA_SLOTS.map(x => x.list)].flatMap(list => sideVariants(null, '', list, 'holdout').map(v => neutralText(typeof v === 'string' ? v : v.t))))];
export function generatedDevScenarios(root: string = process.cwd()): AgendaScenario[] {
  const file = join(root, DEV_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as AgendaScenario[] : [];
}
export const multiSalonCorpora = (root: string = process.cwd()): OverlapCorpus[] =>
  [{ name: 'multi-salon-holdout', texts: holdoutSkeletons() }, { name: 'multi-salon-dev', texts: devBatteryMessages(generatedDevScenarios(root)) }];
/** Person-name words the score masks: the skeleton name, the dev instances' people and `extra` (the scored texts' names). */
export const overlapNames = (root: string = process.cwd(), extra: Iterable<string> = []) =>
  nameTokens([NEUTRAL_NAME, ...generatedDevScenarios(root).flatMap(scenarioNames), ...extra]);

const DAY_TEMPLATE = /\{\{[^{}]*\}\}/g;
type Prepared = { name: string; items: { plain: ReadonlySet<string>; masked: ReadonlySet<string> }[] };
const plainWords = (text: string) => new Set(foldWords(text.replace(DAY_TEMPLATE, ' ')));
/** Corpora with their token sets computed once (texts under the frame size dropped). */
export const prepareCorpora = (corpora: readonly OverlapCorpus[], names: ReadonlySet<string>): Prepared[] => corpora.map(c => ({ name: c.name,
  items: c.texts.map(text => ({ plain: plainWords(text), masked: maskedTokens(text, names) })).filter(x => x.masked.size >= STATS.frameMinTokens) }));
/** Highest overlap of one text with each prepared corpus (0 under the frame size; a near score only between texts of
 * OVERLAP_NEAR_MIN_TOKENS). */
export function overlapScores(text: string, corpora: readonly Prepared[], names: ReadonlySet<string>): Record<string, number> {
  const masked = maskedTokens(text, names), plain = plainWords(text);
  const score = (x: Prepared['items'][number]) => {
    const best = Math.max(jaccard(masked, x.masked), jaccard(plain, x.plain));
    return best >= 1 || Math.min(masked.size, x.masked.size) >= OVERLAP_NEAR_MIN_TOKENS ? best : 0;
  };
  return Object.fromEntries(corpora.map(c => [c.name, masked.size < STATS.frameMinTokens ? 0 : Math.max(0, ...c.items.map(score))]));
}
/** Entries at or above the threshold, per corpus (ids, corpus names and scores only). */
export function overlapHits(entries: readonly { id: string; text: string }[], corpora: readonly OverlapCorpus[], names: ReadonlySet<string>, threshold = MULTI_SALON_OVERLAP_THRESHOLD): OverlapHit[] {
  const prepared = prepareCorpora(corpora, names);
  return entries.flatMap(e => Object.entries(overlapScores(e.text, prepared, names)).filter(([, score]) => score >= threshold)
    .map(([corpus, score]) => ({ id: e.id, corpus, score: Math.round(score * 1000) / 1000 })));
}
/** The gate for the few-shot bank (packages/salon-secretary/src/examples/bank.json, read only). G1: the messages as the
 * model reads them (canonical fill); every name a fill may show is masked. */
export function bankOverlap(root: string = process.cwd(), threshold = MULTI_SALON_OVERLAP_THRESHOLD) {
  return overlapHits(renderedBankMessages(root), multiSalonCorpora(root), overlapNames(root, exampleBankCorpus(root).names), threshold);
}
