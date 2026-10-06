/** External HOLDOUT-side phrasings of the multi-salon generator (Candidate 4, Track H; evaluation only: no database, no
 * network, no model).
 *
 * templates.ts is readable by anyone, so the wording of the next holdout is written by an isolated author outside the
 * repository, against a machine-readable CONTRACT derived here from the templates (phrasesContract / writePhrasesContract):
 * per template and reply slot, the placeholders every phrasing must and may contain, the forms allowed, the literal rules and
 * one neutral sentence of intent. The contract copies no repository phrasing. loadHoldoutPhrases validates the author's file
 * fail closed, before anything is generated, and reports codes, slot ids and counts only (never a phrasing):
 * - the file lives outside every checkout, as given and as its real path (MULTI_SALON_PHRASES_INSIDE_REPO, checked before it
 *   is read), never in the sealed holdout folder, and its name says `phrases`;
 * - it declares this contract and its sha256 (MULTI_SALON_PHRASES_CONTRACT_MISMATCH) and contract slots only;
 * - every phrasing keeps its slot contract and the repository's own template checks (MULTI_SALON_PHRASES_CONTRACT:
 *   placeholders, forms, required bindings, no literal digit, day, clock, part of the day, person name or service, marks,
 *   the correction / withdrawal / decline literals, templateIssues);
 * - every slot has a phrasing in every mode its template allows (MULTI_SALON_PHRASES_INCOMPLETE: slot ids only);
 * - no phrasing is a repository phrasing once names, days, clocks, punctuation and word order are neutral (phraseKey): DEV,
 *   retired or the repository's own holdout side (MULTI_SALON_PHRASES_DUPLICATE: counts only);
 * - none is as close to a few-shot example-bank message as the bank gate allows (MULTI_SALON_PHRASES_OVERLAP: counts only).
 * The sha256 of the file's bytes, the contract's sha256 and the counts go to the holdout seal (generate.ts `main`). */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { foldedSpans } from '../agenda-practice-noise';
import { devBatteryMessages, devBatteryScenarios, exampleBankCorpus, foldWords, jaccard, nameTokens, renderedBankMessages, scenarioNames } from '../agenda-practice-stats';
import { isInside, sealedRepoRoots } from '../agenda-sealed';
import { EXTRA_SLOTS, GENERATOR_VERSION, PHRASE_NEAR, externalSlotIds, loadPools, neutralText, phraseCoverageGaps, phraseKey, phraseSides, repoNameCorpora, retiredPhrasings,
  templateIssues, type ExternalPhrases, type Pools } from './generate';
import { MULTI_SALON_OVERLAP_THRESHOLD, generatedDevScenarios, overlapHits, overlapNames } from './overlap';
import { TEMPLATES, type Mode, type Template, type Variant } from './templates';

export const PHRASES_CONTRACT_VERSION = 'multi-salon-phrases-contract-v4';
/** The sealed holdout folder: never read, never written (AGENT_RULES "Sealed holdouts"). */
const SEALED_DIR = 'secretary-holdout-sealed';
const PHRASES_NAME = /phrases[^\\/]*\.json$/i, CONTRACT_NAME = /phrases-contract[^\\/]*\.json$/i;
const SLOT_ID = /^(?:T\d{2}:(?:say\d|answer:[a-z_]{1,40})|daypart:time)$/;
const MAX_LENGTH = 320, MAX_DETAILS = 40;
const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const variantText = (v: Variant) => typeof v === 'string' ? v : v.t;
const variantMode = (v: Variant): Mode | null => typeof v === 'string' ? null : v.mode ?? null;
const fail = (code: string, details: string[] = []): never => {
  throw Object.assign(Error(code), details.length ? { details: details.length > MAX_DETAILS ? [...details.slice(0, MAX_DETAILS), `more:${details.length - MAX_DETAILS}`] : details } : {});
};

// ---------------------------------------------------------------- placeholders
const PLACEHOLDER = /\{([a-z][a-z0-9]*)(?:\.([A-Za-z]+))?\}/g;
type Kind = 'person' | 'service' | 'day' | 'time' | 'reason' | 'block-reason';
type Use = { name: string; attr: string };
const kindOf = (name: string): Kind | null => /^[cp]\d+h?$/.test(name) ? 'person' : /^s\d+$/.test(name) ? 'service' : /^d\d+$/.test(name) ? 'day' : /^h\d+$/.test(name) ? 'time'
  : name === 'motivo' ? 'reason' : name === 'bmotivo' ? 'block-reason' : null;
/** Naming forms (they say the value) and grammatical forms (articles and pronouns agreeing with a person; they name nobody). */
const ATTRS: Record<Kind, { naming: readonly string[]; grammar: readonly string[] }> = {
  person: { naming: ['', 'nome', 'sobrenome'], grammar: ['o', 'do', 'pro', 'ele', 'dele'] }, service: { naming: ['', 'nome'], grammar: [] },
  day: { naming: ['', 'na', 'pra', 'de'], grammar: [] }, time: { naming: ['', 'as', 'das', 'pras'], grammar: [] }, reason: { naming: ['', 'M'], grammar: [] },
  'block-reason': { naming: [''], grammar: [] } };
