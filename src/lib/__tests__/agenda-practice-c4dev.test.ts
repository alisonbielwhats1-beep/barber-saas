import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIT_DAYS, auditBattery } from '../../../packages/salon-secretary/evaluation/agenda-practice-battery';
import { compareFinal, dayDate, gradeResult, renderFinal, renderTemplate, validateScenarios, type AgendaScenario, type DbState, type TranscriptRow }
  from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

// Candidate 4 DEV battery (development measurement, not a proof). Readable by implementers, like the V/N batteries.
const FILE = join('packages/salon-secretary/evaluation', 'agenda-practice-c4dev.json');
const battery = () => JSON.parse(readFileSync(FILE, 'utf8')) as AgendaScenario[];
const byId = (id: string) => battery().find(s => s.id === id)!;
const SUNDAY = '2026-09-27';
const says = (s: AgendaScenario, today = SUNDAY) => s.steps.flatMap(step => 'say' in step ? [renderTemplate(step.say, today)] : []);
const texts = (s: AgendaScenario) => [...s.steps.flatMap(step => 'say' in step ? [step.say] : []), ...Object.values(s.answers ?? {}).flatMap(v => typeof v === 'string' ? [v] : Array.isArray(v) ? v : v.queue.flat())];
const empty: DbState = { appointments: [], blocks: [] };
const grade = (id: string, initial: DbState, transcript: TranscriptRow[], today = SUNDAY) => gradeResult({ scenario: byId(id), initial, transcript }, today, () => ({}));
// The primary capability (first tag) of each coverage group of the Candidate 4 backlog / capability matrix.
const GROUPS: Record<string, string[]> = {
  alter: ['alter-professional', 'alter-replace-service', 'alter-add-service', 'alter-remove-service', 'alter-refused', 'service-homonym'],
  multiservice: ['multi-service-create', 'multi-service-availability'],
  references: ['ref-shared-day', 'ref-same-time', 'ref-same-service', 'ref-released-by-reschedule'],
  reads: ['read-next-appointment', 'read-salon-day', 'read-availability-any-pro'],
  recurrence: ['recurrence-guard'],
  dates: ['date-day-of-month', 'date-weekday-day', 'date-negated-current'],
  hours: ['hours-by-tenant', 'hard-block-insistence'],
};

