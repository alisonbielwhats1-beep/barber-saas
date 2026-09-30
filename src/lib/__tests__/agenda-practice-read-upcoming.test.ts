import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { READ_PROJECTION_V2_RUN, buildPasskReport, fixtureEntityId, gradeResult, readProjection, replyDates, scenarioDefinitionSha256,
  type AgendaScenario, type DbState, type TranscriptRow } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

// Read projection v2 (29/09): the rows a customer-upcoming read publishes (C32, READS_V2: an appointment read with a resolved
// customer and no date) count as published, verified against the DB of the read turn like a day agenda. The version is the run
// id a result RECORDED: results recorded before keep their grade (never re-graded into PASS).
const BATTERY = join('packages/salon-secretary/evaluation', 'agenda-practice-c4dev.json');
// Local evidence (evaluation/results is not versioned): when present, the embedded copy below must be that file.
const EVIDENCE = join('packages/salon-secretary/evaluation/results/agenda-core', '2026-09-29T21-00-05-097Z-c4-dev-check', 'k1', 'D19.json');
const D19 = () => (JSON.parse(readFileSync(BATTERY, 'utf8')) as AgendaScenario[]).find(s => s.id === 'D19')!;
const EFFECTS = { appointment_services: '3:d1f6c1105c2f2a88', appointment_events: '0:4f53cda18c2baa0c', resource_bookings: '0:4f53cda18c2baa0c',
  outbox_internal: '0:4f53cda18c2baa0c', outbox_external: '0:4f53cda18c2baa0c', customers: '2:ba0631958ec29362', services: '3:f37cf3e5af7eebbf',
  products: '0:4f53cda18c2baa0c', appointment_products: '0:4f53cda18c2baa0c', closures: '0:4f53cda18c2baa0c', payments: '0:4f53cda18c2baa0c',
  professionals: '1:1fb742dd9556e4ba', working_hours: '6:945edc741fa7ebaa', professional_services: '3:5a30ffcc9438bb36' };
const SEEDED: DbState = { appointments: ['Ana Lívia Brandão | Design de sobrancelha | 2026-10-01 14:00→14:40 | Dani Cortês | CONFIRMED',
  'Ana Júlia Coimbra | Design de sobrancelha | 2026-10-02 16:00→16:40 | Dani Cortês | CONFIRMED', 'Ana Lívia Brandão | Lash lifting | 2026-10-03 10:00→11:00 | Dani Cortês | CONFIRMED'],
blocks: [], reasons: [null, null, null], effects: EFFECTS };
const REPLY = 'Próximos agendamentos de Ana Lívia Brandão:\nqui, 01/10 às 14h — Design de sobrancelha com Dani Cortês\nsáb, 03/10 às 10h — Lash lifting com Dani Cortês';
const LIVIA = ['Ana Lívia Brandão 2026-10-01T14:00 Dani Cortês CONFIRMED', 'Ana Lívia Brandão 2026-10-03T10:00 Dani Cortês CONFIRMED'];
const NS = 'agenda-practice-2026-09-29T21-00-05-341Z-k1';
/** The recorded D19 attempt of the c4-dev-check (real Luna, every candidate flag on), reduced to what the oracles read. */
const RECORDED = { run: '2026-09-29T21-00-05-341Z', today: '2026-09-29', seedNamespace: NS as string | undefined, initial: SEEDED,
  transcript: [{ step: 1, action: 'say', input: 'a ana livia ta marcada pra quando?', pending: [] as string[],
    router: { outcome: { kind: 'READ_RESULT', divergence: { failed_codes: ['READ_UPCOMING'] } } },
    view: { message: REPLY, plan: { status: 'DONE', actions: [{ key: 'a', operation: 'appointment.read', status: 'DONE', mutation: false, missing: [] as string[],
      fields: { customer_name: 'ana livia', communication: null, inventory: null, financial: null, target_name: null, name: null, priceCents: null, durationMin: null,
        phone: null, email: null, requested_fields: [] as string[], clear_fields: [] as string[] } as Record<string, unknown> }], groups: [{ key: 'group_1', status: 'DONE' }] },
    operations: [{ keys: ['a'], scheduling: { operation: 'appointment.read', fields: { customer_name: 'ana livia', customer_ref: 'd9434c8f-e5ca-424d-81a0-0f4e1dc8bff9' } as Record<string, unknown>,
      missing: [] as string[], appointments: LIVIA } }] },
    db: SEEDED }] };