const VERBS = ['marcar', 'remarcar', 'cancelar', 'bloquear'];
const KNOWN_ATTRS = new Set([...Object.values(ATTRS).flatMap(a => [...a.naming, ...a.grammar]), ...VERBS, 'spec', 'hhmm', 'core']);
const uses = (text: string): Use[] => [...text.matchAll(PLACEHOLDER)].map(m => ({ name: m[1], attr: m[2] ?? '' }));
const form = (u: Use) => `{${u.name}${u.attr ? '.' + u.attr : ''}}`;
const naming = (u: Use) => { const k = kindOf(u.name); return !!k && ATTRS[k].naming.includes(u.attr); };
const LABEL: Record<Kind, string> = { person: 'person', service: 'service', day: 'day', time: 'clock', reason: 'cancellation reason', 'block-reason': 'block reason' };
const bindingLabel = (name: string) => name.startsWith('c') ? 'customer' : name.startsWith('p') ? 'professional' : LABEL[kindOf(name)!];

// ---------------------------------------------------------------- literal rules and intents (no repository phrasing)
export type LiteralRule = { kind: 'correction'; correct: string; wrong: string } | { kind: 'withdrawal' } | { kind: 'decline' };
const LITERAL_RULES: Readonly<Record<string, LiteralRule>> = {
  'T15:say0': { kind: 'correction', correct: 'h2', wrong: 'h3' }, 'T61:say0': { kind: 'correction', correct: 'p1', wrong: 'p2' },
  'T62:say0': { kind: 'correction', correct: 'd1', wrong: 'd2' }, 'T60:say1': { kind: 'withdrawal' }, 'T06:answer:override_requested': { kind: 'decline' } };
const WITHDRAWAL_WORDS = ['não', 'nem', 'esquece', 'esqueça', 'desisto', 'desisti', 'desiste', 'desconsidera', 'desconsidere'], DECLINE_WORDS = ['não', 'nem', 'sem'];
const LITERAL_DOC: Record<LiteralRule['kind'], string> = {
  correction: 'Self-correction inside one message: name both the intended and the rejected value and mark the correction with "e não" directly before the rejected value, or "quer dizer" directly before the intended value (typing and voice); a typing-only phrasing may instead protect it as "⟦... não, <intended>⟧" or "⟦, não <rejected>⟧". After each marker, the first of the two bindings decides.',
  withdrawal: `Withdrawal: the message contains one of the words ${WITHDRAWAL_WORDS.join(', ')}.`,
  decline: `Declining: the reply contains one of the words ${DECLINE_WORDS.join(', ')} (the double booking is refused).` };
/** Rules a template's structure calls for (a new correction, negation or conflict template needs its entry above). */
const neededRules = (t: Template) => [...(t.tags.includes('correction') ? [`${t.id}:say0`] : []), ...(t.tags.includes('negation') ? [`${t.id}:say${t.says.length - 1}`] : []),
  ...(t.answers?.override_requested ? [`${t.id}:answer:override_requested`] : [])];
