/** Proof diversity report (Candidate 4, Track H; evaluation only: offline, no network, no database, no model).
 *
 * Does a proof set (a holdout, a validation battery) vary from the DEV material in more than names? It reads a battery of
 * AgendaScenario[] or the Golden format ({cases: [{id, turns: [{message, expect}]}]}) and compares it with the DEV union:
 * the Candidate 4 DEV and rules batteries, the older DEV batteries (V, N, A, B, C), the Golden 30, the committed multi-salon DEV instances
 * and, for text similarity only, the few-shot bank's rendered messages. Output: counts, ids, codes and scores only, never a
 * text (every capability or salon label is printed only when it is a plain code: CODE, no space).
 * - M1 text similarity: per say/answer text, the max over DEV texts of the folded-word Jaccard and of the masked-token
 *   Jaccard (names, digits, spoken numbers, weekdays masked: maskedTokens); distribution and counts >= 0.6 / >= 0.8 / == 1
 *   under the overlap gate (identity from STATS.frameMinTokens masked tokens, a near match only when both sides have
 *   OVERLAP_NEAR_MIN_TOKENS); ENTITY-SWAP identity: the ordered skeleton (names, services, days, clocks and numbers masked)
 *   equals a DEV skeleton (a pure entity swap), or its token bag does (a swap plus reordering).
 * - M2 overlap of customer, professional and service names with DEV (set Jaccard and share of occurrences seen in DEV).
 * - M3 structure: a scenario signature (expected operation kinds from the final / read / unchanged oracle, alteration kinds,
 *   mustAsk fields, scripted answer fields, the step trajectory, reference and negation/correction tags); signatures exact in
 *   DEV and one component away (near); syntactic diversity (distinct skeletons per text, function-word 3-grams unseen in DEV).
 * - M4 operational context: salon type, weekly hours pattern, breaks, professional shifts, closed days, team and catalog
 *   sizes, durations, pre-existing bookings, conflict / busy target day; shares absent from DEV.
 * - M5 capability combinations: canonical capability codes per scenario (ops, missing information, negation, reference,
 *   conflict, ambiguity, multi-service, hours, multi-turn...) and their combinations absent from DEV.
 * - M6 heuristic counts for the owner's 14 diversity dimensions.
 * - templates: for generated instances (ids MH<tt>... vs the DEV MD<tt>...), templates shared with DEV and which parts of an
 *   instance differ from all of its DEV siblings (codes).
 * CLI: scripts/secretary-proof-diversity.cjs. Never imported by runtime code. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_FIXTURE, answerInstances, appointmentServiceKeys, buildScenarioFixture, dayOffset, type AgendaScenario, type DaySpec } from './agenda-practice-lib';
import { MASK, STATS, foldWords, jaccard, maskedTokens, nameTokens, quantile, renderedBankMessages, exampleBankCorpus } from './agenda-practice-stats';
import { DEV_FILE } from './multi-salon/generate';
import { OVERLAP_NEAR_MIN_TOKENS } from './multi-salon/overlap';

export const PROOF_DIVERSITY_VERSION = 'proof-diversity-v1';
const EVAL = 'packages/salon-secretary/evaluation';
/** The DEV union (development material, all in the repository). */
export const DEV_BATTERIES: readonly { id: string; file: string }[] = [
  { id: 'c4dev', file: `${EVAL}/agenda-practice-c4dev.json` }, { id: 'c4rules', file: `${EVAL}/agenda-practice-c4rules.json` },
  { id: 'variations', file: `${EVAL}/agenda-practice-variations.json` },
  { id: 'natural', file: `${EVAL}/agenda-practice-natural.json` }, { id: 'scenarios', file: `${EVAL}/agenda-practice-scenarios.json` },
  { id: 'scenarios-r2', file: `${EVAL}/agenda-practice-scenarios-r2.json` }, { id: 'scenarios-r3', file: `${EVAL}/agenda-practice-scenarios-r3.json` },
  { id: 'golden-30', file: `${EVAL}/free-use-golden-30.json` }, { id: 'multi-salon-dev', file: DEV_FILE }];
/** Run day the relative day specs are normalized on (any fixed day: only equality of two specs matters). */
const TODAY = '2026-09-28';
const THRESHOLDS = [0.6, 0.8] as const;

// ---------------------------------------------------------------- small helpers
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const share = (x: number, n: number) => n ? r3(x / n) : null;
const uniq = <T,>(xs: Iterable<T>) => [...new Set(xs)];
const sortedUniq = (xs: Iterable<string>) => uniq(xs).sort();
const fold = (s: string) => foldWords(s).join(' ');
const hist = (xs: readonly (string | number)[]) => Object.fromEntries(Object.entries(xs.reduce<Record<string, number>>((m, x) => { m[String(x)] = (m[String(x)] ?? 0) + 1; return m; }, {}))
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
const dist = (xs: readonly number[]) => {
  if (!xs.length) return { n: 0, mean: null, p50: null, p90: null, max: null };
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, mean: r3(s.reduce((a, b) => a + b, 0) / s.length), p50: r3(quantile(s, 0.5)), p90: r3(quantile(s, 0.9)), max: r3(s[s.length - 1]) };
};
/** A label printed only when it is a plain code (a capability tag, a field, an op kind): never a phrase. */
const CODE = /^[a-z0-9][a-z0-9_.:-]{0,47}$/;
const safe = (label: string) => CODE.test(label) ? label : 'label-omitted';
const safeKeys = (h: Record<string, number>) => Object.entries(h).reduce<Record<string, number>>((m, [k, v]) => { const c = safe(k); m[c] = (m[c] ?? 0) + v; return m; }, {});
const DAY_TEMPLATE = /\{\{\s*d:\s*[^|{}]+?\s*\|\s*([a-z]+)\s*\}\}/gi;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------- units
export type ProofText = { kind: 'say' | 'answer'; turn: number; text: string };
/** Structure of one scenario. `ops`: primary operation kinds (sorted multiset); `alter`: secondary changes of a write;
 * `trajectory`: step kinds (S say, C confirm, L select, H choose); the rest are sorted codes. */
export type Signature = { ops: string[]; alter: string[]; actions: number; mustAsk: string[]; answers: string[]; trajectory: string; turns: number; refs: string[]; flags: string[] };
export type ProofContext = { type: string; hours: string; open: number; closed: number; breaks: number; shifts: string[]; pros: number; services: number; durations: number[];
  initial: number; conflict: boolean; busyTarget: boolean; days: string[]; clocks: string[] };
export type ProofUnit = { id: string; source: string; oracle: 'final' | 'tags' | 'golden'; texts: ProofText[]; people: string[]; pros: string[]; services: string[]; catalog: string[];
  tags: string[]; sig: Signature; ctx: ProofContext; combo: string[]; opOrder: string[]; mode: string | null };
export type Battery = { id: string; units: ProofUnit[] };

type Appt = { customer: string; pro: string; services: string[]; day: number | null; spec: string; time: string; used?: boolean; gone?: boolean };
const dayNorm = (spec: DaySpec) => { try { return dayOffset(spec, TODAY); } catch { return null; } };
const specKey = (spec: DaySpec) => typeof spec === 'number' ? `+${spec}` : fold(spec).replace(/ /g, '') || String(spec);
const eqList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
function serviceChange(before: readonly string[], after: readonly string[]) {
  if (eqList(before, after)) return null;
  if (before.every(s => after.includes(s))) return 'service-add';
  if (after.every(s => before.includes(s))) return 'service-remove';
  return 'service-replace';
}
const READ_KIND: Record<string, string> = { 'appointment.list': 'read:agenda', 'availability.get': 'read:availability', 'appointment.read': 'read:appointment' };
const readKind = (op: string) => READ_KIND[op] ?? `read:${op}`;
function readOpsFromTags(tags: readonly string[]) {
  const out: string[] = [];
  if (tags.some(t => ['availability', 'multi-service-availability', 'read-availability-any-pro'].includes(t))) out.push('read:availability');
  if (tags.some(t => ['day-agenda', 'read-salon-day'].includes(t))) out.push('read:agenda');
  if (tags.includes('read-next-appointment')) out.push('read:appointment');
  if (!out.length && tags.some(t => t === 'read' || t === 'reads')) out.push('read');
  return out;
}
/** Tag vocabularies of the batteries, normalized to codes (hand-written and generated batteries name the same thing differently). */
const REF_TAGS: Record<string, string> = { reference: 'reference', references: 'reference', pronoun: 'reference', context: 'reference', 'released-slot': 'released-slot' };
const FLAG_TAGS: Record<string, string> = { negation: 'negation', withdrawal: 'negation', 'date-negated-current': 'negation', correction: 'correction', 'self-correction': 'correction',
  insistence: 'insistence', 'hard-block-insistence': 'insistence', 'alter-refused': 'refusal', 'recurrence-guard': 'refusal', conditional: 'conditional' };
