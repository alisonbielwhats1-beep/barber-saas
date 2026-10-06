/** Static audit of an Agenda practice battery (evaluation only: no database, no network, no model).
 * Renders every scenario for several run days and checks, before any paid run, what the live runner cannot:
 * fixture relations, templates, run day, and that the exact `final` oracle is self-consistent, reachable
 * (eligible professional, opening hours, no double booking, no booking inside a block) and NOT satisfied by
 * doing nothing. Issues are `ID:CODE` plus `:detail` only when verbose, so a sealed holdout can be audited
 * without printing its text. */
import { fixtureSchema } from './free-use-contract';
import { answerInstances, buildScenarioFixture, compareFinal, dayDate, dayOffset, expectedCalls, renderFinal, renderTemplate, runDayPreflight, validateScenarios, weekdaySaoPaulo,
  type AgendaScenario, type DbState } from './agenda-practice-lib';

/** Field names the runtime publishes in missing_fields (bare, without the item prefix). */
export const ANSWER_FIELDS = ['reason', 'time', 'date', 'end_time', 'end_date', 'customer_ref', 'appointment_ref', 'professional_ref', 'service_ref', 'service_name',
  'destination_mode', 'override_requested'] as const;
/** One full week (every weekday as run day) plus month, year and leap boundaries. */
export const AUDIT_DAYS = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-12-30', '2027-02-26', '2028-02-27'];
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
type Row = { customer: string; service: string; date: string; from: number; to: number; professional: string; status: string };
const line = (r: Row) => `${r.customer} | ${r.service} | ${r.date} ${clock(r.from)}→${clock(r.to)} | ${r.professional} | ${r.status}`;
const overlaps = (a: { date: string; from: number; to: number }, b: { date: string; from: number; to: number }) => a.date === b.date && a.from < b.to && b.from < a.to;

/** A final-state oracle cannot see how the state was reached; these scenario kinds also need their transcript oracle. */
function transcriptOracles(s: AgendaScenario, add: (code: string, detail?: string) => void) {
  const f = s.final!, has = (tag: string) => s.capability.includes(tag);
  const says = s.steps.filter((step): step is Extract<AgendaScenario['steps'][number], { say: string }> => 'say' in step);
  const probes = s.steps.filter(step => 'confirm' in step && step.expectError);
  // Entity choice (typo, homonym): a write must follow a question/choice, never an auto-pick.
  if ((has('typo') || has('homonym')) && !f.mustAsk?.length) add('NO_MUST_ASK');
  // A cancellation is graded with its literal reason.
  for (const a of f.appointments ?? []) if (a.status === 'CANCELLED' && a.reason === undefined) add('CANCEL_WITHOUT_REASON', a.customer);
  if (f.unchanged) {
    // With nothing to write, a confirm step can only be a probe that must find nothing to confirm.
    if (s.steps.some(step => 'confirm' in step && !step.expectError)) add('UNCHANGED_CONFIRM_NOT_PROBE');
    // A read is graded by the turn: it must finish without error (an unchanged DB alone passes on any failure).
    if ((has('read') || has('availability') || has('day-agenda')) && !says.some(step => step.expect === 'READ_DONE')) add('READ_WITHOUT_TURN_ORACLE');
    if (has('negation') && !f.noPendingPlan) add('DISCARD_WITHOUT_NO_PENDING_PLAN');
  }
  // A probe tests something only if a proposal existed before it.
  if (probes.length && !says.some(step => step.expect === 'READY')) add('PROBE_WITHOUT_READY');
}