const TIME_REPLY = (h: string) => `Reply to the question about the time: the owner gives clock ${h} and nothing else of substance.`;
const REASON_REPLY = (c: string) => `Reply to the question about the cancellation reason: the owner states reason motivo (about ${c}).`;
const BLOCK_REASON_REPLY = 'Reply to the question about why the schedule is blocked: the owner gives a short reason for p1\'s absence, optionally the errand bmotivo.';
/** One neutral sentence per slot: what the message means, never how a phrasing says it. */
const INTENTS: Readonly<Record<string, string>> = {
  'T01:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1, giving every detail in one message.',
  'T02:say0': 'Dictated by voice: the owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1.',
  'T03:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 without giving any clock, so the assistant must ask for the time.',
  'T03:answer:time': TIME_REPLY('h1'),
  'T04:say0': 'The owner asks to book customer c1 with professional p1 on day d1 at clock h1 without naming any service, so the assistant must ask which service.',
  'T04:answer:service_name': 'Reply to the question about the service: the owner names service s1.',
  'T04:answer:service_ref': 'Reply to the question about the service: the owner names service s1.',
  'T05:say0': 'The owner asks to book customer c1 for service s1 on day d1 at clock h1 without naming the professional (only one professional performs that service).',
  'T05:answer:professional_ref': 'Reply to the question about the professional: the owner names professional p1.',
  'T06:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1, giving every detail (that slot is already taken by another customer, which the owner does not mention).',
  'T06:answer:time': 'Reply after the assistant says the requested slot is taken: the owner proposes clock h2 instead.',
  'T06:answer:override_requested': 'Reply to the question whether to squeeze the booking in over the taken slot: the owner refuses the double booking and asks for clock h2 instead.',
  'T06:answer:destination_mode': 'Reply to the question whether to keep the taken slot or pick another time: the owner picks another time, clock h2.',
  'T06:answer:date': 'Reply to a question about the day: the owner confirms the same day d1.',
  'T07:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1 (the generator writes d1 as a weekday together with its date).',
  'T10:say0': 'The owner asks to move customer c1\'s existing booking on day d1 to clock h2 on the same day (the current clock h1 may be mentioned).',
  'T11:say0': 'The owner asks to move customer c1\'s booking from day d1 to day d2 at clock h2.',
  'T12:say0': 'The owner asks to move customer c1\'s booking to day d2 without giving the new clock, so the assistant must ask for it (the current day d1 may be mentioned).',
  'T12:answer:time': TIME_REPLY('h2'),
  'T13:say0': 'The owner asks to keep customer c1\'s booking on day d1 at the same clock but hand it to professional p2 (the current professional p1 and the clock h1 may be mentioned).',
  'T14:say0': 'Dictated by voice: the owner asks to move customer c1\'s booking from day d1 to day d2 at clock h2 (the professional p1 may be mentioned as staying the same).',
  'T15:say0': 'The owner asks to move customer c1\'s booking on day d1 to another clock and corrects the clock within the same message: h2 is intended, h3 is rejected.',
  'T20:say0': 'The owner asks to cancel customer c1\'s booking on day d1 and gives the reason motivo in the same message (the booking\'s clock h1 or service s1 may be mentioned).',
  'T20:answer:reason': REASON_REPLY('c1'),
  'T21:say0': 'The owner asks to cancel customer c1\'s booking on day d1 without giving a reason, so the assistant must ask for it (the booking\'s clock h1 or service s1 may be mentioned).',
  'T21:answer:reason': REASON_REPLY('c1'),
  'T22:say0': 'Dictated by voice: the owner asks to cancel customer c1\'s booking on day d1 and gives the reason motivo (the booking\'s clock h1 may be mentioned).',
  'T22:answer:reason': REASON_REPLY('c1'),
  'T23:say0': 'Customer c1 has two bookings: the owner asks to cancel only the one on day d2 (its clock h2 may be added) and gives the reason motivo; the other booking is not mentioned.',
  'T23:answer:reason': REASON_REPLY('c1'),
  'T24:say0': 'Customer c1 has two bookings: the owner asks to cancel c1\'s booking, giving the reason motivo but not saying which booking, so the assistant must ask which one.',
  'T24:answer:appointment_ref': 'Reply to the question about which booking: the owner points to the one on day d2 (its clock h2 may be added).',
  'T24:answer:date': 'Reply to the question about the day: the owner gives day d2.',
  'T24:answer:reason': REASON_REPLY('c1'),
  'T30:say0': 'The owner asks to block professional p1\'s schedule on day d1 from clock h1 to clock h2.',
  'T30:answer:reason': BLOCK_REASON_REPLY,
  'T31:say0': 'Dictated by voice: the owner asks to block professional p1\'s schedule on day d1 from clock h1 to clock h2.',
  'T31:answer:reason': BLOCK_REASON_REPLY,
  'T32:say0': 'The owner asks to block professional p1\'s schedule on day d1 from clock h1 to clock h2 and says in the same message that p1 will be away for the errand bmotivo.',
  'T32:answer:reason': 'Reply to the question about why the schedule is blocked: the owner says p1 will be away for the errand bmotivo.',
  'T35:say0': 'The owner asks what professional p1 has booked on day d1 (a read-only question: nothing is to change).',
  'T36:say0': 'The owner asks which free clocks professional p1 has on day d1 for service s1 (a read-only question: nothing is to change).',
  'T40:say0': 'The owner asks to book two customers with professional p1 on day d1, both for service s1 (s2 is the same service): c1 at clock h1 and c2 at clock h2.',
  'T41:say0': 'The owner asks to cancel customer c1\'s booking on day d1 for the reason motivo and to book customer c2 for service s1 in the slot that frees up (the clock h1 may be mentioned).',
  'T41:answer:reason': REASON_REPLY('c1'),
  'T42:say0': 'Two requests in one message: move customer c1\'s booking on day d1 to clock h2, and cancel customer c2\'s booking on day d2 for the reason motivo.',
  'T42:answer:reason': REASON_REPLY('c2'),
  'T43:say0': 'Two requests in one message: book customer c1 for service s1 with professional p1 on day d1 at clock h1, and block p1\'s schedule on day d1 from clock h2 to clock h3.',
  'T43:answer:reason': BLOCK_REASON_REPLY,
  'T44:say0': 'Three requests in one message: book customer c1 for service s1 with professional p1 on day d1 at clock h1; move customer c2\'s booking on day d2 to clock h3; cancel customer c3\'s booking on day d3 for the reason motivo.',
  'T44:answer:reason': REASON_REPLY('c3'),
  'T45:say0': 'Two bookings in one message: customer c1 for service s1 with professional p1 on day d1 at clock h1, and customer c2 for service s2 with professional p2 on day d2 at clock h2.',
  'T50:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1, naming c1 by the first name only (two customers share it, so the assistant must ask which one).',
  'T50:answer:customer_ref': 'Reply to the question about which customer: the owner gives c1\'s full name.',
  'T51:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1, naming p1 by the first name only (two professionals share it, so the assistant must ask which one).',
  'T51:answer:professional_ref': 'Reply to the question about which professional: the owner gives p1\'s full name.',
  'T52:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1, calling the customer by a nickname (the generator renders the naming form of c1 as that nickname).',
  'T52:answer:customer_ref': 'Reply to the question about which customer: the owner gives c1\'s full name (the nickname may be repeated).',
  'T53:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1, naming the service by a word two services share (the generator renders the naming form of s1 as that word).',
  'T53:answer:service_ref': 'Reply to the question about which service: the owner gives the full name of service s1.',
  'T53:answer:service_name': 'Reply to the question about which service: the owner gives the full name of service s1.',
  'T54:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1 (the customer\'s name looks like a weekday or a number).',
  'T55:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1 (the customer\'s name looks like a service word).',
  'T56:say0': 'The owner asks to move customer c1\'s booking on day d1 to clock h2, addressing the customer with a courtesy title (the generator renders the naming form of c1 as the title and first name; the current clock h1 may be mentioned).',
  'T57:say0': 'The owner asks to cancel customer c1\'s booking on day d1 for the reason motivo (the customer\'s name is also a common word; the booking\'s clock h1 may be mentioned).',
  'T57:answer:reason': REASON_REPLY('c1'),
  'T60:say0': 'The owner asks to book customer c1 for service s1 with professional p1 on day d1 at clock h1 (the next message withdraws this request).',
  'T60:say1': 'The owner withdraws the request just made, before any confirmation, asking that nothing be booked (no name, day or clock).',
  'T61:say0': 'The owner asks to book customer c1 for service s1 on day d1 at clock h1 and corrects the professional within the same message: p1 is intended, p2 is rejected.',
  'T62:say0': 'The owner asks to book customer c1 for service s1 with professional p1 at clock h1 and corrects the day within the same message: d1 is intended, d2 is rejected.',
  'daypart:time': 'Reply to the question whether a clock written without its part of the day means the early or the late reading: the owner restates clock h9 (the generator writes it with its part of the day).' };