type Recorded = typeof RECORDED;
type Change = { message?: string; appointments?: string[]; fields?: Record<string, unknown>; said?: string; codes?: string[]; db?: DbState; seedNamespace?: null };
const variant = (c: Change = {}): Recorded => {
  const r = structuredClone(RECORDED), t = r.transcript[0], sch = t.view.operations[0].scheduling;
  if (c.message !== undefined) t.view.message = c.message;
  if (c.appointments) sch.appointments = c.appointments;
  if (c.said !== undefined) t.view.plan.actions[0].fields.customer_name = sch.fields.customer_name = c.said;
  if (c.fields) Object.assign(sch.fields, c.fields);
  if (c.codes) t.router.outcome.divergence.failed_codes = c.codes;
  if (c.db) { r.initial = c.db; t.db = c.db; }
  if (c.seedNamespace === null) r.seedNamespace = undefined;
  return r;
};
/** `run`: the run id the result recorded (null: none, a hand-built result). */
const grade = (r: Recorded, run: string | null = READ_PROJECTION_V2_RUN) =>
  gradeResult({ scenario: D19(), ...r, transcript: r.transcript as TranscriptRow[], run: run ?? undefined }, r.today, () => ({}));
const why = (c: Change) => grade(variant(c)).why;
const PASS = { oracle: 'final', ok: true, why: [], safety: [] };