const ALTER_TAGS: Record<string, string> = { 'alter-add-service': 'service-add', 'alter-remove-service': 'service-remove', 'alter-replace-service': 'service-replace',
  'change-professional': 'change-professional', 'alter-professional': 'change-professional' };
const refsOf = (tags: readonly string[]) => sortedUniq(tags.flatMap(t => t.startsWith('ref-') ? [t] : REF_TAGS[t] ? [REF_TAGS[t]] : []));
const flagsOf = (tags: readonly string[]) => sortedUniq(tags.flatMap(t => FLAG_TAGS[t] ? [FLAG_TAGS[t]] : []));

/** Verbs of each write kind as owners say them (the order of the first mention gives the textual order of the actions). */
const OP_VERBS: Record<string, readonly string[]> = {
  create: ['marca', 'marcar', 'marque', 'agenda', 'agende', 'agendar', 'coloca', 'coloque', 'colocar', 'bota', 'boto', 'anota', 'anote', 'poe', 'encaixa', 'encaixe', 'reserva', 'reserve', 'inclui', 'inclua'],
  reschedule: ['remarca', 'remarcar', 'remarque', 'passa', 'passe', 'passar', 'muda', 'mude', 'mudar', 'joga', 'jogue', 'transfere', 'transfira', 'reagenda', 'reagende', 'move', 'adianta', 'atrasa', 'empurra'],
  cancel: ['cancela', 'cancele', 'cancelar', 'desmarca', 'desmarque', 'desmarcar', 'tira', 'tire'],
  block: ['bloqueia', 'bloqueie', 'bloquear', 'fecha', 'feche', 'fechar', 'trava', 'trave', 'tranca', 'tranque', 'reserva'] };