// ---------------------------------------------------------------- the contract
type SlotSource = { slot: string; template: string | null; role: 'say' | 'answer'; turn: number | null; field: string | null; modes: Mode[]; list: readonly Variant[]; bindings: string[] };
export type SlotContract = { slot: string; template: string | null; role: 'say' | 'answer'; turn: number | null; field: string | null; modes: Mode[]; intent: string;
  required: string[]; optional: string[]; forms: Record<string, string[]>; verbs: string[]; forbidden: string[];
  literal: (LiteralRule & { rule: string }) | null; minPerMode: number; recommendedPerMode: number };
/** Bindings a template's texts and oracle use (the plan's homonym twins c1h/p1h never appear in a text). */
const templateBindings = (t: Template) => [...new Set([...JSON.stringify([t.says, t.answers ?? {}, t.final]).matchAll(PLACEHOLDER)].map(m => m[1]).filter(n => n !== 'v'))].sort();
/** Every message and reply slot of the templates (and the extra reply slots) with its repository phrasings, both sides. */
export function repositorySlots(templates: readonly Template[] = TEMPLATES): SlotSource[] {
  return [...templates.flatMap(t => {
    const bindings = templateBindings(t), ids = externalSlotIds(t);
    return [...t.says.map((list, i) => ({ slot: ids[i], template: t.id, role: 'say' as const, turn: i + 1, field: null, modes: [...t.modes], list, bindings })),
      ...Object.entries(t.answers ?? {}).map(([f, list]) => ({ slot: `${t.id}:answer:${f}`, template: t.id, role: 'answer' as const, turn: null, field: f, modes: [...t.modes], list, bindings }))];
  }), ...EXTRA_SLOTS.map(x => ({ slot: x.id, template: null, role: 'answer' as const, turn: null, field: x.id.split(':')[1], modes: ['typing', 'voice'] as Mode[], list: x.list, bindings: ['h9'] }))];
}
/** A slot's contract, from the placeholders of ALL its repository phrasings (the same contract as the repository's own):
 * `required` = the bindings every phrasing names; `forms` = the naming forms any phrasing uses (persons and services: exactly
 * those, so an ambiguity template keeps its short or full form; days, clocks and reasons: any naming form) plus every
 * grammatical form of a person it uses; `verbs` = the command verbs any phrasing uses; `forbidden` = the template's other bindings. */
function slotContract(s: SlotSource): SlotContract {
  const per = s.list.map(v => uses(variantText(v))), named = per.map(us => new Set(us.filter(naming).map(u => u.name)));
  const forms = new Map<string, Set<string>>(), verbs = new Set<string>();
  for (const u of per.flat()) {
    if (u.name === 'v') { verbs.add(form(u)); continue; }
    const k = kindOf(u.name) ?? fail('MULTI_SALON_CONTRACT_PLACEHOLDER', [s.slot]), set = forms.get(u.name) ?? new Set<string>();
    forms.set(u.name, set);
    if (k === 'person' || k === 'service') { if (ATTRS[k].naming.includes(u.attr)) set.add(form(u)); } else ATTRS[k].naming.forEach(attr => set.add(form({ name: u.name, attr })));
    ATTRS[k].grammar.forEach(attr => set.add(form({ name: u.name, attr })));
  }
  const required = [...named[0] ?? []].filter(n => named.every(x => x.has(n))).sort(), rule = LITERAL_RULES[s.slot];
  return { slot: s.slot, template: s.template, role: s.role, turn: s.turn, field: s.field, modes: s.modes, intent: INTENTS[s.slot] ?? fail('MULTI_SALON_CONTRACT_INTENT_MISSING', [s.slot]),
    required, optional: [...forms.keys()].filter(n => !required.includes(n)).sort(), forms: Object.fromEntries([...forms].sort(([a], [b]) => a < b ? -1 : 1).map(([n, set]) => [n, [...set].sort()])),
    verbs: [...verbs].sort(), forbidden: s.bindings.filter(n => !forms.has(n)), literal: rule ? { ...rule, rule: LITERAL_DOC[rule.kind] } : null, minPerMode: 1, recommendedPerMode: 3 };
}
const TEMPORAL_DISPLAY = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo', 'feira', 'hoje', 'amanhã', 'ontem', 'manhã', 'tarde', 'noite', 'madrugada',
  'meio-dia', 'meia', 'meia-noite', 'hora', 'horas', 'minuto', 'minutos', 'semana', 'semanas', 'mês', 'meses'];