describe('agenda practice read projection v2: customer-upcoming reads (C32)', () => {
  it('is versioned by the run id a result recorded, never by the grading clock', () => {
    expect(readProjection(undefined)).toBe(1); // hand-built transcripts
    expect(readProjection(RECORDED.run)).toBe(1); // the c4-dev-check
    expect(readProjection('2026-09-29T21-04-01-502Z')).toBe(1); // the c4-vn-check
    expect(readProjection(READ_PROJECTION_V2_RUN)).toBe(2);
    expect(readProjection('2026-10-02T08-15-00-000Z')).toBe(2);
    expect(readProjection('2026-10-02T08-15-00-000Z-t')).toBe(2); // a suffixed run id
    for (const run of ['', 'latest', '2026-10-02', '9999', 20261002, null]) expect(readProjection(run), String(run)).toBe(1);
  });
  it('the recorded D19 keeps its recorded grade; the same answer recorded under v2 passes', () => {
    expect(scenarioDefinitionSha256(D19())).toBe('25dfd98e050ee8f808d0dcd77960bebe03da268a908a437e6252d206cfc258d5'); // the definition the run graded
    expect(grade(RECORDED, RECORDED.run)).toEqual({ oracle: 'final', ok: false, why: ['READ_CONTENT_MISMATCH unpublished:14:00,unpublished:10:00'], safety: [] });
    expect(grade(RECORDED, null)).toEqual(grade(RECORDED, RECORDED.run));
    expect(grade(RECORDED)).toEqual(PASS);
    // Every correct variation of the answer: end times, the one-line form of a single booking, a read list operation.
    expect(why({ message: REPLY.replace('às 14h', 'às 14h–14h40').replace('às 10h', 'às 10h–11h') })).toEqual([]);
    const listRead = variant(); listRead.transcript[0].view.plan.actions[0].operation = 'appointment.list';
    expect(grade(listRead)).toEqual(PASS);
  });
  it.skipIf(!existsSync(EVIDENCE))('the embedded copy is the local evidence file, graded the same way', () => {
    const e = JSON.parse(readFileSync(EVIDENCE, 'utf8')), t = e.transcript[0];
    expect(e.scenario).toEqual(D19());
    expect({ run: e.run, today: e.today, seedNamespace: e.seedNamespace, initial: e.initial, transcript: [{ step: t.step, action: t.action, input: t.input, pending: t.pending,
      router: { outcome: { kind: t.router.outcome.kind, divergence: { failed_codes: t.router.outcome.divergence.failed_codes } } },
      view: { message: t.view.message, plan: { status: t.view.plan.status,
        actions: t.view.plan.actions.map((a: Record<string, unknown>) => ({ key: a.key, operation: a.operation, status: a.status, mutation: a.mutation, missing: a.missing, fields: a.fields })),
        groups: t.view.plan.groups.map((g: Record<string, unknown>) => ({ key: g.key, status: g.status })) },
      operations: t.view.operations.map((o: { keys: string[]; scheduling: Record<string, unknown> }) => ({ keys: o.keys,
        scheduling: { operation: o.scheduling.operation, fields: o.scheduling.fields, missing: o.scheduling.missing, appointments: o.scheduling.appointments } })) },
      db: t.db }] }).toEqual(RECORDED);
    expect(gradeResult(e, e.today, () => ({}))).toEqual({ oracle: 'final', ok: false, why: ['READ_CONTENT_MISMATCH unpublished:14:00,unpublished:10:00'], safety: [] });
    expect(gradeResult({ ...e, run: READ_PROJECTION_V2_RUN }, e.today, () => ({}))).toEqual(PASS);
  });
  it('through the pass^k report: an older run directory is never re-graded into PASS', () => {
    const root = mkdtempSync(join(tmpdir(), 'read-upcoming-'));
    try {
      const run = (name: string, id: string) => {
        const dir = join(root, name, 'k1'); mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'D19.json'), JSON.stringify({ ...RECORDED, run: id, scenario: D19(), complete: true }));
        return buildPasskReport(join(root, name)).scenarios.find(s => s.id === 'D19')!.attempts;
      };
      expect(run('recorded', RECORDED.run)).toMatchObject([{ k: 1, ok: false, why: ['READ_CONTENT_MISMATCH unpublished:14:00,unpublished:10:00'] }]);
      expect(run('v2', READ_PROJECTION_V2_RUN)).toMatchObject([{ k: 1, ok: true, why: [] }]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('adversarial rows: another customer, an invented time, a skipped, cancelled or past booking, order', () => {
    const julia = 'Ana Júlia Coimbra 2026-10-02T16:00 Dani Cortês CONFIRMED', juliaLine = '\nsex, 02/10 às 16h — Design de sobrancelha com Dani Cortês';
    // The look-alike's Friday among the rows (and in the reply): not that customer's, and its clock is the forbidden offer.
    expect(why({ appointments: [LIVIA[0], julia, LIVIA[1]], message: REPLY.replace('\nsáb', `${juliaLine}\nsáb`) })).toEqual(['READ_CONTENT_MISMATCH offer:16:00,customer,rows']);
    expect(why({ appointments: [LIVIA[0], julia, LIVIA[1]] })).toEqual(['READ_CONTENT_MISMATCH customer,rows,pair:16:00']);
    // A booking of this customer attributed to another one.
    expect(why({ appointments: [LIVIA[0].replace('Ana Lívia Brandão', 'Ana Júlia Coimbra'), LIVIA[1]] })).toEqual(['READ_CONTENT_MISMATCH customer,rows']);
    // An invented time: published as a row with its reply line, or only written in the reply.
    const invented = 'Ana Lívia Brandão 2026-10-02T15:00 Dani Cortês CONFIRMED', inventedLine = '\nsex, 02/10 às 15h — Design de sobrancelha com Dani Cortês';
    expect(why({ appointments: [LIVIA[0], invented, LIVIA[1]], message: REPLY.replace('\nsáb', `${inventedLine}\nsáb`) })).toEqual(['READ_CONTENT_MISMATCH rows']);
    expect(why({ message: REPLY + inventedLine })).toEqual(['READ_CONTENT_MISMATCH reply-extra']);
    // The next booking skipped: the later one alone is not "the next ones".
    expect(why({ appointments: [LIVIA[1]], message: 'Próximo agendamento de Ana Lívia Brandão: sáb, 03/10 às 10h — Lash lifting com Dani Cortês.' }))
      .toEqual(['READ_CONTENT_MISMATCH mention:14:00,unpublished:14:00,rows']);
    // A cancelled booking, a past one, the rows out of order.
    const cancelled: DbState = { ...SEEDED, appointments: [SEEDED.appointments[0].replace('CONFIRMED', 'CANCELLED'), ...SEEDED.appointments.slice(1)] };
    expect(why({ db: cancelled, appointments: [LIVIA[0].replace('CONFIRMED', 'CANCELLED'), LIVIA[1]] })).toEqual(['READ_CONTENT_MISMATCH rows']);
    const past: DbState = { ...SEEDED, appointments: ['Ana Lívia Brandão | Design de sobrancelha | 2026-09-28 10:00→10:40 | Dani Cortês | CONFIRMED', ...SEEDED.appointments], reasons: [null, null, null, null] };
    expect(why({ db: past, appointments: ['Ana Lívia Brandão 2026-09-28T10:00 Dani Cortês CONFIRMED', ...LIVIA],
      message: REPLY.replace(':\n', ':\nseg, 28/09 às 10h — Design de sobrancelha com Dani Cortês\n') })).toEqual(['READ_CONTENT_MISMATCH rows']);
    const [head, first, second] = REPLY.split('\n');
    expect(why({ appointments: [LIVIA[1], LIVIA[0]], message: [head, second, first].join('\n') })).toEqual(['READ_CONTENT_MISMATCH rows']);
    // A row the runner could not project is never accepted.
    expect(why({ appointments: [LIVIA[0], 'Ana Lívia Brandão sábado 10h'] })).toEqual(['READ_CONTENT_MISMATCH unpublished:10:00,rows,reply-extra']);
  });
  it('adversarial replies: each row a line with its date and clock, the registered name, no other customer', () => {
    expect(why({ message: REPLY.replace('qui, 01/10 às 14h', 'sex, 02/10 às 14h') })).toEqual(['READ_CONTENT_MISMATCH pair:14:00,reply-extra']); // right clock, wrong day
    // Two bookings on one line: one pairs, the other's clock and date are extra content on that paired line (review).
    expect(why({ message: REPLY.replace('\nsáb', ' e sáb') })).toEqual(['READ_CONTENT_MISMATCH pair:10:00,reply-extra']);
    expect(why({ message: REPLY.replace('Ana Lívia Brandão', 'ana livia') })).toEqual(['READ_CONTENT_MISMATCH customer']); // only the owner's words
    expect(why({ message: REPLY.replace('Ana Lívia Brandão:', 'Ana Júlia Coimbra:') })).toEqual(['READ_CONTENT_MISMATCH customer']); // whose, wrong
    expect(why({ message: `${REPLY}\nA Ana Júlia Coimbra também tem horário nesta semana.` })).toEqual(['READ_CONTENT_MISMATCH customer']); // the look-alike named
  });
  it('review: a paired line carries only its booking — no invented start, slot, booking, service or professional', () => {
    const line = (text: string) => REPLY.replace('qui, 01/10 às 14h — Design de sobrancelha com Dani Cortês', text);
    expect(why({ message: line('qui, 01/10 das 13h às 14h — Design de sobrancelha com Dani Cortês') })).toEqual(['READ_CONTENT_MISMATCH reply-extra']); // invented start
    expect(why({ message: line('qui, 01/10 às 14h — Design de sobrancelha com Dani Cortês (ela também tem 17h)') })).toEqual(['READ_CONTENT_MISMATCH reply-extra']); // extra slot
    expect(why({ message: line('qui, 01/10 às 14h e sex, 02/10 às 17h — Design de sobrancelha com Dani Cortês') })).toEqual(['READ_CONTENT_MISMATCH reply-extra']); // extra booking
    expect(why({ message: line('qui, 01/10 às 14h — Extensão de cílios com Marta Reis') })).toEqual(['READ_CONTENT_MISMATCH pair:14:00,reply-extra']); // wrong service and professional
    expect(why({ message: line('qui, 01/10 às 14h — Lash lifting com Dani Cortês') })).toEqual(['READ_CONTENT_MISMATCH pair:14:00,reply-extra']); // another booking's service
    // Still correct: the booking's own end, and the registered service and professional in any case or accents.
    expect(why({ message: line('qui, 01/10 às 14h–14h40 — design de sobrancelha com dani cortes') })).toEqual([]);
    // v1 history is untouched: the recorded run keeps its recorded grade whatever the reply line carries.
    expect(grade(variant({ message: line('qui, 01/10 das 13h às 14h — Design de sobrancelha com Dani Cortês') }), RECORDED.run).why).toEqual(['READ_CONTENT_MISMATCH unpublished:14:00,unpublished:10:00']);
  });
  it('recognizes only a customer-upcoming read: the turn marker, no date, the resolved customer', () => {
    const unpublished = ['READ_CONTENT_MISMATCH unpublished:14:00,unpublished:10:00'];
    expect(why({ codes: [] })).toEqual(unpublished); // no READ_UPCOMING on the turn
    expect(why({ codes: ['READ_DAY_SUMMARY'] })).toEqual(unpublished);
    expect(why({ fields: { date: '2026-10-01' } })).toEqual(unpublished); // a day read is not this read
    expect(why({ fields: { customer_ref: null } })).toEqual(unpublished); // no resolved customer
    // Seeded run: the customer is the entity the backend resolved, and the name the action kept must name it.
    expect(why({ fields: { customer_ref: fixtureEntityId(NS, 'D19', 'customer:anajulia') } })).toEqual(['READ_CONTENT_MISMATCH customer,rows']);
    expect(why({ fields: { customer_ref: '00000000-0000-4000-8000-000000000000' } })).toEqual(['READ_CONTENT_MISMATCH customer,rows']);
    expect(why({ said: 'ana julia' })).toEqual(['READ_CONTENT_MISMATCH customer,rows']);
    expect(why({ said: 'ana' })).toEqual([]); // a first name the owner then chose on a card: the ref decides
    // Hand-built transcript (no namespace): the ONE fixture customer the name names.
    expect(why({ seedNamespace: null })).toEqual([]);
    expect(why({ seedNamespace: null, said: 'ana' })).toEqual(['READ_CONTENT_MISMATCH customer,rows']); // two customers are "ana"
  });
  it('reads dd/mm dates the way the Secretary writes them', () => {
    expect(replyDates('qui, 01/10 às 14h; 1/9, 29/09/2026, 14:00 e 2026-10-01')).toEqual(['10-01', '09-01', '09-29']);
  });
});

// A second salon (hand-built, no namespace): filters said, bookings of today, the limit, and an empty answer.
const T = '2026-09-29';
const NAIL: AgendaScenario = { id: 'U01', title: 'próximos horários', capability: ['read'], steps: [{ say: 'q', expect: 'READ_DONE' }],
  salon: { type: 'esmalteria', services: [{ key: 'mani', name: 'Manicure', durationMin: 40, priceCents: 4000 }, { key: 'pedi', name: 'Pedicure', durationMin: 50, priceCents: 5000 },
    { key: 'spa', name: 'Spa dos pés', durationMin: 60, priceCents: 9000 }], hours: [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, from: '09:00', to: '19:00' })) },
  professionals: [{ key: 'yuki', name: 'Yuki Tanaka' }, { key: 'nadir', name: 'Nadir Quintela' }],
  customers: [{ key: 'iolanda', name: 'Iolanda Ferraz', phone: '11976500301' }, { key: 'benedito', name: 'Benedito Araújo', phone: '11976500302' }],
  final: { unchanged: true, read: { operation: 'appointment.read' } } };