function auditDay(s: AgendaScenario, today: string, add: (code: string, detail?: string) => void, requireFinal: boolean) {
  const { fixture, hours } = buildScenarioFixture(s, today);
  const parsed = fixtureSchema.safeParse(fixture);
  if (!parsed.success) add('FIXTURE_SCHEMA', parsed.error.issues[0]?.path.join('.'));
  const customer = new Map(fixture.customers.map(c => [c.key, c.name])), pro = new Map(fixture.professionals.map(p => [p.key, p.name]));
  const serviceByKey = new Map(fixture.services.map(x => [x.key, x])), serviceByName = new Map(fixture.services.map(x => [x.name, x]));
  const proKey = new Map(fixture.professionals.map(p => [p.name, p.key]));
  const { openMinutes: open, closeMinutes: close } = fixture;
  // Salon scenarios: a booking fits one window of its weekday (never across a break); a block stays inside the day's windows.
  const windows = new Map(hours.filter(h => h.windows).map(h => [h.key, h.windows!]));
  const dayWindows = (key: string | undefined, date: string) => key && windows.has(key) ? windows.get(key)!.filter(w => w.weekday === weekdaySaoPaulo(date)) : undefined;
  const fits = (key: string | undefined, date: string, from: number, to: number) => {
    const w = dayWindows(key, date); return w ? w.some(x => x.startMinutes <= from && to <= x.endMinutes) : from >= open && to <= close;
  };
  const inDay = (key: string | undefined, date: string, from: number, to: number) => {
    const w = dayWindows(key, date); return w ? w.length > 0 && Math.min(...w.map(x => x.startMinutes)) <= from && to <= Math.max(...w.map(x => x.endMinutes)) : from >= open && to <= close;
  };
  for (const [kind, keys] of [['CUSTOMER', fixture.customers.map(c => c.key)], ['PROFESSIONAL', fixture.professionals.map(p => p.key)]] as const)
    if (new Set(keys).size !== keys.length) add('DUPLICATE_' + kind);
  if (new Set(fixture.customers.map(c => c.name)).size !== fixture.customers.length) add('DUPLICATE_CUSTOMER_NAME');
  const seeded: Row[] = [];
  // A multi-service seed (`services`) must fit the professional's own hours too (base-fixture from/to/weekdays; a salon
  // scenario's windows are already the professional's) and the salon's open weekdays.
  const own = new Map(hours.filter(h => !h.windows).map(h => [h.key, h]));
  const ownFits = (key: string, date: string, from: number, to: number) => {
    const h = own.get(key), weekday = weekdaySaoPaulo(date);
    return fixture.openWeekdays.includes(weekday) && (!h || ((!h.weekdays || h.weekdays.includes(weekday)) && from >= (h.fromMinutes ?? open) && to <= (h.toMinutes ?? close)));
  };
  /** Keys exist, no repeated service, every service offered by the professional, the SUMMED duration inside one window of
   * the professional/salon and over no other seeded booking; the row is projected as the product's ("A+B", end = sum). */
  const seedMulti = (a: Extract<NonNullable<AgendaScenario['appointments']>[number], { services: string[] }>) => {
    const who = customer.get(a.customer), by = pro.get(a.professional), svcs = a.services.map(k => serviceByKey.get(k));
    if ((s.appointments ?? []).filter(x => x.key === a.key).length > 1) add('SEED_KEY_DUPLICATE', a.key);
    if (!who || !by) { add('SEED_RELATION', a.key); return; }
    a.services.forEach((k, i) => { if (!svcs[i]) add('SEED_SERVICE_UNKNOWN', `${a.key}/${k}`); });
    if (new Set(a.services).size !== a.services.length) add('SEED_SERVICE_DUPLICATE', a.key);
    const known = svcs.flatMap(x => x ? [x] : []);
    if (known.length !== svcs.length) return;
    for (const x of known) if (!x.professionalKeys.includes(a.professional)) add('SEED_ELIGIBILITY', `${a.key}/${x.key}`);
    if (dayOffset(a.day, today) < 1) add('SEED_NOT_FUTURE', a.key);
    const date = dayDate(a.day, today), from = minutes(a.time), to = from + known.reduce((n, x) => n + x.durationMin, 0);
    if (!fits(a.professional, date, from, to) || !ownFits(a.professional, date, from, to)) add('SEED_HOURS', a.key);
    const row: Row = { customer: who, service: known.map(x => x.name).join('+'), date, from, to, professional: by, status: 'CONFIRMED' };
    if (seeded.some(r => r.professional === by && overlaps(r, row))) add('SEED_OVERLAP', a.key);
    seeded.push(row);
  };
  for (const a of s.appointments ?? []) {
    if (a.services !== undefined) { seedMulti(a); continue; }
    const svc = serviceByKey.get(a.service), who = customer.get(a.customer), by = pro.get(a.professional);
    if (!svc || !who || !by) { add('SEED_RELATION', a.key); continue; }
    if (!svc.professionalKeys.includes(a.professional)) add('SEED_ELIGIBILITY', a.key);
    if (dayOffset(a.day, today) < 1) add('SEED_NOT_FUTURE', a.key);
    const from = minutes(a.time), to = from + svc.durationMin;
    if (!fits(a.professional, dayDate(a.day, today), from, to)) add('SEED_HOURS', a.key);
    const row: Row = { customer: who, service: svc.name, date: dayDate(a.day, today), from, to, professional: by, status: 'CONFIRMED' };
    if (seeded.some(r => r.professional === by && overlaps(r, row))) add('SEED_OVERLAP', a.key);
    seeded.push(row);
  }
  for (const step of s.steps) if ('say' in step) renderTemplate(step.say, today); else if ('select' in step) renderTemplate(step.select, today);
  for (const spec of Object.values(s.answers ?? {})) for (const v of answerInstances(spec)) for (const text of Array.isArray(v) ? v : [v]) renderTemplate(text, today);
  const day = runDayPreflight([s], today)[0];
  if (day.action !== 'RUN') add('RUN_DAY_SKIP', [...new Set(day.closed.map(c => c.source))].join(','));
  if (!s.final) { if (requireFinal) add('NO_FINAL'); return; }
  const initial: DbState = { appointments: seeded.map(line), blocks: [] }, f = renderFinal(s.final, today);
  const idle = compareFinal(f, initial, initial);
  transcriptOracles(s, add);
  // A read oracle names a professional and a service of this salon (that professional doing that service), on a day not past.
  const read = s.final.read;
  if (read) {
    const key = read.professional !== undefined ? proKey.get(read.professional) : undefined, svc = read.service !== undefined ? serviceByName.get(read.service) : undefined;
    if (read.professional !== undefined && !key) add('READ_PROFESSIONAL', read.professional);
    if (read.service !== undefined && !svc) add('READ_SERVICE', read.service);
    if (key && svc && !svc.professionalKeys.includes(key)) add('READ_ELIGIBILITY', `${read.service}/${read.professional}`);
    if (read.day !== undefined && dayOffset(read.day, today) < 0) add('READ_DAY_PAST');
  }
  if (f.unchanged) { if (!idle.ok) add('ORACLE_UNCHANGED_FAILS_IDLE'); return; }
  if (idle.ok) add('ORACLE_PASSES_WITHOUT_CHANGE');
  if (!s.steps.some(step => 'confirm' in step)) add('NO_CONFIRM_STEP');
  const rows: Row[] = [];
  for (const e of f.appointments) {
    // One appointment with several services is projected as their names joined by '+', in order (a catalog name is tried first).
    const parts = serviceByName.has(e.service) ? [e.service] : e.service.split('+'), svcs = parts.map(n => serviceByName.get(n));
    const key = e.professional ? proKey.get(e.professional) : undefined;
    if (svcs.some(x => !x) || new Set(parts).size !== parts.length || parts.length > 10) { add('FINAL_SERVICE', e.service); continue; }
    if (!e.professional) { add('FINAL_PROFESSIONAL_WILDCARD'); continue; }
    if (!key) { add('FINAL_PROFESSIONAL', e.professional); continue; }
    if (!fixture.customers.some(c => c.name === e.customer)) add('FINAL_CUSTOMER', e.customer);
    if (svcs.some(x => !x!.professionalKeys.includes(key))) add('FINAL_ELIGIBILITY', `${e.service}/${e.professional}`);
    if (e.date <= today) add('FINAL_NOT_FUTURE', e.date);
    const from = minutes(e.time), to = from + svcs.reduce((n, x) => n + x!.durationMin, 0);
    if (e.end !== undefined && e.end !== clock(to)) add('FINAL_END', e.end);
    if (!fits(key, e.date, from, to)) add('FINAL_HOURS', e.time);
    rows.push({ customer: e.customer, service: e.service, date: e.date, from, to, professional: e.professional, status: e.status });
  }
  const blocks = f.blocks.map(b => {
    if (!proKey.has(b.professional)) add('BLOCK_PROFESSIONAL', b.professional);
    if (b.startDate !== b.endDate) add('BLOCK_MULTI_DAY');
    if (b.startDate <= today) add('BLOCK_NOT_FUTURE', b.startDate);
    const from = minutes(b.from), to = minutes(b.to);
    if (from >= to || !inDay(proKey.get(b.professional), b.startDate, from, to)) add('BLOCK_HOURS', `${b.from}-${b.to}`);
    return { ...b, date: b.startDate, from, to };
  });
  const expected: DbState = { appointments: rows.map(line), blocks: f.blocks.map(b => `${b.professional} | ${b.startDate} ${b.from}→${b.endDate} ${b.to} | ${b.reason ?? ''}`) };
  const self = compareFinal(f, expected, initial);
  if (!self.ok || self.safety.length) add('ORACLE_SELF', [...self.why, ...self.safety].join('|'));
  // Reschedule and cancel keep customer, service and professional: every seeded row must still be listed (a scenario tagged
  // 'change-professional' moves a booking to another professional, one tagged 'change-service' changes its services: those
  // parts are then not compared).
  const keepsPro = !s.capability.includes('change-professional'), keepsService = !s.capability.includes('change-service');
  const sig = (r: { customer: string; service: string; professional?: string }) => [r.customer, ...(keepsService ? [r.service] : []), ...(keepsPro ? [r.professional] : [])].join('|');
  for (const k of new Set(seeded.map(sig))) if (seeded.filter(r => sig(r) === k).length > rows.filter(r => sig(r) === k).length) add('SEEDED_ROW_NOT_IN_FINAL', k);
  const active = rows.filter(r => !['CANCELLED', 'NO_SHOW'].includes(r.status));
  active.forEach((r, i) => { if (active.slice(i + 1).some(o => o.professional === r.professional && overlaps(o, r))) add('FINAL_DOUBLE_BOOKING', `${r.professional} ${r.date}`); });
  // A booking inside a block of the same professional is allowed only for a seeded row the block preserves verbatim.
  for (const r of active) if (!initial.appointments.includes(line(r)) && blocks.some(b => b.professional === r.professional && overlaps(b, r))) add('FINAL_BOOKING_IN_BLOCK', `${r.professional} ${r.date}`);
}