/** Single temporal words (folded); "meio-dia" is caught as the span "meio dia" ("dia" alone is an ordinary word here). */
const TEMPORAL = new Set(TEMPORAL_DISPLAY.filter(w => !w.includes('-')).flatMap(foldWords));
const CLOCK_PHRASE = / (?:as|das|pras|ate|para as) (?:uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|meio) /;
const PLACEHOLDER_DOC = {
  syntax: '{binding} or {binding.attribute}: customers c1 c2 c3, professionals p1 p2, services s1 s2 s3, days d1 d2 d3, clocks h1 h2 h3 h4 (and h9 in the daypart reply), motivo (cancellation reason), bmotivo (block reason), v (command verb). A slot lists the exact forms it accepts.',
  person: { '{c1}': 'how the owner names the person: the first name (in some templates a nickname, or a courtesy title with the first name: see the slot intent)',
    '{c1.nome}': 'the full stored name', '{c1.sobrenome}': 'the surname', '{c1.o}': 'article agreeing with the person (a / o)', '{c1.do}': 'da / do', '{c1.pro}': 'pra / pro',
    '{c1.ele}': 'ela / ele', '{c1.dele}': 'dela / dele', note: 'the same forms exist for every customer and professional binding; the grammatical forms render no name and never count as naming the person' },
  service: { '{s1}': 'the service as the owner says it (its name; in the shared-word template the word two services share)', '{s1.nome}': 'the full service name' },
  day: { '{d1}': 'the day alone (a weekday, "dia" with a date, a numeric date or a relative day, chosen by the generator)', '{d1.na}': 'the day with na / no', '{d1.pra}': 'with pra / pro',
    '{d1.de}': 'with de / do' },
  clock: { '{h1}': 'the clock alone', '{h1.as}': 'the clock with às', '{h1.das}': 'the clock with das (an interval start)', '{h1.pras}': 'the clock with pras / para as' },
  reason: { '{motivo}': 'the cancellation reason, a lower-case clause about the customer', '{motivo.M}': 'the same clause capitalized, to start a sentence' },
  blockReason: { '{bmotivo}': 'the professional\'s errand, a phrase that follows the verb "vai"' },
  verb: { '{v.marcar}': 'an imperative verb for booking', '{v.remarcar}': 'for moving a booking', '{v.cancelar}': 'for cancelling', '{v.bloquear}': 'for blocking the schedule',
    note: 'drawn per scenario and able to start a sentence; a literal verb is allowed as well' } };
/** (A function: this module and generate.ts / overlap.ts import each other, so nothing of theirs is read while loading.) */
const rules = () => [
  'Write each phrasing in Brazilian Portuguese as one message a salon owner types or dictates to a scheduling assistant; vary word order, register and length, and add no fact the intent does not state (no other person, service, day or clock).',
  'Every person, service, day, clock and reason is a placeholder: never write a literal name, surname, nickname, service, digit, weekday, relative day, part of the day, clock or duration (forbiddenLiterals).',
  'Use only the forms a slot lists (forms, verbs); every binding in `required` appears in one of its naming forms (a grammatical form such as {c1.o} names nobody); a `forbidden` binding never appears.',
  'A phrasing is a JSON string (usable when typing and when dictating) or {"t": text, "mode": "typing" | "voice"} for one mode only. Dictated phrasings lose every punctuation mark and capital letter; typed ones get sentence capitals, so a sentence starting with a placeholder may be written in lower case.',
  '⟦ and ⟧ enclose a span whose punctuation carries the meaning: typing-only phrasings, balanced, non-empty; the marks are removed before the text is shown.',
  'Two phrasings of one slot never read the same once their unprotected punctuation is gone while binding different values.',
  'Every slot needs at least minPerMode phrasings usable in each of its modes; write recommendedPerMode different ones where possible. A reply answers only its question; a say slot is a complete request.',
  `A phrasing identical to any repository phrasing once names, days, clocks, punctuation and word order are neutralized is refused, and so is one whose masked similarity to a few-shot example-bank message reaches ${MULTI_SALON_OVERLAP_THRESHOLD}; both are reported as counts only.`];
const REFUSALS = {
  MULTI_SALON_PHRASES_INSIDE_REPO: 'the phrases file (as given or as its real path) is inside a checkout of the repository; checked before the file is read',
  MULTI_SALON_PHRASES_SEALED_DIR: 'the path is inside the sealed holdout folder', MULTI_SALON_PHRASES_NAME: 'the file name must contain "phrases" and end in .json',
  MULTI_SALON_PHRASES_MISSING: 'no such file', MULTI_SALON_PHRASES_INVALID: 'not JSON, or not {contract, contractSha256, phrases}',
  MULTI_SALON_PHRASES_CONTRACT_MISMATCH: 'contract or contractSha256 differ from this contract', MULTI_SALON_PHRASES_UNKNOWN_SLOT: 'a key of `phrases` is not a slot of this contract',
  MULTI_SALON_PHRASES_CONTRACT: 'a phrasing breaks its slot contract (details: <slot>#<index>:<code>)', MULTI_SALON_PHRASES_INCOMPLETE: 'a slot, or a mode of a slot, has no phrasing (details: slot ids)',
  MULTI_SALON_PHRASES_DUPLICATE: 'phrasings identical to repository phrasings (details: counts per repository side)', MULTI_SALON_PHRASES_OVERLAP: 'phrasings too close to example-bank messages (details: count)' };