const booking = (customer: string, service: string, day: string, time: string, end: string, pro: string, status = 'CONFIRMED') => `${customer} | ${service} | ${day} ${time}→${end} | ${pro} | ${status}`;
const IOLANDA = {
  past: booking('Iolanda Ferraz', 'Manicure', '2026-09-28', '10:00', '10:40', 'Yuki Tanaka'),
  early: booking('Iolanda Ferraz', 'Manicure', T, '09:00', '09:40', 'Yuki Tanaka'),
  late: booking('Iolanda Ferraz', 'Pedicure', T, '17:00', '17:50', 'Nadir Quintela'),
  wed: booking('Iolanda Ferraz', 'Manicure', '2026-09-30', '10:00', '10:40', 'Yuki Tanaka', 'PENDING'),
  thu: booking('Iolanda Ferraz', 'Manicure+Pedicure', '2026-10-01', '11:00', '12:30', 'Nadir Quintela'),
  fri: booking('Iolanda Ferraz', 'Spa dos pés', '2026-10-02', '15:00', '16:00', 'Yuki Tanaka'),
  sat: booking('Iolanda Ferraz', 'Pedicure', '2026-10-03', '09:00', '09:50', 'Yuki Tanaka', 'CANCELLED'),
};
const BENEDITO = booking('Benedito Araújo', 'Manicure', '2026-09-30', '10:00', '10:40', 'Nadir Quintela');
const NAIL_DB: DbState = { appointments: [...Object.values(IOLANDA), BENEDITO], blocks: [] };
/** The runner's projection of a listed booking, and the Secretary's line for it. */
const row = (line: string) => { const [customer, , when, pro, status] = line.split(' | '); return `${customer} ${when.slice(0, 10)}T${when.slice(11, 16)} ${pro} ${status}`; };
const said = (line: string) => { const [, service, when, pro] = line.split(' | '); return `${when.slice(8, 10)}/${when.slice(5, 7)} às ${Number(when.slice(11, 13))}h — ${service} com ${pro}`; };
const upcoming = (who: string, lines: string[], o: { fields?: Record<string, unknown>; name?: string; db?: DbState } = {}) => {
  const name = o.name ?? (who === 'iolanda' ? 'Iolanda Ferraz' : 'Benedito Araújo');
  const message = !lines.length ? `Não encontrei agendamento futuro pendente ou confirmado de ${name}.` : lines.length === 1 ? `Próximo agendamento de ${name}: ${said(lines[0])}.`
    : `Próximos agendamentos de ${name}:\n${lines.map(said).join('\n')}`;
  const fields = { customer_name: who, ...(o.fields ?? {}) }, db = o.db ?? NAIL_DB;
  const transcript: TranscriptRow[] = [{ step: 1, action: 'say', router: { outcome: { divergence: { failed_codes: ['READ_UPCOMING'] } } }, db, view: { message,
    plan: { status: 'DONE', actions: [{ key: 'a', operation: 'appointment.read', status: 'DONE', mutation: false, fields }], groups: [] },
    operations: [{ keys: ['a'], scheduling: { fields: { ...fields, customer_ref: `ref-${who}` }, appointments: lines.map(row) } }] } }];
  return gradeResult({ scenario: NAIL, initial: db, transcript, run: READ_PROJECTION_V2_RUN }, T, () => ({})).why;
};