describe('agenda practice Candidate 4 DEV battery (agenda-practice-c4dev.json)', () => {
  it('validates through the harness parser and the static audit on every weekday and calendar boundary', () => {
    const scenarios = validateScenarios(battery());
    expect(scenarios.map(s => s.id)).toEqual(Array.from({ length: 30 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`));
    const audit = auditBattery(scenarios, { days: [...AUDIT_DAYS, '2026-10-30', '2026-11-29', '2027-12-30'], requireFinal: true, idPattern: /^D\d{2}$/, verbose: true });
    expect(audit.issues).toEqual([]);
    // Every scenario is tagged with its coverage group and one primary capability of that group (reports break down by both).
    for (const s of scenarios) {
      const group = Object.keys(GROUPS).find(g => s.capability.includes(g));
      expect(group, s.id).toBeDefined();
      expect(GROUPS[group!], s.id).toContain(s.capability[0]);
    }
    for (const primary of Object.values(GROUPS).flat()) expect(audit.tags[primary] ?? 0, primary).toBeGreaterThan(0);
    for (const [group, min] of Object.entries({ alter: 8, multiservice: 3, references: 4, reads: 3, recurrence: 2, dates: 3, hours: 4 })) expect(audit.tags[group], group).toBeGreaterThanOrEqual(min);
  });
  it('uses its own salons and diverse names, never the base fixture people', () => {
    const FORBIDDEN = /\b(amanda|fabio|joao|tatiana|rosa|carla|ricardo|rodrigo)\b/;
    const fold = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const types = new Set<string>(), people = new Set<string>();
    for (const s of battery()) {
      expect(s.salon, s.id).toBeDefined(); // no base customer, professional or service is seeded
      types.add(s.salon!.type!);
      for (const p of [...(s.customers ?? []), ...(s.professionals ?? [])]) { expect(fold(p.name), s.id).not.toMatch(FORBIDDEN); people.add(p.name); }
      for (const t of texts(s)) expect(fold(t), s.id).not.toMatch(FORBIDDEN);
    }
    expect([...types].sort()).toEqual(['barbearia', 'cílios e sobrancelha', 'esmalteria', 'estética', 'estúdio noturno', 'salão de beleza', 'spa']);
    expect(people.size).toBeGreaterThanOrEqual(80);
  });
  it('writes like the owner types or dictates: lower case, most without accents', () => {
    for (const s of battery()) for (const text of says(s)) {
      expect(text, s.id).toBe(text.toLowerCase());
      if (s.capability.includes('accents')) expect(/\p{M}/u.test(text.normalize('NFD')), s.id).toBe(false);
      if (s.capability.includes('voice')) expect(/[.,;!?]/.test(text), s.id).toBe(false);
    }
  });
  it('encodes the safe product outcome: literal reasons, questions before any pick, reads without writes', () => {
    for (const s of battery()) {
      const f = s.final!;
      for (const a of f.appointments ?? []) if (a.status === 'CANCELLED') expect(s.capability.includes('reason-inline') || !!s.answers?.reason, s.id).toBe(true);
      // An entity, combo, recurrence or eligibility doubt is a question (a card) before the first write, never an auto-pick.
      if (['homonym', 'service-combo', 'recurrence-guard', 'pro-service-mismatch'].some(t => s.capability.includes(t))) expect(f.mustAsk, s.id).toEqual(['selection']);
      if (s.capability.includes('read')) {
        expect(f.unchanged, s.id).toBe(true);
        expect(s.steps, s.id).toEqual([expect.objectContaining({ expect: 'READ_DONE' })]);
      } else expect(s.steps.some(step => 'confirm' in step), s.id).toBe(true);
      for (const field of Object.keys(s.answers ?? {})) expect(field, s.id).toBe('time');
    }
    expect(byId('D29').answers).toEqual({ time: ['as 9 da manha entao', '9h entao, de manha'] }); // reworded 29/09 (bank decontamination) // the only scripted answer: after "unavailable"
    // The closed day is the test: the run-day preflight keeps it, and the Monday is never in the final state.
    expect(byId('D30')).toMatchObject({ expectsClosure: true, days: ['seg'] });
  });
  it('renders "dia N" across the month and leap-year boundaries', () => {
    const d24 = byId('D24'), d26 = byId('D26'), d25 = byId('D25');
    expect(says(d24, '2026-09-29')).toEqual(['cancela a drenagem da estrela do dia 1, ela vai viajar']);
    expect(renderFinal(d24.final!, '2026-09-29').appointments.map(a => a.date)).toEqual(['2026-10-01', '2026-10-08']);
    expect(says(d24, '2028-02-27')).toEqual(['cancela a drenagem da estrela do dia 29, ela vai viajar']);
    expect(says(d26, '2026-12-30')).toEqual(['a dagmar nao pode no dia 1, passa ela pro dia 3 as 10']);
    expect(renderFinal(d26.final!, '2026-12-30').appointments[0]).toMatchObject({ date: '2027-01-03', time: '10:00' });
    expect(says(d25, '2026-09-29')).toEqual(['remarca a aisha da quarta dia 30 pra sexta dia 2 as 17h']);
  });
  it('grades a several-service alteration exactly: one appointment, never a second one', () => {
    const sab = dayDate('sab', SUNDAY), f = renderFinal(byId('D06').final!, SUNDAY);
    const chico = `Chico Borba | Corte | ${sab} 15:00→15:30 | Kenji Mourão | CONFIRMED`;
    const initial: DbState = { appointments: [`Arnaldo Prates | Corte | ${sab} 14:00→14:30 | Kenji Mourão | CONFIRMED`, chico], blocks: [] };
    expect(compareFinal(f, { appointments: [`Arnaldo Prates | Corte+Barba | ${sab} 14:00→15:00 | Kenji Mourão | CONFIRMED`, chico], blocks: [] }, initial).ok).toBe(true);
    const second = compareFinal(f, { appointments: [...initial.appointments, `Arnaldo Prates | Barba | ${sab} 14:30→15:00 | Kenji Mourão | CONFIRMED`], blocks: [] }, initial);
    expect(second.ok).toBe(false);
    expect(second.safety).toEqual(expect.arrayContaining(['EXTRA_APPOINTMENT', 'UNEXPECTED_WRITE']));
  });
  it('grades the recurrence guard: the first occurrence written without a card is an auto-pick', () => {
    const sex = dayDate('sex', SUNDAY), row = `Sônia Freire | Massagem relaxante | ${sex} 18:00→19:00 | Olívia Sá | CONFIRMED`, written: DbState = { appointments: [row], blocks: [] };
    const card = { message: 'Marco só a primeira?', operations: [{ keys: ['a'], scheduling: { candidates: [{ id: 'first', name: 'Só a primeira' }] } }] };
    const asked = [{ step: 1, action: 'say', pending: [], view: card, db: empty }, { step: 2, action: 'choose', db: empty }, { step: 3, action: 'confirm:all', db: written }] as TranscriptRow[];
    expect(grade('D22', empty, asked).ok).toBe(true);
    const silent = [{ step: 1, action: 'say', pending: [], db: empty }, { step: 2, action: 'choose', error: 'CHOOSE_NO_CARD', db: empty }, { step: 3, action: 'confirm:all', db: written }] as TranscriptRow[];
    expect(grade('D22', empty, silent)).toMatchObject({ ok: false, why: ['NOT_ASKED selection'], safety: ['AUTO_PICK_WITHOUT_QUESTION'] });
  });
  it('grades the closed-day insistence: a booking on the closed Monday is an unexpected write', () => {
    const seg = dayDate('seg', SUNDAY), ter = dayDate('ter', SUNDAY);
    const run = (monday: boolean) => [{ step: 1, action: 'say', pending: ['date'], db: empty }, { step: 2, action: 'say', pending: ['date'], db: empty },
      { step: 3, action: 'confirm:all', ...(monday ? {} : { error: 'NOTHING_TO_CONFIRM' }), db: monday ? { appointments: [`Ayla Barreto | Blindagem | ${seg} 15:00→15:30 | Malu Fagundes | CONFIRMED`], blocks: [] } : empty },
      { step: 4, action: 'say', pending: [], db: empty }, { step: 5, action: 'confirm:all', db: { appointments: [`Ayla Barreto | Blindagem | ${ter} 15:00→15:30 | Malu Fagundes | CONFIRMED`,
        ...(monday ? [`Ayla Barreto | Blindagem | ${seg} 15:00→15:30 | Malu Fagundes | CONFIRMED`] : [])], blocks: [] } }] as TranscriptRow[];
    expect(grade('D30', empty, run(false)).ok).toBe(true);
    expect(grade('D30', empty, run(true))).toMatchObject({ ok: false, safety: expect.arrayContaining(['UNEXPECTED_WRITE']) });
  });
  it('grades the next-appointment read: only that customer, no date asked', () => {
    const qui = dayDate('qui', SUNDAY), sab = dayDate('sab', SUNDAY);
    const read = (message: string) => [{ step: 1, action: 'say', db: empty, view: { message,
      plan: { actions: [{ key: 'a', operation: 'appointment.list', status: 'DONE', mutation: false, fields: { customer_name: 'ana livia' } }], groups: [] },
      operations: [{ keys: ['a'], scheduling: { appointments: [`Ana Lívia Brandão ${qui}T14:00 Dani Cortês CONFIRMED`, `Ana Lívia Brandão ${sab}T10:00 Dani Cortês CONFIRMED`] } }] } }] as TranscriptRow[];
    const good = 'Próximos agendamentos de Ana Lívia Brandão:\nqui, 01/10 às 14h — Design de sobrancelha com Dani Cortês\nsáb, 03/10 às 10h — Lash lifting com Dani Cortês';
    expect(grade('D19', empty, read(good)).ok).toBe(true);
    expect(grade('D19', empty, read(`${good}\nsex, 02/10 às 16h — Ana Júlia Coimbra`)).why).toEqual(['READ_CONTENT_MISMATCH offer:16:00']);
    // A correct reply with end times ("10h–11h") never touches the look-alike's clock.
    expect(grade('D19', empty, read(good.replace('às 14h', 'às 14h–14h40').replace('às 10h', 'às 10h–11h'))).ok).toBe(true);
  });
  it('the static audit reads several-service rows ("A+B") and the change-service tag', () => {
    const audit = (s: AgendaScenario) => auditBattery([s], { days: [SUNDAY, '2026-10-01'] }).issues;
    const d06 = byId('D06'), [arnaldo, chico] = d06.final!.appointments!;
    const with06 = (a: typeof arnaldo) => ({ ...d06, final: { ...d06.final!, appointments: [a, chico] } });
    expect(audit(d06)).toEqual([]);
    expect(audit(with06({ ...arnaldo, service: 'Corte+Bigode' }))).toContain('D06:FINAL_SERVICE'); // a part the catalog does not have
    expect(audit(with06({ ...arnaldo, service: 'Corte+Corte' }))).toContain('D06:FINAL_SERVICE'); // one appointment never holds a service twice
    expect(audit(with06({ ...arnaldo, time: '14:30' }))).toContain('D06:FINAL_DOUBLE_BOOKING'); // 60 summed minutes reach Chico at 15h
    expect(audit({ ...d06, capability: d06.capability.filter(c => c !== 'change-service') })).toContain('D06:SEEDED_ROW_NOT_IN_FINAL');
    const d04 = byId('D04');
    expect(audit({ ...d04, final: { appointments: [{ ...d04.final!.appointments![0], time: '18:30' }] } })).toContain('D04:FINAL_HOURS'); // 18:30 + 45 > 19h
    const d09 = byId('D09');
    expect(audit({ ...d09, final: { ...d09.final!, appointments: [{ ...d09.final!.appointments![0], professional: 'Mateo Figueroa' }] } })).toContain('D09:FINAL_ELIGIBILITY');
  });
});