/** The machine-readable contract (deterministic in the templates; `sha256` covers every other field). */
export function phrasesContract(templates: readonly Template[] = TEMPLATES) {
  for (const t of templates) for (const id of neededRules(t)) if (!LITERAL_RULES[id]) fail('MULTI_SALON_CONTRACT_RULE_MISSING', [id]);
  const slots = repositorySlots(templates).map(slotContract), says = slots.filter(s => s.role === 'say').length;
  const body = { contract: PHRASES_CONTRACT_VERSION, generator: GENERATOR_VERSION, language: 'pt-BR',
    purpose: 'Write the HOLDOUT-side phrasings of the multi-salon Agenda evaluation without reading the repository: one list of phrasings per slot; the generator fills the placeholders with names, services, days and clocks of sampled salons and derives the expected result from the same values.',
    fileFormat: { name: 'a .json file whose name contains "phrases", kept outside every checkout of the repository',
      shape: { contract: PHRASES_CONTRACT_VERSION, contractSha256: '<the sha256 field of this contract>', phrases: { '<slot id>': ['<phrasing for typing and voice>', { t: '<phrasing>', mode: 'typing | voice' }] } },
      note: 'every slot of `slots` must be present; no other key' },
    placeholders: PLACEHOLDER_DOC, rules: rules(),
    forbiddenLiterals: { digits: 'no digit anywhere outside a placeholder', temporalWords: TEMPORAL_DISPLAY, clockPhrase: 'a clock preposition (às, das, pras, para as, até) followed by a number word',
      personNames: 'no word that is a person name, surname or nickname of the name pools or of any repository corpus', services: 'no service name or alias of any salon type or of the example fill list' },
    literalRules: LITERAL_DOC, similarity: { identity: 'phraseKey: the sorted token set once names, days, clocks, services, reasons, verbs, punctuation and case are neutralized', refusedBankOverlap: MULTI_SALON_OVERLAP_THRESHOLD, reportedNear: PHRASE_NEAR },
    refusals: REFUSALS, counts: { templates: templates.length, slots: slots.length, saySlots: says, replySlots: slots.length - says },
    templates: templates.map(t => ({ id: t.id, ops: t.ops, tags: t.tags, special: t.special ?? null, modes: t.modes, bindings: Object.fromEntries(templateBindings(t).map(n => [n, bindingLabel(n)])),
      slots: externalSlotIds(t) })), extraSlots: EXTRA_SLOTS.map(x => x.id), slots };
  return { ...body, sha256: sha256(JSON.stringify(body)) };
}
export type PhrasesContract = ReturnType<typeof phrasesContract>;
export const contractFileText = (c: PhrasesContract) => { const { sha256: sha, contract, ...body } = c; return JSON.stringify({ contract, sha256: sha, ...body }, null, 2) + '\n'; };

// ---------------------------------------------------------------- one phrasing against its slot
type Lexicon = { names: ReadonlySet<string>; services: readonly string[] };
const PERSON_GROUPS = ['female', 'male', 'unisex', 'compound', 'foreignOrigin', 'wordNames'] as const;
/** Words a phrasing may not write literally: every person-name token of the pools and of the repository corpora, and every
 * service name or alias (salon types and the example fill list). */
export function literalLexicon(root: string = process.cwd(), pools: Pools = loadPools(root)): Lexicon {
  const people = (n: Pools['names']) => [...PERSON_GROUPS.flatMap(g => (n[g] ?? []).flatMap(e => [e.name, ...(e.variants ?? [])])), ...(n.surnames ?? []).map(s => s.name),
    ...(n.nicknames ?? []).flatMap(x => [x.nickname, ...x.formal])];
  // nameTokens drops name particles ("de", "da"), weekday and number words: ordinary words of any message
  const names = nameTokens([...Object.values(repoNameCorpora(root, pools)).flatMap(s => [...s]), ...people(pools.names), ...people(pools.cohort)]);
  return { names, services: [...new Set([...pools.salons.types.flatMap(t => t.services.flatMap(s => [s.name, ...s.aliases])), ...exampleBankCorpus(root).services])] };
}
const hasWord = (text: string, words: readonly string[]) => { const ws = new Set(foldWords(text)); return words.some(w => ws.has(foldWords(w)[0])); };
function correctionIssues(text: string, r: { correct: string; wrong: string }) {
  const at = (re: RegExp, want: string) => [...text.matchAll(re)].map(m => ({ at: m.index! + m[0].length, want }));
  const markers = [...at(/(?<![\p{L}\p{N}])e n[aã]o(?![\p{L}\p{N}])/giu, r.wrong), ...at(/(?<![\p{L}\p{N}])quer dizer(?![\p{L}\p{N}])/giu, r.correct),
    ...at(/⟦\s*(?:\.\.\.|…)\s*n[aã]o\s*,/giu, r.correct), ...at(/⟦\s*,\s*n[aã]o(?![\p{L}\p{N}])/giu, r.wrong)];
  if (!markers.length) return ['CORRECTION_MARKER'];
  const places = [...text.matchAll(PLACEHOLDER)].filter(m => m[1] === r.correct || m[1] === r.wrong).map(m => ({ at: m.index!, name: m[1] }));
  return markers.every(k => places.find(p => p.at >= k.at)?.name === k.want) ? [] : ['CORRECTION_ORDER'];
}
/** Codes (no text) of one phrasing against its slot contract. */
export function phrasingIssues(c: SlotContract, v: unknown, lex: Lexicon): string[] {
  const shaped = typeof v === 'string' || (!!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { t?: unknown }).t === 'string' && Object.keys(v).every(k => k === 't' || k === 'mode'));
  if (!shaped) return ['SHAPE'];
  const text = typeof v === 'string' ? v : (v as { t: string }).t, declared = typeof v === 'string' ? undefined : (v as { mode?: unknown }).mode;
  if (declared !== undefined && declared !== 'typing' && declared !== 'voice') return ['MODE'];
  const mode = declared as Mode | undefined, out: string[] = [];
  if (mode && !c.modes.includes(mode)) out.push('MODE_NOT_ALLOWED');
  if (!/\p{L}/u.test(text) || text.length > MAX_LENGTH || /[\u0000-\u001f\u007f\u2028\u2029]/.test(text)) out.push('LENGTH');
  if (/\{\{|\}\}/.test(text)) out.push('DAY_TOKEN');
  else if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) out.push('PLACEHOLDER_MALFORMED');
  const bindings = new Set([...Object.keys(c.forms), ...c.forbidden]), us = uses(text);
  for (const u of us) {
    if (u.name === 'v') { if (!c.verbs.includes(form(u))) out.push(VERBS.includes(u.attr) ? `VERB_FORBIDDEN:${u.attr}` : 'VERB_FORBIDDEN'); continue; }
    if (!kindOf(u.name) || !bindings.has(u.name)) out.push('PLACEHOLDER_UNKNOWN');
    else if (c.forbidden.includes(u.name)) out.push(`PLACEHOLDER_FORBIDDEN:${u.name}`);
    else if (!c.forms[u.name].includes(form(u))) out.push(KNOWN_ATTRS.has(u.attr) ? `FORM_FORBIDDEN:${u.name}${u.attr ? '.' + u.attr : ''}` : 'FORM_FORBIDDEN');
  }
  const named = new Set(us.filter(naming).map(u => u.name));
  for (const r of c.required) if (!named.has(r)) out.push(`REQUIRED_MISSING:${r}`);
  const literal = text.replace(PLACEHOLDER, ' | ').replace(/[⟦⟧]/g, ' '), words = foldWords(literal.replace(/\|/g, ' '));
  if (/\p{N}/u.test(literal)) out.push('DIGIT');
  const spans = literal.split('|').map(part => ` ${foldWords(part).join(' ')} `);
  if (words.some(w => TEMPORAL.has(w)) || spans.some(s => CLOCK_PHRASE.test(s) || / meio dia /.test(s))) out.push('TEMPORAL_LITERAL');
  if (words.some(w => lex.names.has(w))) out.push('NAME_LITERAL');
  if (foldedSpans(literal, lex.services).length) out.push('SERVICE_LITERAL');
  if (/[⟦⟧]/.test(text)) {
    if (mode !== 'typing') out.push('MARKS_NOT_TYPING');
    if (/[⟦⟧]/.test(text.replace(/⟦[^⟦⟧]+⟧/g, ''))) out.push('MARKS_UNBALANCED');
  }
  const rule = c.literal;
  if (rule?.kind === 'correction') out.push(...correctionIssues(text, rule));
  if (rule?.kind === 'withdrawal' && !hasWord(literal, WITHDRAWAL_WORDS)) out.push('WITHDRAWAL_MISSING');
  if (rule?.kind === 'decline' && !hasWord(literal, DECLINE_WORDS)) out.push('DECLINE_MISSING');
  return [...new Set(out)];
}