describe('agenda practice read projection v2: filters, today and the limit against the DB of the read turn', () => {
  const { early, late, wed, thu, fri } = IOLANDA;
  it('the first bookings from the read clock on; only today\'s bookings before the first one listed may have passed', () => {
    expect(upcoming('iolanda', [late, wed, thu])).toEqual([]); // read after 9h: the three first of the rest (the limit)
    expect(upcoming('iolanda', [early, late, wed])).toEqual([]); // read before 9h
    expect(upcoming('iolanda', [early, wed, thu])).toEqual(['READ_CONTENT_MISMATCH rows']); // today's 17h skipped after its 9h
    expect(upcoming('iolanda', [late, wed, fri])).toEqual(['READ_CONTENT_MISMATCH rows']); // Thursday skipped
    expect(upcoming('iolanda', [])).toEqual(['READ_CONTENT_MISMATCH rows']); // "none" while bookings are ahead
    expect(upcoming('iolanda', [late, BENEDITO, wed])).toEqual(['READ_CONTENT_MISMATCH customer,rows']); // another customer's booking
  });
  it('a professional or service the owner said filters the bookings; a filter nobody said hides nothing', () => {
    expect(upcoming('iolanda', [wed, fri], { fields: { professional_name: 'yuki' } })).toEqual([]);
    expect(upcoming('iolanda', [wed, fri])).toEqual(['READ_CONTENT_MISMATCH rows']); // Nadir's Thursday in between
    expect(upcoming('iolanda', [late, thu], { fields: { service_name: 'pedicure' } })).toEqual([]); // a several-service booking counts
    expect(upcoming('iolanda', [wed, fri], { fields: { service_name: 'manicure' } })).toEqual(['READ_CONTENT_MISMATCH rows']); // a spa is not a manicure
  });
  it('one booking in one line, and an empty answer only when nothing is ahead', () => {
    expect(upcoming('benedito', [BENEDITO])).toEqual([]);
    const none: DbState = { appointments: [...Object.values(IOLANDA), BENEDITO.replace('CONFIRMED', 'CANCELLED')], blocks: [] };
    expect(upcoming('benedito', [], { db: none })).toEqual([]);
    expect(upcoming('benedito', [BENEDITO], { name: 'Iolanda Ferraz' })).toEqual(['READ_CONTENT_MISMATCH customer']); // whose, wrong
  });
});