export type BatteryAudit = { scenarios: number; ids: string[]; issues: string[]; tags: Record<string, number>; operations: Record<string, number>; callsPerPass: number };
export function auditBattery(input: unknown, opts: { days?: string[]; requireFinal?: boolean; idPattern?: RegExp; verbose?: boolean } = {}): BatteryAudit {
  const scenarios = validateScenarios(input), issues = new Set<string>(), tags: Record<string, number> = {};
  for (const s of scenarios) {
    const add = (code: string, detail?: string) => issues.add(`${s.id}:${code}${opts.verbose && detail ? ':' + detail : ''}`);
    if (opts.idPattern && !opts.idPattern.test(s.id)) add('ID_PATTERN');
    if (!s.capability.length) add('NO_CAPABILITY');
    if (!s.steps.length || !('say' in s.steps[0])) add('FIRST_STEP');
    for (const field of Object.keys(s.answers ?? {})) if (!(ANSWER_FIELDS as readonly string[]).includes(field)) add('ANSWER_FIELD', field);
    for (const t of new Set(s.capability)) tags[t] = (tags[t] ?? 0) + 1;
    for (const today of opts.days ?? AUDIT_DAYS) {
      try { auditDay(s, today, add, opts.requireFinal ?? true); } catch (e) { add('THROW', e instanceof Error ? e.message.slice(0, 80) : 'ERROR'); }
    }
  }
  const operations: Record<string, number> = {};
  for (const s of scenarios) for (const op of ['create', 'reschedule', 'cancel', 'block', 'read']) if (s.capability.includes(op)) operations[op] = (operations[op] ?? 0) + 1;
  return { scenarios: scenarios.length, ids: scenarios.map(s => s.id), issues: [...issues].sort(), tags: Object.fromEntries(Object.entries(tags).sort()), operations,
    callsPerPass: scenarios.reduce((n, s) => n + expectedCalls(s).calls, 0) };
}