// ---------------------------------------------------------------- the author's file
export type PhrasesRecord = { contract: string; contractSha256: string; sha256: string; slots: number; phrasings: number; distinct: number; modes: Record<'both' | Mode, number>;
  nearThreshold: number; nearDev: number; nearRetired: number; overlapThreshold: number; overlap: Record<string, number> };
export type LoadedPhrases = { map: ExternalPhrases; record: PhrasesRecord };
export type PhrasesOptions = { root?: string; pools?: Pools; templates?: readonly Template[] };
/** Validates a parsed phrases file (see the header; codes, slot ids and counts only). `sha`: sha256 of the file's bytes. */
export function validatePhrases(raw: unknown, sha: string, o: PhrasesOptions = {}): LoadedPhrases {
  const root = o.root ?? process.cwd(), templates = o.templates ?? TEMPLATES, contract = phrasesContract(templates);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('MULTI_SALON_PHRASES_INVALID');
  const { contract: id, contractSha256, phrases, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length || !phrases || typeof phrases !== 'object' || Array.isArray(phrases)) fail('MULTI_SALON_PHRASES_INVALID');
  if (id !== PHRASES_CONTRACT_VERSION || contractSha256 !== contract.sha256) fail('MULTI_SALON_PHRASES_CONTRACT_MISMATCH');
  const bySlot = new Map(contract.slots.map(s => [s.slot, s])), entries = Object.entries(phrases as Record<string, unknown>);
  const unknown = entries.map(([k]) => k).filter(k => !bySlot.has(k)), malformed = unknown.filter(k => !SLOT_ID.test(k)).length;
  if (unknown.length) fail('MULTI_SALON_PHRASES_UNKNOWN_SLOT', [...unknown.filter(k => SLOT_ID.test(k)), ...(malformed ? [`malformed:${malformed}`] : [])]);
  // every phrasing against its slot, then the repository's own template checks on the phrasings as the generator reads them
  const pools = o.pools ?? loadPools(root), lex = literalLexicon(root, pools), issues: string[] = [], map = new Map<string, Variant[]>();
  for (const [slot, list] of entries) {
    if (!Array.isArray(list)) { issues.push(`${slot}:NOT_A_LIST`); continue; }
    const c = bySlot.get(slot)!, keys = new Set<string>(), kept: Variant[] = [];
    list.forEach((v, i) => {
      const codes = phrasingIssues(c, v, lex);
      if (!codes.length) {
        const { t, mode } = typeof v === 'string' ? { t: v, mode: undefined } : v as { t: string; mode?: Mode }, x: Variant = mode ? { t, mode } : t, k = phraseKey(x);
        if (keys.has(k)) codes.push('SLOT_DUPLICATE'); keys.add(k); kept.push(x);
      }
      issues.push(...codes.map(code => `${slot}#${i}:${code}`));
    });
    map.set(slot, kept);
  }
  const effective = templates.map(t => ({ ...t, says: t.says.map((_, i) => map.get(`${t.id}:say${i}`) ?? []),
    ...(t.answers ? { answers: Object.fromEntries(Object.keys(t.answers).map(f => [f, map.get(`${t.id}:answer:${f}`) ?? []])) } : {}) }));
  // the extra reply slots through the same check, as one-reply pseudo templates ("daypart:answer:time:X" reads "daypart:time:X")
  const extra = EXTRA_SLOTS.flatMap(x => { const [id, field] = x.id.split(':');
    return templateIssues({ id, says: [], answers: { [field]: map.get(x.id) ?? [] } } as unknown as Template).map(code => code.replace(`${id}:answer:`, `${id}:`)); });
  issues.push(...effective.flatMap(templateIssues), ...extra);
  if (issues.length) fail('MULTI_SALON_PHRASES_CONTRACT', issues);
  const gaps = phraseCoverageGaps(map, templates);
  if (gaps.length) fail('MULTI_SALON_PHRASES_INCOMPLETE', gaps);
  // never a repository phrasing (identity after neutralization): counts only
  const distinct = new Map<string, Variant>();
  for (const list of map.values()) for (const v of list) if (!distinct.has(phraseKey(v))) distinct.set(phraseKey(v), v);
  const sides = phraseSides(), retired = retiredPhrasings(), dup = { dev: 0, retired: 0, repoHoldout: 0 };
  for (const k of distinct.keys()) if (retired.has(k)) dup.retired++; else if (sides.get(k) === 'dev') dup.dev++; else if (sides.get(k) === 'holdout') dup.repoHoldout++;
  if (dup.dev + dup.retired + dup.repoHoldout) fail('MULTI_SALON_PHRASES_DUPLICATE', Object.entries(dup).map(([k, n]) => `${k}:${n}`));
  // never as close to a few-shot example as the bank gate allows (the bank gate cannot see a file outside the repository)
  const texts = [...distinct.values()].map((v, i) => ({ id: `p${i}`, text: neutralText(variantText(v)) }));
  const names = overlapNames(root, [...exampleBankCorpus(root).names, ...devBatteryScenarios(root).flatMap(scenarioNames)]);
  const bank = new Set(overlapHits(texts, [{ name: 'example-bank', texts: renderedBankMessages(root).map(x => x.text) }], names).map(h => h.id));
  if (bank.size) fail('MULTI_SALON_PHRASES_OVERLAP', [`example-bank:${bank.size}`]);
  const devHits = overlapHits(texts, [{ name: 'multi-salon-dev', texts: devBatteryMessages(generatedDevScenarios(root)) }, { name: 'dev-batteries', texts: devBatteryMessages(devBatteryScenarios(root)) }], names);
  const tokens = (k: string) => new Set(k.split(' ')), devKeys = [...sides].filter(([, s]) => s === 'dev').map(([k]) => tokens(k)), retiredKeys = [...retired].map(tokens);
  const near = (pool: ReadonlySet<string>[]) => [...distinct.keys()].filter(k => { const t = tokens(k); return pool.some(x => jaccard(t, x) >= PHRASE_NEAR); }).length;
  const all = [...map.values()].flat();
  const record: PhrasesRecord = { contract: PHRASES_CONTRACT_VERSION, contractSha256: contract.sha256, sha256: sha, slots: map.size, phrasings: all.length, distinct: distinct.size,
    modes: { both: all.filter(v => !variantMode(v)).length, typing: all.filter(v => variantMode(v) === 'typing').length, voice: all.filter(v => variantMode(v) === 'voice').length },
    nearThreshold: PHRASE_NEAR, nearDev: near(devKeys), nearRetired: near(retiredKeys), overlapThreshold: MULTI_SALON_OVERLAP_THRESHOLD,
    overlap: { 'example-bank': 0, 'multi-salon-dev': new Set(devHits.filter(h => h.corpus === 'multi-salon-dev').map(h => h.id)).size,
      'dev-batteries': new Set(devHits.filter(h => h.corpus === 'dev-batteries').map(h => h.id)).size } };
  return { map, record };
}
/** A file path is refused inside every checkout (as given, as its real path, or through its folder's real path) and inside
 * the sealed holdout folder, before anything is read. */
