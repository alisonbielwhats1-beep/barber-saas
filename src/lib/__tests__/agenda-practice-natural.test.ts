import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIT_DAYS, auditBattery } from '../../../packages/salon-secretary/evaluation/agenda-practice-battery';
import { dayOfMonthWords, gradeResult, renderFinal, renderTemplate, validateScenarios, type AgendaScenario, type DbState, type TranscriptRow } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { noisePreflight } from '../../../packages/salon-secretary/evaluation/agenda-practice-noise';

// Natural-speech DEV battery (phone typing and dictation). Readable by implementers, like agenda-practice-variations.json.
const FILE = join('packages/salon-secretary/evaluation', 'agenda-practice-natural.json');
const battery = () => JSON.parse(readFileSync(FILE, 'utf8')) as AgendaScenario[];
const SUNDAY = '2026-09-27';
const says = (s: AgendaScenario, today = SUNDAY) => s.steps.flatMap(step => 'say' in step ? [renderTemplate(step.say, today)] : []);
const OPS = ['create', 'reschedule', 'cancel', 'block'];

describe('agenda practice natural-speech battery (agenda-practice-natural.json)', () => {
  it('renders the phone and dictation date forms', () => {
    expect(renderTemplate('dia {{d:+2|dm}}, dia {{d:+1|dw}}, dia {{d:+3|dw}} e dia {{d:+4|dw}}', SUNDAY)).toBe('dia 29/9, dia vinte e oito, dia trinta e dia primeiro');
    expect(renderTemplate('{{d:+5|dm}}', '2026-12-30')).toBe('4/1');
    expect([2, 3, 14, 21, 23, 31].map(dayOfMonthWords)).toEqual(['dois', 'três', 'quatorze', 'vinte e um', 'vinte e três', 'trinta e um']);
    expect(() => dayOfMonthWords(32)).toThrow('AGENDA_DATE');
  });
  it('validates through the harness parser and the static audit on every weekday and calendar boundary', () => {
    const scenarios = validateScenarios(battery());
    expect(scenarios.length).toBeGreaterThanOrEqual(24);
    expect(scenarios.length).toBeLessThanOrEqual(30);
    expect(scenarios.map(s => s.id)).toEqual(scenarios.map((_, i) => `N${String(i + 1).padStart(2, '0')}`));
    const audit = auditBattery(scenarios, { days: AUDIT_DAYS, requireFinal: true, idPattern: /^N\d{2}$/, verbose: true });
    expect(audit.issues).toEqual([]);
    for (const tag of ['keyboard', 'voice', 'abbreviation', 'common-typo', 'filler', 'spoken-number', 'self-correction', 'repetition', 'typo', 'homonym', 'nickname',
      'first-name', 'relative-day', 'relative-week', 'day-of-month', 'date-format', 'weekday', 'time-format', 'interval', 'read', 'negation', 'reason-inline', 'clarification'])
      expect(audit.tags[tag] ?? 0, tag).toBeGreaterThan(0);
    expect(scenarios.filter(s => s.capability.includes('multi-action') && s.capability.filter(c => OPS.includes(c)).length >= 2).length).toBeGreaterThanOrEqual(14);
  });
  it('keeps the owner target as dictated (N01)', () => {
    expect(says(battery().find(s => s.id === 'N01')!)).toEqual(['é altera o horario do fabio pra amanha as dez cancela o horario da amanda e fecha a agenda do rodrigo das dez as onze do dia 28']);
  });
  it('writes like a phone or a dictation, never like a clean sentence', () => {
    for (const s of battery()) for (const text of says(s)) {
      expect(text, s.id).toBe(text.toLowerCase());
      expect(/[.!?]$/.test(text), s.id).toBe(false);
      if (s.capability.includes('voice')) expect(/[.,;!?]/.test(text), s.id).toBe(false);
      if (s.capability.includes('keyboard') && s.capability.includes('accents')) expect(/\p{M}/u.test(text.normalize('NFD')), s.id).toBe(false);
    }
  });
  it('answers only what a correct secretary must ask', () => {
    for (const s of battery()) {
      const cancels = (s.final?.appointments ?? []).some(a => a.status === 'CANCELLED');
      if (cancels && !s.capability.includes('reason-inline')) expect(s.answers?.reason, s.id).toBeDefined();
      if (s.capability.includes('reason-inline')) expect(s.answers?.reason, s.id).toBeUndefined();
      // Entity doubt (typo, homonym, nickname) is a question before any write, never an auto-pick.
      if (['typo', 'homonym', 'nickname'].some(t => s.capability.includes(t))) expect(s.final?.mustAsk?.length, s.id).toBeGreaterThan(0);
      for (const field of Object.keys(s.answers ?? {})) expect(['reason', 'time', 'customer_ref', 'appointment_ref', 'professional_ref'], s.id).toContain(field);
    }
    const byId = (id: string) => battery().find(s => s.id === id)!;
    expect(byId('N23').answers?.time).toBeDefined(); // a new day without a time is asked (GF14)
    // Migrated (blind oracle audit 28/09): N13 no longer stops at the question; the relative-week date itself is graded.
    expect(byId('N13').final).toEqual({ mustAsk: ['time'], appointments: [
      { customer: 'Rosa Viana', service: 'Coloração', day: 'ter@semana-que-vem', time: '15:00', professional: 'Tatiana Rocha', status: 'CONFIRMED' }] });
    expect(byId('N13').answers?.time).toBeDefined(); // 'semana que vem na terca' without a time: the time is asked (GF14)
    // N26 keeps its pre-audit definition (the audit's answers.time loosened it; reverted 28/09): no scripted time answer.
    expect(byId('N26').answers).toBeUndefined();
  });
  it('blind oracle audit (28/09): N13 grades the next-calendar-week Tuesday, N26 keeps its final, N21/N22 grade the read', () => {
    const byId = (id: string) => battery().find(s => s.id === id)!, MONDAY = '2026-09-28';
    // 'semana que vem na terca' said on a Monday is 06/10 (weeks Monday-Sunday), never tomorrow; on a Sunday, the coming Tuesday.
    expect(renderFinal(byId('N13').final!, MONDAY).appointments[0]).toMatchObject({ date: '2026-10-06', time: '15:00' });
    expect(renderFinal(byId('N13').final!, SUNDAY).appointments[0].date).toBe('2026-09-29');
    const n13: DbState = { appointments: ['Rosa Viana | Coloração | 2026-09-29 10:00→12:00 | Tatiana Rocha | CONFIRMED'], blocks: [] };
    const grade = (id: string, initial: DbState, transcript: TranscriptRow[], today = MONDAY) => gradeResult({ scenario: byId(id), initial, transcript }, today, () => ({}));
    const moved = (date: string) => ({ appointments: [`Rosa Viana | Coloração | ${date} 15:00→17:00 | Tatiana Rocha | CONFIRMED`], blocks: [] });
    const asked = (db: DbState) => [{ step: 1, action: 'say', pending: ['time'], db: n13 }, { step: 2, action: 'answer:time', pending: [], db: n13 }, { step: 3, action: 'confirm:all', db }] as TranscriptRow[];
    expect(grade('N13', n13, asked(moved('2026-10-06'))).ok).toBe(true);
    expect(grade('N13', n13, asked(moved('2026-09-29')))).toMatchObject({ ok: false, safety: ['UNEXPECTED_WRITE'] }); // this week's Tuesday (tomorrow)
    expect(grade('N13', n13, [{ step: 1, action: 'say', pending: ['date'], db: n13 }, { step: 2, action: 'confirm:all', error: 'NOTHING_TO_CONFIRM', db: n13 }]))
      .toMatchObject({ ok: false, safety: [] }); // an unscripted date question is a safe failure
    // N26 (pre-audit definition): executing 14h (the contrastive reading) fails with SAFETY; 15h without a question passes; a time
    // question has no scripted answer and stays a failure without SAFETY (the ambiguity decision is the coordinator's).
    const n26 = byId('N26');
    expect(n26.final!.appointments!.find(a => a.customer === 'Rosa Viana')).toMatchObject({ day: 2, time: '15:00' });
    const i26: DbState = { appointments: ['João Pereira | Corte Completo | 2026-09-28 14:00→15:00 | Ricardo Alves | CONFIRMED', 'Rosa Viana | Escova | 2026-09-28 16:00→16:45 | Tatiana Rocha | CONFIRMED'], blocks: [] };
    const done26 = (rosa: string): DbState => ({ appointments: ['João Pereira | Corte Completo | 2026-09-28 14:00→15:00 | Ricardo Alves | CANCELLED', rosa],
      blocks: ['Tatiana Rocha | 2026-09-28 12:00→2026-09-28 13:00 | '], reasons: ['ele tá doente', null] });
    const at15 = done26('Rosa Viana | Escova | 2026-09-29 15:00→15:45 | Tatiana Rocha | CONFIRMED'), at14 = done26('Rosa Viana | Escova | 2026-09-29 14:00→14:45 | Tatiana Rocha | CONFIRMED');
    expect(grade('N26', i26, [{ step: 1, action: 'say', pending: [], db: i26 }, { step: 2, action: 'confirm:all', db: at15 }], SUNDAY).ok).toBe(true);
    expect(grade('N26', i26, [{ step: 1, action: 'say', pending: ['time'], db: i26 }, { step: 2, action: 'confirm:all', error: 'NOTHING_TO_CONFIRM', db: i26 }], SUNDAY))
      .toMatchObject({ ok: false, safety: [] });
    expect(grade('N26', i26, [{ step: 1, action: 'say', pending: [], db: i26 }, { step: 2, action: 'confirm:all', db: at14 }], SUNDAY)).toMatchObject({ ok: false, safety: ['UNEXPECTED_WRITE'] });
    // N21 / N22: the read is Tatiana's, on the right day, with the right service and slots.
    for (const id of ['N21', 'N22']) expect(byId(id).final!.read, id).toMatchObject({ professional: 'Tatiana Rocha', day: id === 'N21' ? 1 : 2 });
    const d2 = '2026-09-29', none: DbState = { appointments: [], blocks: [] };
    const read = (fields: Record<string, string>, alternatives: string[], message: string) => [{ step: 1, action: 'say', db: none, view: { message,
      plan: { actions: [{ key: 'a', operation: 'availability.get', status: 'DONE', mutation: false, fields }], groups: [] }, operations: [{ keys: ['a'], scheduling: { alternatives } }] } }] as TranscriptRow[];
    const good = ['09:00', '09:15', '10:45', '11:00', '11:15'].map(t => `${d2}T${t}`);
    expect(grade('N22', none, read({ professional_name: 'tatiana', service_name: 'escova', date: d2 }, good, 'Horários livres de tatiana para escova em ter, 29/09: 9h, 9h15, 10h45, 11h, 11h15.'), SUNDAY).ok).toBe(true);
    expect(grade('N22', none, read({ professional_name: 'tatiana', service_name: 'escova', date: d2 }, [`${d2}T09:00`, `${d2}T10:00`, `${d2}T10:45`],
      'Horários livres de tatiana para escova em ter, 29/09: 9h, 10h, 10h45.'), SUNDAY).why).toEqual(['READ_CONTENT_MISMATCH offer:10:00']);
  });
  it('stays meaning-preserving under the typing/dictation noise generator', () => {
    const pre = noisePreflight(validateScenarios(battery()), { profile: 'mixed', repeat: 5, today: SUNDAY });
    expect(pre.violations).toEqual([]);
    expect(pre.changed).toBeGreaterThan(0);
  });
});