function textualOrder(texts: readonly ProofText[], ops: readonly string[]) {
  const words = texts.filter(t => t.kind === 'say').flatMap(t => foldWords(t.text.replace(DAY_TEMPLATE, ' ')));
  const kinds = uniq(ops.map(o => o === 'change-professional' || o.startsWith('service-') ? 'reschedule' : o).filter(o => OP_VERBS[o]));
  const at = (k: string) => { const i = words.findIndex(w => OP_VERBS[k].includes(w)); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  return kinds.sort((a, b) => at(a) - at(b) || (a < b ? -1 : 1));
}

type FixtureView = { customers: { key: string; name: string }[]; professionals: { key: string; name: string }[]; services: { key: string; name: string; durationMin: number }[] };
type HoursView = { key: string; weekdays?: number[]; fromMinutes?: number; toMinutes?: number; windows?: { weekday: number; startMinutes: number; endMinutes: number }[] };
/** Weekly windows as one pattern code: weekdays with the same windows grouped ("12345=09:00-19:00;6=08:00-17:00"). */
export function hoursPattern(windows: readonly { weekday: number; from: string; to: string }[]) {
  const byDay = new Map<number, string[]>();
  for (const w of [...windows].sort((a, b) => a.weekday - b.weekday || (a.from < b.from ? -1 : 1))) byDay.set(w.weekday, [...byDay.get(w.weekday) ?? [], `${w.from}-${w.to}`]);
  const groups = new Map<string, number[]>();
  for (const [d, ws] of byDay) groups.set(ws.join(','), [...groups.get(ws.join(',')) ?? [], d]);
  return [...groups].sort((a, b) => a[1][0] - b[1][0]).map(([ws, days]) => `${days.join('')}=${ws}`).join(';');
}
function agendaUnit(s: AgendaScenario, source: string): ProofUnit {
  let fx: FixtureView, hours: HoursView[] = [];
  try { const built = buildScenarioFixture(s, TODAY) as unknown as { fixture: FixtureView; hours: HoursView[] }; fx = built.fixture; hours = built.hours; }
  catch { fx = { customers: [...BASE_FIXTURE.customers, ...(s.customers ?? []).map(c => ({ key: c.key ?? '', name: c.name }))], professionals: [...BASE_FIXTURE.professionals],
    services: s.salon ? s.salon.services.map(x => ({ key: x.key ?? '', name: x.name, durationMin: x.durationMin })) : BASE_FIXTURE.services }; }
  const byKey = <T extends { key: string; name: string }>(list: readonly T[], k: string) => list.find(x => x.key === k)?.name ?? k;
  const tags = [...s.capability];
  const texts: ProofText[] = [];
  let turn = 0;
  for (const step of s.steps ?? []) if ('say' in step && typeof step.say === 'string') texts.push({ kind: 'say', turn: turn++, text: step.say });
  for (const spec of Object.values(s.answers ?? {})) for (const v of answerInstances(spec)) for (const text of Array.isArray(v) ? v : [v]) texts.push({ kind: 'answer', turn: -1, text });
  const initial: Appt[] = (s.appointments ?? []).map(a => ({ customer: fold(byKey(fx.customers, a.customer)), pro: fold(byKey(fx.professionals, a.professional)),
    services: appointmentServiceKeys(a).map(k => fold(byKey(fx.services, k))).sort(), day: dayNorm(a.day), spec: specKey(a.day), time: a.time }));
  const f = s.final, ops: string[] = [], alter: string[] = [];
  let oracle: ProofUnit['oracle'] = 'final';
  const written: Appt[] = [];
  if (!f) {
    oracle = 'tags';
    ops.push(...['create', 'reschedule', 'cancel', 'block'].filter(t => tags.includes(t)), ...readOpsFromTags(tags));
  } else {
    if (!f.unchanged) for (const a of f.appointments ?? []) {
      const x: Appt = { customer: fold(a.customer), pro: fold(a.professional ?? ''), services: a.service.split('+').map(fold).sort(), day: dayNorm(a.day), spec: specKey(a.day), time: a.time };
      const cands = initial.filter(i => !i.used && i.customer === x.customer), slot = (i: Appt) => i.day === x.day && i.time === x.time;
      const match = cands.find(i => slot(i) && (!x.pro || i.pro === x.pro) && eqList(i.services, x.services)) ?? cands.find(slot)
        ?? cands.find(i => (!x.pro || i.pro === x.pro) && eqList(i.services, x.services)) ?? cands[0];
      if (match) match.used = true;
      if (a.status === 'CANCELLED') { ops.push('cancel'); if (match) match.gone = true; continue; }
      if (!match) { ops.push('create'); written.push(x); if (x.services.length > 1) alter.push('multi-service'); continue; }
      const kinds = [...(slot(match) ? [] : ['reschedule']), ...(x.pro && match.pro !== x.pro ? ['change-professional'] : []), ...[serviceChange(match.services, x.services)].filter((k): k is string => !!k)];
      if (kinds.length) { ops.push(kinds[0]); alter.push(...kinds.slice(1)); written.push(x); if (!slot(match)) match.gone = true; }
    }
    for (const _ of f.blocks ?? []) ops.push('block');
    if (f.read) ops.push(...(Array.isArray(f.read.operation) ? f.read.operation : [f.read.operation]).map(readKind));
    else if (f.unchanged) ops.push(...readOpsFromTags(tags));
  }
  alter.push(...tags.flatMap(t => ALTER_TAGS[t] ? [ALTER_TAGS[t]] : []).filter(k => !ops.includes(k)));
  if (!ops.length) ops.push('none');
  const trajectory = (s.steps ?? []).map(st => 'say' in st ? 'S' : 'confirm' in st ? 'C' : 'select' in st ? 'L' : 'choose' in st ? 'H' : '').join('');
  const sig: Signature = { ops: [...ops].sort(), alter: sortedUniq(alter), actions: ops.filter(o => o !== 'none').length, mustAsk: sortedUniq(f?.mustAsk ?? []),
    answers: sortedUniq(Object.keys(s.answers ?? {})), trajectory, turns: turn, refs: refsOf(tags), flags: flagsOf(tags) };
  // ---- context
  const windows = s.salon ? s.salon.hours : (s.openWeekdays ?? BASE_FIXTURE.openWeekdays).map(weekday => ({ weekday, from: hhmm(BASE_FIXTURE.openMinutes), to: hhmm(BASE_FIXTURE.closeMinutes) }));
  const open = uniq(windows.map(w => w.weekday)), perDay = open.map(d => windows.filter(w => w.weekday === d).length);
  const salonPattern = hoursPattern(windows);
  const shifts = hours.flatMap(h => {
    const p = h.windows ? hoursPattern(h.windows.map(w => ({ weekday: w.weekday, from: hhmm(w.startMinutes), to: hhmm(w.endMinutes) })))
      : `${(h.weekdays ?? open).join('')}=${hhmm(h.fromMinutes ?? BASE_FIXTURE.openMinutes)}-${hhmm(h.toMinutes ?? BASE_FIXTURE.closeMinutes)}`;
    return p === salonPattern ? [] : [p];
  });
  const finalAppts = f && !f.unchanged ? f.appointments ?? [] : [];
  const busyTarget = written.some(w => initial.some(i => !i.gone && i.pro === w.pro && i.day === w.day && i.customer !== w.customer));
  const ctx: ProofContext = { type: s.salon ? s.salon.type ?? 'salon' : 'base-fixture', hours: salonPattern, open: open.length, closed: 7 - open.length, breaks: perDay.filter(n => n > 1).length,
    shifts: sortedUniq(shifts), pros: s.salon ? (s.professionals ?? []).length : BASE_FIXTURE.professionals.length + (s.professionals ?? []).length, services: fx.services.length,
    durations: uniq(fx.services.map(x => x.durationMin)).sort((a, b) => a - b), initial: initial.length,
    conflict: tags.some(t => ['conflict', 'overlap', 'hard-block', 'hard-block-insistence'].includes(t)), busyTarget,
    days: sortedUniq([...finalAppts.map(a => specKey(a.day)), ...(f?.blocks ?? []).map(b => specKey(b.day)), ...(f?.read?.day !== undefined ? [specKey(f.read.day)] : [])]),
    clocks: sortedUniq([...finalAppts.map(a => a.time), ...(f?.blocks ?? []).flatMap(b => [b.from, b.to])]) };
  // ---- entities (declared or referenced)
  const people = sortedUniq([...(s.customers ?? []).map(c => c.name), ...(s.appointments ?? []).map(a => byKey(fx.customers, a.customer)), ...finalAppts.map(a => a.customer)].map(fold));
  const pros = sortedUniq([...(s.professionals ?? []).map(p => p.name), ...(s.appointments ?? []).map(a => byKey(fx.professionals, a.professional)),
    ...finalAppts.flatMap(a => a.professional ? [a.professional] : []), ...(f?.blocks ?? []).map(b => b.professional), ...(f?.read?.professional ? [f.read.professional] : [])].map(fold));
  const services = sortedUniq([...(s.appointments ?? []).flatMap(a => appointmentServiceKeys(a).map(k => byKey(fx.services, k))), ...finalAppts.flatMap(a => a.service.split('+')),
    ...(f?.read?.service ? [f.read.service] : [])].map(fold).filter(Boolean));
  const mode = tags.includes('mode-voice') || tags.includes('voice') || tags.includes('dictated') ? 'voice' : tags.includes('mode-typing') ? 'typing' : null;
  const unit: ProofUnit = { id: s.id, source, oracle, texts, people, pros, services, catalog: sortedUniq(fx.services.map(x => fold(x.name))), tags, sig, ctx, combo: [], opOrder: textualOrder(texts, sig.ops), mode };
  unit.combo = combination(unit);
  return unit;
}

type GoldenAction = { operation?: string };
type GoldenTurn = { message: string; expect?: { actions?: GoldenAction[]; confirmable?: boolean }; when?: { missingAny?: string[] } | null };
type GoldenFile = { fixture?: { customers?: { name: string }[]; professionals?: { name: string }[]; services?: { name: string; durationMin: number }[]; appointments?: unknown[];
  openWeekdays?: number[]; openMinutes?: number; closeMinutes?: number }; cases?: { id: string; family?: string; turns: GoldenTurn[] }[] };
const GOLDEN_OP: Record<string, string> = { 'appointment.create': 'create', 'appointment.change': 'reschedule', 'appointment.cancel': 'cancel', 'schedule.block': 'block' };
function goldenUnits(g: GoldenFile, source: string): ProofUnit[] {
  const fx = g.fixture ?? {}, open = fx.openWeekdays ?? [1, 2, 3, 4, 5], from = hhmm(fx.openMinutes ?? 540), to = hhmm(fx.closeMinutes ?? 1080);
  const catalog = (fx.services ?? []).map(x => x.name), hours = hoursPattern(open.map(weekday => ({ weekday, from, to })));
  return (g.cases ?? []).map(c => {
    const texts = c.turns.map((t, i) => ({ kind: 'say' as const, turn: i, text: t.message }));
    const best = [...c.turns].map(t => t.expect?.actions ?? []).reduce((a, b) => b.length >= a.length ? b : a, [] as GoldenAction[]);
    const ops = best.map(a => a.operation ?? '').filter(Boolean).map(op => GOLDEN_OP[op] ?? (/read|list|get|report|search|balance/.test(op) ? readKind(op) : `other:${op}`));
    if (!ops.length) ops.push('none');
    const said = new Set(texts.flatMap(t => foldWords(t.text)));
    const mentioned = (names: readonly string[]) => sortedUniq(names.filter(n => said.has(foldWords(n)[0] ?? '')).map(fold));
    const sig: Signature = { ops: [...ops].sort(), alter: [], actions: ops.filter(o => o !== 'none').length, mustAsk: sortedUniq(c.turns.flatMap(t => t.when?.missingAny ?? [])),
      answers: [], trajectory: c.turns.map(t => t.expect?.confirmable ? 'SC' : 'S').join(''), turns: c.turns.length, refs: [], flags: [] };
    const unit: ProofUnit = { id: c.id, source, oracle: 'golden', texts, people: mentioned((fx.customers ?? []).map(x => x.name)), pros: mentioned((fx.professionals ?? []).map(x => x.name)),
      services: mentioned(catalog), catalog: sortedUniq(catalog.map(fold)), tags: [], sig,
      ctx: { type: 'golden-fixture', hours, open: open.length, closed: 7 - open.length, breaks: 0, shifts: [], pros: (fx.professionals ?? []).length, services: catalog.length,
        durations: uniq((fx.services ?? []).map(x => x.durationMin)).sort((a, b) => a - b), initial: (fx.appointments ?? []).length, conflict: false, busyTarget: false, days: [], clocks: [] },
      combo: [], opOrder: textualOrder(texts, sig.ops), mode: null };
    unit.combo = combination(unit);
    return unit;
  });
}
/** Units of a parsed battery: AgendaScenario[] or the Golden format. */
export function unitsOf(raw: unknown, source: string): ProofUnit[] {
  if (Array.isArray(raw)) return (raw as AgendaScenario[]).map(s => agendaUnit(s, source));
  if (raw && typeof raw === 'object' && Array.isArray((raw as GoldenFile).cases)) return goldenUnits(raw as GoldenFile, source);
  throw Error('PROOF_DIVERSITY_FORMAT');
}
export const readBattery = (file: string, source: string) => unitsOf(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')), source);
export function devUnion(root: string = process.cwd()): { batteries: Battery[]; bank: string[]; bankNames: string[]; bankServices: string[] } {
  const batteries = DEV_BATTERIES.filter(b => existsSync(join(root, b.file))).map(b => ({ id: b.id, units: readBattery(join(root, b.file), b.id) }));
  const corpus = exampleBankCorpus(root);
  return { batteries, bank: renderedBankMessages(root).map(x => x.text), bankNames: corpus.names, bankServices: corpus.services };
}

// ---------------------------------------------------------------- M5 canonical capability codes
const AMBIGUITY_TAGS = ['homonym', 'homonym-professional', 'service-homonym', 'look-alike-names', 'nickname', 'service-ambiguous', 'entity', 'first-name', 'typo', 'common-typo'];
const MULTI_SERVICE_TAGS = ['multiservice', 'multi-service-create', 'several-services', 'service-combo', 'multi-service-availability'];
/** Capability tags that change what the Secretária must work out (the hours of the salon or of a professional only when the
 * outcome depends on them: a professional's own shift or the hours profile of a generated salon are M4 context, and the
 * reason said inline is wording). */
const HOURS_TAGS: Record<string, string> = { 'hours-by-tenant': 'daypart-by-hours', 'bare-hour': 'daypart-by-hours', 'daypart-single': 'daypart-by-hours', 'daypart-ask': 'missing-daypart',
  'closed-day': 'closed-day', 'morning-only': 'pro-shift-outcome', 'recurrence': 'recurrence', 'month-end': 'date-boundary', 'relative-week': 'date-next-week',
  'date-after-interval': 'date-inherited', 'ref-shared-day': 'date-inherited', 'word-name': 'name-is-word', 'name-temporal': 'name-is-word', 'name-service': 'name-is-word', 'honorific': 'honorific',
  'one-eligible': 'one-eligible', 'pro-service-mismatch': 'pro-service-mismatch', 'two-appointments': 'several-bookings-of-customer' };
/** A missing-information field as one code whatever the battery calls it (mustAsk "service_ref", tag "ask-service"). */
const ASK_TAG: Record<string, string> = { 'ask-time': 'time', 'ask-service': 'service', 'ask-reason': 'reason', 'ask-appointment': 'appointment', 'ask-date': 'date', 'ask-professional': 'professional' };
const missingCode = (field: string) => `missing-${field.replace(/_ref$/, '').replace(/^service_name$/, 'service')}`;
/** Canonical capability codes of a scenario: what it exercises, not how it is worded (surface tags such as mode, style,
 * date/time form, name group or salon type are left out: they are M1/M4/M6 dimensions). */
export function combination(u: Pick<ProofUnit, 'sig' | 'tags' | 'ctx' | 'oracle'>) {
  const out = new Set<string>(u.sig.ops.filter(o => o !== 'none'));
  if (u.sig.ops.includes('none')) out.add('no-write');
  for (const a of u.sig.alter) out.add(a === 'multi-service' ? 'multi-service' : a);
  if (u.sig.actions >= 2) out.add('multi-action');
  if (u.sig.actions >= 3) out.add('three-plus-actions');
  for (const m of u.sig.mustAsk) out.add(missingCode(m));
  if (u.oracle === 'tags') for (const f of u.sig.answers) out.add(missingCode(f)); // legacy batteries: the scripted replies are the expected questions
  for (const t of u.tags) {
    if (ASK_TAG[t]) out.add(missingCode(ASK_TAG[t]));
    if (AMBIGUITY_TAGS.includes(t)) out.add('entity-ambiguity');
    if (MULTI_SERVICE_TAGS.includes(t)) out.add('multi-service');
    if (HOURS_TAGS[t]) out.add(HOURS_TAGS[t]);
  }
  for (const f of u.sig.flags) out.add(f);
  if (u.sig.refs.length) out.add('reference');
  if (u.sig.refs.includes('released-slot')) out.add('released-slot');
  if (u.ctx.conflict) out.add('conflict');
  if (u.sig.turns >= 2) out.add('multi-turn');
  return [...out].sort();
}
const comboKey = (u: ProofUnit) => u.combo.join('|');
const opsKey = (u: ProofUnit) => u.sig.ops.join('+');

// ---------------------------------------------------------------- M1 text similarity
/** Words that only agree in gender with an entity ("o Anselmo" / "a Jurema", "no sábado" / "na sexta"): one form. */
const GENDERED: Record<string, string> = { o: 'a', os: 'as', do: 'da', dos: 'das', pro: 'pra', pros: 'pras', ele: 'ela', eles: 'elas', dele: 'dela', deles: 'delas', no: 'na', nos: 'nas',
  um: 'uma', num: 'numa', dum: 'duma', ao: 'a', aos: 'as', pelo: 'pela', pelos: 'pelas', esse: 'essa', este: 'esta', aquele: 'aquela', nesse: 'nessa', neste: 'nesta', naquele: 'naquela',
  desse: 'dessa', deste: 'desta', daquele: 'daquela', seu: 'sua', meu: 'minha', outro: 'outra', mesmo: 'mesma', todo: 'toda', lo: 'la' };
/** Entity-masked ORDERED skeleton: person names <name>, service words <svc>, weekdays and relative days <day>, digits and
 * spoken numbers <num> (a dictated number "vinte e oito" is one), gender agreement neutral, consecutive equal masks
 * collapsed. Equal skeletons are the same sentence with other entities: a pure entity swap. */
export function skeletonTokens(text: string, names: ReadonlySet<string>, serviceWords: ReadonlySet<string>) {
  const words = foldWords(text.replace(DAY_TEMPLATE, (_, format: string) => /^weekday/i.test(format) ? ' segunda ' : ' 0 '));
  const out = words.map(w => {
    const m = [...maskedTokens(w, names)][0] ?? w;
    return m === MASK.weekday || w === 'hoje' || w === 'amanha' ? '<day>' : m === MASK.number ? '<num>' : m === MASK.name ? '<name>' : serviceWords.has(w) ? '<svc>' : GENDERED[w] ?? w;
  });
  for (let i = 1; i + 1 < out.length; i++) if (out[i] === 'e' && out[i - 1] === '<num>' && (out[i + 1] === '<num>' || ['um', 'uma', 'meia'].includes(words[i + 1]))) { out[i] = '<num>'; out[i + 1] = '<num>'; }
  return out.filter((t, i) => !(t.startsWith('<') && out[i - 1] === t));
}
type Prepared = { plain: ReadonlySet<string>; masked: ReadonlySet<string>; skel: string | null; bag: string | null; fn: string[] };
/** Portuguese function words (folded): what the syntax of a message is made of once its content words are classes. */
const FUNCTION_WORDS = new Set(('a o as os um uma uns umas de do da dos das dum duma em no na nos nas num numa por pelo pela pelos pelas para pra pro pras pros com sem ao aos e ou mas que se ' +
  'porque pq quando onde como qual quais quem ele ela eles elas dele dela deles delas lhe me mim te eu voce vc nos gente meu minha meus minhas seu sua seus suas esse essa esses essas isso ' +
  'este esta estes estas isto aquele aquela aquilo naquele naquela nesse nessa neste nesta desse dessa deste desta daquele daquela nao sim nem ja tambem so mais menos muito bem la aqui ai ' +
  'entao depois antes ate desde sobre entre mesmo mesma outro outra outros outras todo toda todos todas tudo foi ser estar tem ter vai vou pode favor ta tava era sera fica ficar deixa').split(' '));
function prepare(text: string, names: ReadonlySet<string>, serviceWords: ReadonlySet<string>): Prepared {
  const skel = skeletonTokens(text, names, serviceWords), min = STATS.frameMinTokens;
  return { plain: new Set(foldWords(text.replace(/\{\{[^{}]*\}\}/g, ' '))), masked: maskedTokens(text, names), skel: skel.length >= min ? skel.join(' ') : null,
    bag: skel.length >= min ? sortedUniq(skel).join(' ') : null, fn: skel.map(t => t.startsWith('<') ? t : FUNCTION_WORDS.has(t) ? t : 'W') };
}
const grams3 = (fn: readonly string[]) => { const s = ['^', ...fn, '$']; return s.length < 3 ? [] : Array.from({ length: s.length - 2 }, (_, i) => s.slice(i, i + 3).join(' ')); };
/** Overlap gate of multi-salon/overlap.ts: identity counts from the frame size, a near score only between texts of OVERLAP_NEAR_MIN_TOKENS. */
const gated = (a: Prepared, b: Prepared) => {
  if (a.masked.size < STATS.frameMinTokens || b.masked.size < STATS.frameMinTokens) return 0;
  const best = Math.max(jaccard(a.masked, b.masked), jaccard(a.plain, b.plain));
  return best >= 1 || Math.min(a.masked.size, b.masked.size) >= OVERLAP_NEAR_MIN_TOKENS ? best : 0;
};
function textSimilarity(set: readonly ProofUnit[], devTexts: readonly Prepared[], prep: (t: string) => Prepared) {
  const skels = new Set(devTexts.flatMap(p => p.skel ? [p.skel] : [])), bags = new Set(devTexts.flatMap(p => p.bag ? [p.bag] : []));
  const rows = set.flatMap(u => u.texts.map(t => {
    const p = prep(t.text); let plain = 0, masked = 0, gate = 0;
    for (const d of devTexts) { const a = jaccard(p.plain, d.plain), b = jaccard(p.masked, d.masked), g = gated(p, d); if (a > plain) plain = a; if (b > masked) masked = b; if (g > gate) gate = g; }
    return { id: u.id, kind: t.kind, plain, masked, gate, short: p.skel === null, skel: !!p.skel && skels.has(p.skel), bag: !!p.bag && bags.has(p.bag) };
  }));
  const count = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).length;
  const byUnit = new Map<string, typeof rows>(); for (const r of rows) byUnit.set(r.id, [...byUnit.get(r.id) ?? [], r]);
  const units = [...byUnit.values()];
  return { texts: rows.length, says: count(r => r.kind === 'say'), answers: count(r => r.kind === 'answer'), devTexts: devTexts.length,
    plainJaccard: dist(rows.map(r => r.plain)), maskedJaccard: dist(rows.map(r => r.masked)), gatedScore: dist(rows.map(r => r.gate)),
    gated: { ge060: count(r => r.gate >= 0.6), ge080: count(r => r.gate >= 0.8), eq100: count(r => r.gate >= 1) },
    rawMasked: { ge060: count(r => r.masked >= 0.6), ge080: count(r => r.masked >= 0.8), eq100: count(r => r.masked >= 1) },
    entitySwap: { skeletonIdentical: count(r => r.skel), bagIdentical: count(r => r.bag), sayskeletonIdentical: count(r => r.kind === 'say' && r.skel), shortTexts: count(r => r.short),
      scenariosWithSkeletonIdentical: units.filter(rs => rs.some(r => r.skel)).length, scenariosAllSaysIdentical: units.filter(rs => rs.some(r => r.kind === 'say') && rs.filter(r => r.kind === 'say').every(r => r.skel)).length },
    scenarioMaxGated: dist(units.map(rs => Math.max(...rs.map(r => r.gate)))),
    perScenario: units.map(rs => ({ id: rs[0].id, maxGated: r3(Math.max(...rs.map(r => r.gate))), maxMasked: r3(Math.max(...rs.map(r => r.masked))), skeletonIdentical: rs.filter(r => r.skel).length })) };
}

// ---------------------------------------------------------------- M2 names
function nameOverlap(set: readonly ProofUnit[], dev: readonly ProofUnit[], key: 'people' | 'pros' | 'services' | 'catalog') {
  const a = new Set(set.flatMap(u => u[key])), b = new Set(dev.flatMap(u => u[key])), occurrences = set.flatMap(u => u[key]);
  const firstA = new Set([...a].map(n => n.split(' ')[0])), firstB = new Set([...b].map(n => n.split(' ')[0]));
  return { distinct: a.size, devDistinct: b.size, jaccard: r3(jaccard(a, b)), shared: [...a].filter(n => b.has(n)).length, occurrences: occurrences.length,
    occurrencesSeenInDev: share(occurrences.filter(n => b.has(n)).length, occurrences.length),
    firstWordJaccard: r3(jaccard(firstA, firstB)), occurrencesFirstWordSeenInDev: share(occurrences.filter(n => firstB.has(n.split(' ')[0])).length, occurrences.length) };
}

// ---------------------------------------------------------------- M3 structure
const COMPONENTS = ['ops', 'alter', 'mustAsk', 'answers', 'trajectory', 'refs', 'flags'] as const;
const componentKeys = (s: Signature) => COMPONENTS.map(c => JSON.stringify(s[c]));
export const signatureKey = (s: Signature) => componentKeys(s).join('#');
function structure(set: readonly ProofUnit[], dev: readonly ProofUnit[], setPrep: Prepared[], devPrep: Prepared[]) {
  const devKeys = new Set(dev.map(u => signatureKey(u.sig))), devComps = dev.map(u => componentKeys(u.sig));
  const rows = set.map(u => {
    const k = signatureKey(u.sig), c = componentKeys(u.sig), exact = devKeys.has(k);
    const near = !exact && devComps.some(d => d.filter((x, i) => x !== c[i]).length === 1);
    const differing = exact ? [] : COMPONENTS.filter((_, i) => !devComps.some(d => d[i] === c[i]));
    return { id: u.id, key: k, exact, near, differing };
  });
  const skels = setPrep.flatMap(p => p.skel ? [p.skel] : []), devGrams = new Set(devPrep.flatMap(p => grams3(p.fn))), setGrams = setPrep.map(p => grams3(p.fn));
  const distinctGrams = uniq(setGrams.flat());
  return { scenarios: rows.length, distinctSignatures: new Set(rows.map(r => r.key)).size, devDistinctSignatures: devKeys.size,
    exactInDev: rows.filter(r => r.exact).length, nearDev: rows.filter(r => r.near).length, novel: rows.filter(r => !r.exact && !r.near).length,
    exactShare: share(rows.filter(r => r.exact).length, rows.length), nearShare: share(rows.filter(r => r.near).length, rows.length),
    componentsUnseenInDev: hist(rows.flatMap(r => r.differing)),
    syntax: { texts: setPrep.length, withSkeleton: skels.length, distinctSkeletons: new Set(skels).size, distinctSkeletonRatio: share(new Set(skels).size, skels.length),
      functionTrigrams: distinctGrams.length, functionTrigramsUnseenInDev: distinctGrams.filter(g => !devGrams.has(g)).length,
      functionTrigramsUnseenShare: share(distinctGrams.filter(g => !devGrams.has(g)).length, distinctGrams.length),
      textsWithUnseenTrigram: setGrams.filter(gs => gs.some(g => !devGrams.has(g))).length },
    perScenario: rows.map(r => ({ id: r.id, exact: r.exact, near: r.near, differing: r.differing })) };
}

// ---------------------------------------------------------------- M4 operational context
const contextKey = (u: ProofUnit) => `${u.ctx.hours}|${u.ctx.shifts.join(',')}`;
function context(set: readonly ProofUnit[], dev: readonly ProofUnit[]) {
  const devTypes = new Set(dev.map(u => u.ctx.type)), devHours = new Set(dev.map(u => u.ctx.hours)), devCtx = new Set(dev.map(contextKey)), devShifts = new Set(dev.flatMap(u => u.ctx.shifts));
  const devDur = new Set(dev.flatMap(u => u.ctx.durations)), n = set.length;
  // a salon type label is a category: printed as its folded slug when it is at most four words, never as free text
  const typeCode = (label: string) => { const w = foldWords(label); return w.length && w.length <= 4 ? safe(w.join('-')) : 'label-omitted'; };
  return { scenarios: n, types: safeKeys(hist(set.map(u => typeCode(u.ctx.type)))),
    typesAbsentFromDev: share(set.filter(u => !devTypes.has(u.ctx.type)).length, n),
    hoursPatterns: new Set(set.map(u => u.ctx.hours)).size, devHoursPatterns: devHours.size, hoursPatternAbsentFromDev: share(set.filter(u => !devHours.has(u.ctx.hours)).length, n),
    distinctHoursPatternsAbsentFromDev: new Set(set.map(u => u.ctx.hours).filter(h => !devHours.has(h))).size,
    contexts: new Set(set.map(contextKey)).size, contextAbsentFromDev: share(set.filter(u => !devCtx.has(contextKey(u))).length, n),
    withBreak: set.filter(u => u.ctx.breaks > 0).length, withProShift: set.filter(u => u.ctx.shifts.length > 0).length,
    proShiftPatternsAbsentFromDev: new Set(set.flatMap(u => u.ctx.shifts).filter(s => !devShifts.has(s))).size,
    closedDays: hist(set.map(u => u.ctx.closed)), openDays: hist(set.map(u => u.ctx.open)), professionals: dist(set.map(u => u.ctx.pros)), services: dist(set.map(u => u.ctx.services)),
    distinctDurations: new Set(set.flatMap(u => u.ctx.durations)).size, durationsAbsentFromDev: new Set(set.flatMap(u => u.ctx.durations).filter(d => !devDur.has(d))).size,
    preExistingBookings: dist(set.map(u => u.ctx.initial)), withPreExistingBookings: set.filter(u => u.ctx.initial > 0).length,
    conflictTagged: set.filter(u => u.ctx.conflict).length, busyTargetDay: set.filter(u => u.ctx.busyTarget).length };
}

// ---------------------------------------------------------------- M5 combinations
function combinations(set: readonly ProofUnit[], dev: readonly ProofUnit[]) {
  const devCombos = new Set(dev.map(comboKey)), devOps = new Set(dev.map(opsKey)), devCodes = new Set(dev.flatMap(u => u.combo));
  const novel = set.filter(u => !devCombos.has(comboKey(u)));
  return { scenarios: set.length, distinctCombinations: new Set(set.map(comboKey)).size, devDistinctCombinations: devCombos.size,
    combinationAbsentFromDev: novel.length, combinationAbsentShare: share(novel.length, set.length),
    opSetAbsentFromDev: set.filter(u => !devOps.has(opsKey(u))).length, distinctOpSets: new Set(set.map(opsKey)).size,
    codesAbsentFromDev: sortedUniq(set.flatMap(u => u.combo).filter(c => !devCodes.has(c))).map(safe),
    codeCounts: safeKeys(hist(set.flatMap(u => u.combo))),
    novelCombinations: Object.fromEntries(Object.entries(hist(novel.map(u => u.combo.map(safe).join('+')))).slice(0, 40)) };
}

// ---------------------------------------------------------------- M6 the owner's 14 dimensions (heuristic counts)
const FILLERS = new Set(['né', 'ne', 'tipo', 'então', 'entao', 'hum', 'ahn', 'olha', 'sabe', 'aí', 'ó', 'daí', 'pô', 'cara', 'mano', 'oxe', 'uai', 'bah', 'tchê', 'visse', 'eita', 'hein', 'ah', 'eh', 'tá']);
const ABBREVIATIONS = new Set(['vc', 'pq', 'q', 'tb', 'tbm', 'hj', 'msm', 'qdo', 'cmg', 'blz', 'obg', 'pfv', 'pf', 'amn', 'dps', 'td', 'n', 'c', 'p', 'qto', 'hrs', 'hr']);
const USUALLY_ACCENTED = new Set(['amanha', 'horario', 'horarios', 'sabado', 'voce', 'nao', 'tambem', 'ja', 'servico', 'servicos', 'ate', 'entao', 'terca', 'proximo', 'proxima', 'so', 'la', 'esta', 'numero']);
const rawTokens = (text: string) => text.toLocaleLowerCase('pt-BR').split(/[^\p{L}\p{N}/]+/u).filter(Boolean);
export function voiceMarkers(text: string) {
  const raw = text.replace(/\{\{[^{}]*\}\}/g, ' 0 '), tokens = rawTokens(raw), folded = foldWords(raw), punct = (raw.match(/[.,;:!?…]/g) ?? []).length;
  const spoken = folded.some(w => !/\d/.test(w) && maskedTokens(w, new Set()).has(MASK.number));
  return { noPunct: punct === 0, runOn: folded.length >= 18 && punct <= 1, filler: tokens.some(t => FILLERS.has(t)), spokenNumber: spoken, lowerStart: /^\p{Ll}/u.test(raw.trim()),
    noAccents: !/[\u00C0-\u00FF]/.test(raw) && folded.some(w => USUALLY_ACCENTED.has(w)), abbreviation: tokens.some(t => ABBREVIATIONS.has(t)), digits: /\d/.test(text.replace(/\{\{[^{}]*\}\}/g, ' ')) };
}
const REF_PATTERNS: Record<string, RegExp> = {
  pronoun: /\b(ele|ela|eles|elas|dele|dela|deles|delas)\b/, 'same-time': /\b(mesmo horario|mesma hora|mesmo hora)\b/, 'same-day': /\b(mesmo dia|mesma data)\b/,
  'that-time': /\b(aquele|esse|nesse|naquele|desse|daquele|neste|este|o) horario (dela|dele|que|da|do)\b|\b(aquele|esse|nesse|naquele|desse|daquele) horario\b/, 'in-place': /\bno lugar\b/,
  'same-professional': /\bmesm[oa] (profissional|barbeir[oa]|cabeleireir[oa]|manicure|pessoa|atendente|esteticista)\b/, 'same-service': /\bmesmo (servico|procedimento|tratamento)\b/,
  released: /\b(vagou|liberou|sobrou|ficou livre|que abriu)\b/, 'the-same': /\b(o mesmo|a mesma|os mesmos|as mesmas)\b/ };
const NEGATION = /\b(nao|nem|nunca|jamais|esquece|esqueca|desiste|desisti|desisto|desconsidera|desconsidere|deixa pra la|deixa quieto)\b/;
const CORRECTION = /\b(quer dizer|na verdade|ops|opa|errei|corrigindo|alias|digo|melhor dizendo|me enganei|foi mal)\b/;
const CLOCK_FORMS: Record<string, RegExp> = { 'hh-h': /\b\d{1,2}h(?![\d])/, 'hh-hmm': /\b\d{1,2}h\d{2}\b/, colon: /\b\d{1,2}:\d{2}\b/, 'hh-horas': /\b\d{1,2} ?horas?\b/,
  'bare-number': /\b(as|das|pras|para as|ate as|a partir das) \d{1,2}(?![\d:h/])/, spoken: /\b(uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze) (hora|horas|e meia|e quinze|da manha|da tarde|da noite|da madrugada)\b/,
  'meio-dia': /\bmeio[- ]dia\b/, 'part-of-day': /\bda (manha|tarde|noite|madrugada)\b/ };
const DAY_FORMS: Record<string, RegExp> = { weekday: /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/, 'weekday-feira': /\b(segunda|terca|quarta|quinta|sexta)[- ]feira\b/,
  relative: /\b(hoje|amanha|depois de amanha)\b/, 'dia-n': /\bdia \d{1,2}\b/, ddmm: /\b\d{1,2}\/\d{1,2}\b/, 'dia-spoken': /\bdia (primeiro|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta)\b/,
  'next-week': /\b(semana que vem|proxima semana)\b/ };
/** Folded words joined by spaces (reference, negation and correction patterns). */
const foldedText = (text: string) => ` ${foldWords(text).join(' ')} `;
/** Lower case without accents, punctuation kept ("14:00", "29/09" survive), day templates rendered as their form code. */
const formText = (text: string) => ` ${text.replace(DAY_TEMPLATE, (_, f: string) => ` template-${f.toLowerCase()} `).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ')} `;
const templateForms = (text: string) => [...text.matchAll(DAY_TEMPLATE)].map(m => `template-${m[1].toLowerCase()}`);
function dimensions(set: readonly ProofUnit[], dev: readonly ProofUnit[], prep: (t: string) => Prepared, ctx: ReturnType<typeof context>, combos: ReturnType<typeof combinations>) {
  const texts = set.flatMap(u => u.texts), says = texts.filter(t => t.kind === 'say'), n = set.length;
  const setPrep = texts.map(t => prep(t.text)), devPrep = dev.flatMap(u => u.texts.map(t => prep(t.text)));
  const content = (p: Prepared) => (p.skel ?? '').split(' ').filter(w => w && !w.startsWith('<') && !FUNCTION_WORDS.has(w));
  const devVocab = new Set(devPrep.flatMap(content)), vocab = setPrep.map(content), distinctVocab = uniq(vocab.flat());
  // (3) the same intent said another way: per intent (op set), first-say skeleton bags, and the ones a DEV scenario of the SAME intent already has
  const firstBag = (u: ProofUnit) => { const t = u.texts.find(x => x.kind === 'say'); return t ? prep(t.text).bag : null; };
  const devBags = new Map<string, Set<string>>();
  for (const u of dev) { const b = firstBag(u); if (b) devBags.set(opsKey(u), new Set([...devBags.get(opsKey(u)) ?? [], b])); }
  const intents = uniq(set.map(opsKey)), withBag = set.filter(u => firstBag(u));
  const markers = texts.map(t => voiceMarkers(t.text)), m = (k: keyof ReturnType<typeof voiceMarkers>) => markers.filter(x => x[k]).length;
  const refCounts = Object.fromEntries(Object.entries(REF_PATTERNS).map(([k, re]) => [k, says.filter(t => re.test(foldedText(t.text))).length]));
  const clockForms = Object.fromEntries(Object.entries(CLOCK_FORMS).map(([k, re]) => [k, texts.filter(t => re.test(formText(t.text))).length]));
  const dayForms = { ...Object.fromEntries(Object.entries(DAY_FORMS).map(([k, re]) => [k, texts.filter(t => re.test(formText(t.text))).length])), ...hist(texts.flatMap(t => templateForms(t.text))) };
  const devDays = new Set(dev.flatMap(u => u.ctx.days)), devClocks = new Set(dev.flatMap(u => u.ctx.clocks)), days = uniq(set.flatMap(u => u.ctx.days)), clocks = uniq(set.flatMap(u => u.ctx.clocks));
  const multi = set.filter(u => u.sig.actions >= 2), devOrders = new Set(dev.filter(u => u.sig.actions >= 2).map(u => u.opOrder.join('>')));
  const devTraj = new Set(dev.map(u => `${u.sig.trajectory}|${u.sig.answers.join(',')}`));
  return {
    d01_wording: { distinctContentWords: distinctVocab.length, contentWordsUnseenInDev: distinctVocab.filter(w => !devVocab.has(w)).length,
      contentWordsUnseenShare: share(distinctVocab.filter(w => !devVocab.has(w)).length, distinctVocab.length), textsWithUnseenWord: vocab.filter(v => v.some(w => !devVocab.has(w))).length, texts: texts.length },
    d02_syntax: 'see M3.syntax',
    d03_sameIntentOtherWays: { intents: intents.length, intentsAbsentFromDev: intents.filter(k => !devBags.has(k)).length,
      distinctFirstSayBagsPerIntent: dist(intents.map(k => new Set(set.filter(u => opsKey(u) === k).map(firstBag).filter(Boolean)).size)),
      firstSaysEntitySwapOfSameIntentDev: withBag.filter(u => devBags.get(opsKey(u))?.has(firstBag(u)!)).length, firstSays: withBag.length },
    d04_operationalContext: { types: Object.keys(ctx.types).length, contextAbsentFromDev: ctx.contextAbsentFromDev, typesAbsentFromDev: ctx.typesAbsentFromDev },
    d05_hoursAndShifts: { hoursPatterns: ctx.hoursPatterns, hoursPatternAbsentFromDev: ctx.hoursPatternAbsentFromDev, withBreak: ctx.withBreak, withProShift: ctx.withProShift, closedDays: ctx.closedDays },
    d06_temporal: { distinctFinalDaySpecs: days.length, daySpecsUnseenInDev: days.filter(d => !devDays.has(d)).length, distinctFinalClocks: clocks.length, clocksUnseenInDev: clocks.filter(c => !devClocks.has(c)).length,
      clockForms, dayForms, distinctDurations: ctx.distinctDurations, conflictTagged: ctx.conflictTagged, busyTargetDay: ctx.busyTargetDay },
    d07_capabilityCombinations: { distinct: combos.distinctCombinations, absentFromDev: combos.combinationAbsentFromDev },
    d08_actionsCountAndOrder: { actions: hist(set.map(u => u.sig.actions)), multiAction: multi.length, distinctTextualOrders: new Set(multi.map(u => u.opOrder.join('>'))).size,
      textualOrdersUnseenInDev: multi.filter(u => !devOrders.has(u.opOrder.join('>'))).length, orders: hist(multi.map(u => u.opOrder.join('>'))) },
    d09_missingInformation: { withMustAsk: set.filter(u => u.sig.mustAsk.length).length, mustAskFields: safeKeys(hist(set.flatMap(u => u.sig.mustAsk))), withAnswers: set.filter(u => u.sig.answers.length).length,
      missingPatternUnseenInDev: set.filter(u => !dev.some(d => d.sig.mustAsk.join() === u.sig.mustAsk.join() && d.sig.answers.join() === u.sig.answers.join() && opsKey(d) === opsKey(u))).length,
      answerFields: safeKeys(hist(set.flatMap(u => u.sig.answers))) },
    d10_negationCorrection: { saysWithNegationWord: says.filter(t => NEGATION.test(foldedText(t.text))).length, saysWithCorrectionMarker: says.filter(t => CORRECTION.test(foldedText(t.text))).length,
      laterTurnNegationOrCorrection: set.filter(u => u.texts.some(t => t.kind === 'say' && t.turn > 0 && (NEGATION.test(foldedText(t.text)) || CORRECTION.test(foldedText(t.text))))).length,
      scenarioFlags: hist(set.flatMap(u => u.sig.flags)) },
    d11_references: { saysByKind: refCounts, saysWithAnyReference: says.filter(t => Object.values(REF_PATTERNS).some(re => re.test(foldedText(t.text)))).length,
      scenarioRefTags: safeKeys(hist(set.flatMap(u => u.sig.refs))) },
    d12_multiTurn: { sayTurns: hist(set.map(u => u.sig.turns)), multiTurnScenarios: set.filter(u => u.sig.turns >= 2).length, trajectories: hist(set.map(u => u.sig.trajectory)),
      trajectoriesWithAnswersUnseenInDev: set.filter(u => !devTraj.has(`${u.sig.trajectory}|${u.sig.answers.join(',')}`)).length },
    d13_simpleVsMulti: { simple: set.filter(u => u.sig.actions <= 1).length, multiAction: multi.length, threePlus: set.filter(u => u.sig.actions >= 3).length, scenarios: n },
    d14_typedVsVoice: { texts: texts.length, noPunctuation: m('noPunct'), runOn: m('runOn'), filler: m('filler'), spokenNumber: m('spokenNumber'), lowercaseStart: m('lowerStart'),
      noAccents: m('noAccents'), abbreviation: m('abbreviation'), withDigits: m('digits'),
      voiceLike: markers.filter(x => x.noPunct && (x.spokenNumber || x.filler || x.runOn)).length, scenarioModes: hist(set.map(u => u.mode ?? 'unlabelled')) },
  };
}

// ---------------------------------------------------------------- generated instances: templates shared with DEV
const TEMPLATE_ID = /^M[DH](\d{2})[A-Z]\d+$/;
export const templateOf = (id: string) => { const m = TEMPLATE_ID.exec(id); return m ? `T${m[1]}` : null; };
const tagValue = (u: ProofUnit, prefix: string) => u.tags.filter(t => t.startsWith(prefix)).sort().join(',');
function templateReport(set: readonly ProofUnit[], dev: readonly ProofUnit[], prep: (t: string) => Prepared) {
  const held = set.filter(u => templateOf(u.id) && u.id.startsWith('MH'));
  if (!held.length) return null;
  const devBy = new Map<string, ProofUnit[]>();
  for (const u of dev) { const t = u.id.startsWith('MD') ? templateOf(u.id) : null; if (t) devBy.set(t, [...devBy.get(t) ?? [], u]); }
  const perTemplate = hist(held.map(u => templateOf(u.id)!)), shared = held.filter(u => devBy.has(templateOf(u.id)!));
  const names = (u: ProofUnit) => new Set([...u.people, ...u.pros].flatMap(n => n.split(' ')));
  const saySkels = (u: ProofUnit) => new Set(u.texts.filter(t => t.kind === 'say').map(t => prep(t.text).skel).filter((s): s is string => !!s));
  const parts: Record<string, (u: ProofUnit, d: ProofUnit) => boolean> = {
    wording: (u, d) => { const a = saySkels(u), b = saySkels(d); return [...a].some(s => b.has(s)); },
    names: (u, d) => { const a = names(u), b = names(d); return [...a].some(w => b.has(w)); },
    'salon-type': (u, d) => u.ctx.type === d.ctx.type, hours: (u, d) => u.ctx.hours === d.ctx.hours, 'pro-shift': (u, d) => u.ctx.shifts.join() === d.ctx.shifts.join(),
    'day-specs': (u, d) => u.ctx.days.join() === d.ctx.days.join(), clocks: (u, d) => u.ctx.clocks.join() === d.ctx.clocks.join(),
    services: (u, d) => u.services.join() === d.services.join(), 'catalog-size': (u, d) => u.ctx.services === d.ctx.services, 'team-size': (u, d) => u.ctx.pros === d.ctx.pros,
    'pre-existing-bookings': (u, d) => u.ctx.initial === d.ctx.initial, mode: (u, d) => u.mode === d.mode, 'date-form': (u, d) => tagValue(u, 'date-') === tagValue(d, 'date-'),
    'time-form': (u, d) => tagValue(u, 'time-') === tagValue(d, 'time-'), register: (u, d) => tagValue(u, 'register-') === tagValue(d, 'register-'),
    'regional-style': (u, d) => tagValue(u, 'style-') === tagValue(d, 'style-'),
    ops: (u, d) => opsKey(u) === opsKey(d), 'missing-info': (u, d) => u.sig.mustAsk.join() === d.sig.mustAsk.join(), 'answer-fields': (u, d) => u.sig.answers.join() === d.sig.answers.join(),
    trajectory: (u, d) => u.sig.trajectory === d.sig.trajectory, 'action-count': (u, d) => u.sig.actions === d.sig.actions,
    signature: (u, d) => signatureKey(u.sig) === signatureKey(d.sig), combination: (u, d) => comboKey(u) === comboKey(d) };
  const varies = Object.fromEntries(Object.entries(parts).map(([code, same]) => {
    const differsFromAll = shared.filter(u => devBy.get(templateOf(u.id)!)!.every(d => !same(u, d))).length;
    return [code, { differsFromAllDevSiblings: differsFromAll, sameAsSomeDevSibling: shared.length - differsFromAll }];
  }));
  const sim = shared.map(u => { const sib = devBy.get(templateOf(u.id)!)!.flatMap(d => d.texts.map(t => prep(t.text)));
    return Math.max(0, ...u.texts.filter(t => t.kind === 'say').map(t => { const p = prep(t.text); return Math.max(0, ...sib.map(s => jaccard(p.masked, s.masked))); })); });
  return { instances: held.length, templates: Object.keys(perTemplate).length, devTemplates: devBy.size, instancesPerTemplate: dist(Object.values(perTemplate)),
    templatesAbsentFromDev: Object.keys(perTemplate).filter(t => !devBy.has(t)).length, instancesSharingTemplateWithDev: shared.length, shareSharingTemplateWithDev: share(shared.length, held.length),
    devSiblingsPerInstance: dist(shared.map(u => devBy.get(templateOf(u.id)!)!.length)), maxSayMaskedJaccardVsSiblings: dist(sim), parts: varies };
}

// ---------------------------------------------------------------- the report
export type MeasureOptions = { perScenario?: boolean; bank?: readonly string[]; extraNames?: readonly string[]; extraServices?: readonly string[] };
/** Masking vocabularies of a comparison: every person name and every service word both sides show. */
function vocabularies(units: readonly ProofUnit[], o: MeasureOptions) {
  const serviceNames = [...units.flatMap(u => [...u.catalog, ...u.services]), ...(o.extraServices ?? [])];
  const names = nameTokens([...units.flatMap(u => [...u.people, ...u.pros]), ...(o.extraNames ?? [])], serviceNames);
  const serviceWords = new Set(serviceNames.flatMap(foldWords).filter(w => w.length >= 2 && !FUNCTION_WORDS.has(w) && !names.has(w)));
  return { names, serviceWords };
}
function baseReport(label: string, set: readonly ProofUnit[], dev: readonly Battery[], o: MeasureOptions) {
  const devUnits = dev.flatMap(b => b.units), { names, serviceWords } = vocabularies([...set, ...devUnits], o);
  const cache = new Map<string, Prepared>(), prep = (t: string) => { let p = cache.get(t); if (!p) { p = prepare(t, names, serviceWords); cache.set(t, p); } return p; };
  const devTexts = [...devUnits.flatMap(u => u.texts.map(t => prep(t.text))), ...(o.bank ?? []).map(prep)], setPrep = set.flatMap(u => u.texts.map(t => prep(t.text)));
  const devOwn = devUnits.flatMap(u => u.texts.map(t => prep(t.text)));
  const m1 = textSimilarity(set, devTexts, prep), m3 = structure(set, devUnits, setPrep, devOwn), m4 = context(set, devUnits), m5 = combinations(set, devUnits);
  const report = { version: PROOF_DIVERSITY_VERSION, set: safe(label), scenarios: set.length, oracle: hist(set.map(u => u.oracle)),
    dev: { batteries: Object.fromEntries(dev.map(b => [b.id, b.units.length])), scenarios: devUnits.length, texts: devOwn.length, bankTexts: (o.bank ?? []).length },
    M1_textSimilarity: o.perScenario ? m1 : { ...m1, perScenario: undefined },
    M2_nameOverlap: { customers: nameOverlap(set, devUnits, 'people'), professionals: nameOverlap(set, devUnits, 'pros'), servicesUsed: nameOverlap(set, devUnits, 'services'),
      catalog: nameOverlap(set, devUnits, 'catalog') },
    M3_structure: o.perScenario ? m3 : { ...m3, perScenario: undefined }, M4_context: m4, M5_combinations: m5,
    M6_dimensions: dimensions(set, devUnits, prep, m4, m5), templates: templateReport(set, devUnits, prep) };
  return report;
}
type BaseReport = ReturnType<typeof baseReport>;
/** M1-M6 of `set` against the DEV batteries (and the bank texts for M1), with the heuristic verdict: counts, ids and codes only. */
export function measureSet(label: string, set: readonly ProofUnit[], dev: readonly Battery[], o: MeasureOptions = {}) {
  const report = baseReport(label, set, dev, o);
  return JSON.parse(JSON.stringify({ ...report, verdict: verdictOf(report) })) as BaseReport & { verdict: ReturnType<typeof verdictOf> };
}
/** Heuristic verdict per owner dimension, from thresholds fixed here before any proof set was measured: VARIED, PARTIAL or
 * NOT_VARIED (with the numbers it read). A reading aid for the counts above, not a gate. */
export const VERDICT_RULES = { entitySwapShare: 0.2, nearTextShare: 0.05, unseenWordShare: 0.3, unseenTrigramShare: 0.3, skeletonRatio: 0.8, context: 0.5, combination: 0.3,
  opSet: 0.1, missing: 0.1, flagged: 0.1, references: 0.15, multiTurn: 0.15, multiLow: 0.2, multiHigh: 0.8, voice: 0.1, typed: 0.3 } as const;
type Verdict3 = 'VARIED' | 'PARTIAL' | 'NOT_VARIED';
function verdictOf(r: BaseReport) {
  const V = VERDICT_RULES, n = Math.max(1, r.scenarios), m1 = r.M1_textSimilarity, m3 = r.M3_structure, m4 = r.M4_context, m5 = r.M5_combinations, d = r.M6_dimensions, texts = Math.max(1, m1.texts);
  const tri = (varied: boolean, partial: boolean): Verdict3 => varied ? 'VARIED' : partial ? 'PARTIAL' : 'NOT_VARIED';
  const swap = m1.entitySwap.skeletonIdentical / texts, near = m1.gated.ge080 / texts, flagged = r.scenarios ? Object.values(d.d10_negationCorrection.scenarioFlags).reduce((a, b) => a + b, 0) / n : 0;
  const says = Math.max(1, m1.says), multi = d.d13_simpleVsMulti.multiAction / n, typed = 1 - d.d14_typedVsVoice.voiceLike / texts;
  return {
    d01_wording: swap >= V.entitySwapShare ? 'NOT_VARIED' : tri((d.d01_wording.contentWordsUnseenShare ?? 0) >= V.unseenWordShare && near <= V.nearTextShare, true),
    d02_syntax: m1.entitySwap.bagIdentical / texts >= V.entitySwapShare ? 'NOT_VARIED' : tri((m3.syntax.functionTrigramsUnseenShare ?? 0) >= V.unseenTrigramShare && (m3.syntax.distinctSkeletonRatio ?? 0) >= V.skeletonRatio, true),
    d03_sameIntentOtherWays: tri(d.d03_sameIntentOtherWays.firstSaysEntitySwapOfSameIntentDev / Math.max(1, d.d03_sameIntentOtherWays.firstSays) <= V.nearTextShare, true),
    d04_operationalContext: tri((m4.contextAbsentFromDev ?? 0) >= V.context, (m4.contextAbsentFromDev ?? 0) > 0),
    d05_hoursAndShifts: tri((m4.hoursPatternAbsentFromDev ?? 0) >= V.context && m4.withProShift > 0, (m4.hoursPatternAbsentFromDev ?? 0) > 0 || m4.withProShift > 0),
    d06_temporal: tri(d.d06_temporal.distinctFinalClocks >= 10 && d.d06_temporal.distinctDurations >= 5 && d.d06_temporal.conflictTagged + d.d06_temporal.busyTargetDay > 0, d.d06_temporal.distinctFinalClocks > 1),
    d07_capabilityCombinations: tri((m5.combinationAbsentShare ?? 0) >= V.combination, m5.combinationAbsentFromDev > 0),
    d08_actionsCountAndOrder: tri(m5.opSetAbsentFromDev / n >= V.opSet, m5.opSetAbsentFromDev > 0 || d.d08_actionsCountAndOrder.textualOrdersUnseenInDev > 0),
    d09_missingInformation: tri(d.d09_missingInformation.missingPatternUnseenInDev / n >= V.missing, d.d09_missingInformation.missingPatternUnseenInDev > 0),
    d10_negationCorrection: tri(flagged >= V.flagged && m3.novel + m3.nearDev > 0, flagged > 0),
    d11_references: tri(d.d11_references.saysWithAnyReference / says >= V.references && Object.values(d.d11_references.saysByKind).filter(x => x > 0).length >= 3, d.d11_references.saysWithAnyReference > 0),
    d12_multiTurn: tri(d.d12_multiTurn.multiTurnScenarios / n >= V.multiTurn && d.d12_multiTurn.trajectoriesWithAnswersUnseenInDev > 0, d.d12_multiTurn.multiTurnScenarios > 0),
    d13_simpleAndMulti: tri(multi >= V.multiLow && multi <= V.multiHigh, multi > 0),
    d14_typedAndVoice: tri(d.d14_typedVsVoice.voiceLike / texts >= V.voice && typed >= V.typed, d.d14_typedVsVoice.voiceLike > 0),
    structureSharedWithDev: { signatureExactShare: m3.exactShare, combinationAbsentFromDev: m5.combinationAbsentFromDev, templatesSharedShare: r.templates?.shareSharingTemplateWithDev ?? null },
    entitySwapOnly: swap >= V.entitySwapShare && (m3.exactShare ?? 0) >= 0.9 };
}
/** Reference: every DEV battery against the rest of the union (leave one battery out). */
export function devBaseline(root: string = process.cwd(), o: MeasureOptions = {}) {
  const u = devUnion(root), opts = { ...o, bank: u.bank, extraNames: u.bankNames, extraServices: u.bankServices };
  const perBattery = Object.fromEntries(u.batteries.map(b => [b.id, measureSet(`dev-${b.id}`, b.units, u.batteries.filter(x => x.id !== b.id), opts)]));
  return { version: PROOF_DIVERSITY_VERSION, set: 'dev-baseline', method: 'leave-one-battery-out', perBattery, summary: summarize(perBattery) };
}
type Report = ReturnType<typeof measureSet>;
/** Headline numbers of reports (one line per set). */
export function summarize(reports: Record<string, Report>) {
  return Object.fromEntries(Object.entries(reports).map(([k, r]) => [k, { scenarios: r.scenarios, texts: r.M1_textSimilarity.texts,
    maskedJaccardMean: r.M1_textSimilarity.maskedJaccard.mean, maskedJaccardP90: r.M1_textSimilarity.maskedJaccard.p90, gatedGe080: r.M1_textSimilarity.gated.ge080,
    gatedEq100: r.M1_textSimilarity.gated.eq100, skeletonIdentical: r.M1_textSimilarity.entitySwap.skeletonIdentical, bagIdentical: r.M1_textSimilarity.entitySwap.bagIdentical,
    customersSeenInDev: r.M2_nameOverlap.customers.occurrencesSeenInDev, servicesSeenInDev: r.M2_nameOverlap.servicesUsed.occurrencesSeenInDev,
    signatureExactShare: r.M3_structure.exactShare, signatureNearShare: r.M3_structure.nearShare, signaturesNovel: r.M3_structure.novel,
    distinctSkeletonRatio: r.M3_structure.syntax.distinctSkeletonRatio, functionTrigramsUnseenShare: r.M3_structure.syntax.functionTrigramsUnseenShare,
    hoursPatternAbsentFromDev: r.M4_context.hoursPatternAbsentFromDev, contextAbsentFromDev: r.M4_context.contextAbsentFromDev,
    combinationAbsentFromDev: r.M5_combinations.combinationAbsentFromDev, templatesSharedShare: r.templates?.shareSharingTemplateWithDev ?? null,
    notVaried: Object.entries(r.verdict).filter(([, v]) => v === 'NOT_VARIED').map(([k]) => k), partial: Object.entries(r.verdict).filter(([, v]) => v === 'PARTIAL').map(([k]) => k) }]));
}