function assertOutside(path: string, root: string, what: 'PHRASES' | 'CONTRACT') {
  let real = path;
  try { real = realpathSync(path); } catch { try { real = join(realpathSync(dirname(path)), basename(path)); } catch { /* neither exists yet */ } }
  const roots = sealedRepoRoots(root);
  if ([path, real].some(p => roots.some(r => isInside(p, r)))) fail(`MULTI_SALON_${what}_INSIDE_REPO`);
  if ([path, real].some(p => p.split(/[\\/]/).some(part => part.toLowerCase() === SEALED_DIR))) fail(`MULTI_SALON_${what}_SEALED_DIR`);
}
/** Reads and validates the author's phrases file (fail closed; see the header). */
export function loadHoldoutPhrases(file: string, o: PhrasesOptions = {}): LoadedPhrases {
  const root = o.root ?? process.cwd(), path = resolve(file);
  assertOutside(path, root, 'PHRASES');
  if (!PHRASES_NAME.test(basename(path))) fail('MULTI_SALON_PHRASES_NAME');
  if (!existsSync(path) || !statSync(path).isFile()) fail('MULTI_SALON_PHRASES_MISSING');
  const bytes = readFileSync(path);
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')); } catch { return fail('MULTI_SALON_PHRASES_INVALID'); }
  return validatePhrases(raw, sha256(bytes), { ...o, root });
}
/** Writes the contract for the isolated author (outside every checkout; an existing file is kept only when it is this very
 * contract). Codes, hashes and counts only. */
export function writePhrasesContract(file: string, root: string = process.cwd()) {
  const path = resolve(file);
  assertOutside(path, root, 'CONTRACT');
  if (!CONTRACT_NAME.test(basename(path))) fail('MULTI_SALON_ARGUMENT');
  const c = phrasesContract(), text = contractFileText(c);
  let status = 'CONTRACT_WRITTEN';
  if (existsSync(path)) { if (readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== text) fail('MULTI_SALON_CONTRACT_EXISTS'); status = 'CONTRACT_UNCHANGED'; }
  else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, { flag: 'wx' }); }
  return { status, file: basename(path), contract: c.contract, sha256: c.sha256, ...c.counts };
}
