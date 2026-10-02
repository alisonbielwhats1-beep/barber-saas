/** Agenda practice runner: real Luna, local disposable DB, synthetic tenants only.
 *
 * Unlike the free-use gate, this runner may CONFIRM proposals through the same
 * authenticated backend path the Front uses (confirmActionPlanGroup /
 * confirmAutomatic). That exercises execution in fresh synthetic tenants of the
 * local disposable database. No production, no external message (fake provider),
 * no payment. Every paid request is admitted against a durable stage journal
 * (legacy stage USD 7 and reliability stage USD 15, both authorized on 2026-09-27;
 * final-battery stage USD 40 of reservations, 28/09) AND the program real-spend
 * ledger (US$ 3.50 real, every call, whatever the stage)
 * before the network call. pass^k: every scenario runs K times sequentially, each
 * attempt in a fresh seed namespace, graded offline on the final DB state.
 * --noise light|heavy|mixed sends say/answer texts through the deterministic,
 * meaning-preserving noise generator (agenda-practice-noise.ts); every such turn
 * records profile, level, seed, the ORIGINAL and the SENT text (synthetic only).
 * AGENDA_ANSWER_DELIVERY=item (or `answerDelivery`; evaluation only, default 'field' = the legacy delivery and file shape)
 * answers service_changes* questions with the scenario's service answers and a question that names an item with that item's
 * answer (AnswerBook); the header, report and each delivered answer row then record it (codes only).
 * C5 agent arm (SALON_SECRETARY_AGENT=true, docs/c5-spike/11 §6.2-§6.4, §8.5): the flag is read once here and passed explicitly to
 * the payload guard, the stage journal and the program ledger; every say and scripted answer reserves 3 calls; each paid call is
 * labelled `…:s<step>:r<n>` in the program ledger and recorded per step (`agentCalls`: arguments, kinds of the output items, sha256
 * of the encrypted reasoning and of every tool output sent back) for the offline replay; the report adds the usage per call position
 * and the ledger's spend per round. With the flag off everything above is exactly as before. Every header and report also stamp the
 * evaluator version (§9.4) and a run can be limited to the ids of an ids file (`ids`). */
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';
import { agentPreloadEnabled, agentRoundEfforts, createPaidModel, examplesContractTag, secretaryContractVersion, type Model } from '@everflair/salon-secretary';
import { SalonSecretary, type SecretaryView } from '../../../src/lib/salon-secretary';
import { persistedSessionStore } from '../../../src/lib/secretary-session-store';
import { prisma } from '../../../src/lib/prisma';
import { humanMessage } from '../../../src/lib/secretary-ui';
import { secretaryErrorMessage } from '../../../src/lib/secretary-error-copy';
import { backendPresentationDigest } from '../../../src/lib/secretary-presentation-contract';
import { assertFreeUseDatabase } from './free-use-database';
import { seedFreeUseFixture } from './free-use-fixture';
import { seedMultiServiceAppointments } from './agenda-practice-seed';
import type { FixtureIdentity } from './free-use-contract';
import { AGENDA_STAGES, AnswerBook, answerDeliveryMode, answerQuestion, DEFAULT_AGENDA_STAGE, DEFAULT_OUTPUT_TOKENS, EFFECT_TABLES, ESTIMATE_BODY_BYTES, LEGACY_AGENDA_STAGE, MULTI_SERVICE_SEED_VERSION, PRICE, SYSTEM_CLOCK, TZ, acquireStageLease,
  agendaStage, agentArm, pilotArm, pilotTurnTelemetry, agentCallRecord, agentTurnOf, agentUsageByRound, assertAgentArm, assertHeadroom, assertSaoPauloClock, assertStageLeaseHeld, buildScenarioFixture, codesOnly, dayWindowPreflight,
  evaluatorVersion, expectedCalls, headroomEstimate, heartbeatStageLease,
  legacyOracle, midnightGuard, percentile, perCallBudgetMs, readStage, releaseStageLease, renderFinal, renderTemplate, requestVersion, reservationMicroUsd, reserve, runDayPreflight,
  runEstimateMs, scenarioBudgetMs, secretaryFlagSnapshot, selectScenarioIds, spendByRound, stageJournalPath, stageTotals, todayInSaoPaulo, validateScenarios, AGENT_CALLS_PER_MESSAGE, AGENT_PATHS,
  type AgendaClock, type AgendaScenario, type AgendaStageName, type AgentCallRecord, type AnswerDelivery, type AnswerFor, type LegacyMap, type ProfessionalHours, type StageLease, type Step,
  type TranscriptRow } from './agenda-practice-lib';
import { assertProgramHeadroom, assertProofAdmits, guardPaidFetch, isProgramSpendError, programSpendCode, programSpendLabel, programSpendLedgerPath, programSpendSummary, programSpendTotals,
  type ProofLease } from './program-spend';
import { applyNoise, noiseLevel, noisePreflight, noiseProfile, noiseSeed, noiseViolations, scenarioNoiseContext, type NoiseProfile } from './agenda-practice-noise';
export { reserve, scenarioFixture, stageTotals, type AgendaScenario } from './agenda-practice-lib';

export const AGENDA_STAGE = LEGACY_AGENDA_STAGE;
export const AGENDA_STAGE_CAP_MICRO_USD = AGENDA_STAGES[LEGACY_AGENDA_STAGE].capMicroUsd;
const RESULTS = 'packages/salon-secretary/evaluation/results/agenda-core';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
/** Budget/limit/wire/lease failures stop the whole run (never a half-graded attempt); other errors stay step errors. */
const RUN_ABORTS = new Set(['AGENDA_UNEXPECTED_NETWORK', 'AGENDA_WIRE_REQUEST', 'AGENDA_MAX_REQUESTS', 'AGENDA_STAGE_CAP', 'AGENDA_STAGE_JOURNAL', 'AGENDA_STAGE_HEADROOM', 'AGENDA_STAGE_LOCKED',
  'AGENDA_NOISE_INVARIANT', 'AGENDA_STAGE_LOCK_IO', 'AGENDA_STAGE_BUSY', 'AGENDA_STAGE_LEASE_LOST', 'AGENDA_STAGE_TEST_JOURNAL']);
/** F2: a São Paulo day change inside an attempt (clock only). Caught per attempt: the attempt is discarded and rerun once. */
const ROLLOVER = 'AGENDA_DAY_ROLLOVER';
class DayRollover extends Error { constructor() { super(ROLLOVER); } }

export function assertNonProduction(env: Record<string, string | undefined>) {
  if (env.VERCEL_ENV === 'production' || env.APP_ENV === 'production') throw Error('AGENDA_PRODUCTION_FORBIDDEN');
}
const outputTokens = (env: Record<string, string | undefined>) => Math.max(DEFAULT_OUTPUT_TOKENS, Number(env.SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS ?? DEFAULT_OUTPUT_TOKENS) || DEFAULT_OUTPUT_TOKENS);

function summarize(view: SecretaryView | undefined) {
  if (!view) return undefined;
  const plan = view.action_plan;
  const ops = (view.operations ?? []).map(op => {
    const st = op.state, sch = st.scheduling, batch = st.batch;
    const draft = sch?.draft as unknown as { draft_revision?: number; temporal_missing?: string[]; source_missing?: string[]; pending_temporal_ambiguities?: { field: string }[];
      pending_calendar_conflicts?: { field: string }[]; review?: { causes?: string[] } } | undefined;
    const items = (batch?.draft?.plan ?? batch?.plan)?.items as unknown as { key: string; operation: string; fields: unknown; depends_on: string[]; temporal_missing?: string[]; source_missing?: string[] }[] | undefined;
    return { keys: op.action_keys, message: humanMessage(st.message ?? ''),
      scheduling: sch ? { operation: sch.operation, fields: sch.draft?.fields ?? sch.fields, missing: sch.draft?.missing_fields, waiting_for: sch.waiting_for,
        review: sch.draft?.review ? { status: sch.draft.review.status, message: sch.draft.review.message, causes: draft?.review?.causes } : undefined,
        draft_revision: draft?.draft_revision, temporal_missing: draft?.temporal_missing, source_missing: draft?.source_missing,
        temporal_ambiguities: draft?.pending_temporal_ambiguities?.map(a => a.field), calendar_conflicts: draft?.pending_calendar_conflicts?.map(c => c.field),
        candidates: sch.candidates?.items.map(i => i.name), proposal: sch.proposal?.preview, receipt: sch.receipt,
        alternatives: sch.alternatives?.map(a => a.startLocal), appointments: sch.appointments?.map(a => `${a.customer_name} ${a.start_local} ${a.professional_name} ${a.status}`) } : undefined,
      batch: batch ? { items: items?.map(i => ({ key: i.key, operation: i.operation, fields: i.fields, depends_on: i.depends_on, temporal_missing: i.temporal_missing, source_missing: i.source_missing })), missing: batch.draft?.missing_fields,
        review: batch.draft?.review, proposal: batch.proposal?.preview, receipt: batch.receipt, candidates: batch.draft?.candidates } : undefined,
      other: !sch && !batch ? { skill: st.skill, capability: st.capability_status } : undefined };
  });
  // `suspended` (operation labels only) and `cancelled` let the grader see a plan left pending after a discard.
  return { message: humanMessage(view.message ?? ''), capability_status: view.capability_status, cancelled: view.cancelled,
    suspended: (view.suspended_plans ?? []).map(p => p.label),
    plan: plan ? { status: plan.status, revision: plan.revision, actions: plan.actions.map(a => ({ key: a.key, operation: a.operation, status: a.status, mutation: a.mutation, missing: a.missing_fields, depends_on: a.depends_on, preview: a.assessment?.preview, issue: a.assessment?.issue, fields: a.fields,
        temporal_ambiguities: a.assessment?.pending_temporal_ambiguities?.map(x => x.field), calendar_conflicts: a.assessment?.pending_calendar_conflicts?.map(x => x.field) })),
      groups: plan.confirmation_groups.map(g => ({ key: g.key, status: g.status, keys: g.action_keys })) } : undefined, operations: ops };
}
/** Codes-only probe of the plan after a step (evaluation telemetry, no text). */
/** The runner's own step failures (no Secretary call refused anything): the view shown is still the current one. */
const RUNNER_ERRORS = /^(?:NOTHING_TO_CONFIRM|CONFIRM_ALL_STUCK|SELECT_\d+|CHOOSE_NO_CARD|CHOOSE_RANGE|AGENDA_[A-Z0-9_]+)$/;
/** ERR-COPY (review D-P9): a step whose Secretary call threw records what the owner would read — the refusal's own pt-BR copy
 * (secretary-error-copy.ts; codes only, never the exception text; a confirmation's unknown failure never says nothing changed) —
 * as `reply`, marked `stale` (the view shown is not this step's). `view` keeps the last real state: the frozen transcript oracles
 * and diagnostics read it (a plan still pending after an errored negation stays PENDING_AFTER_NEGATION; LOST_TURN/LOOP still see
 * the unchanged plan), and nothing is graded from `reply`. A runner-side failure (nothing to confirm, no card) is not marked. */
export function errorView(error: string | undefined, summary: ReturnType<typeof summarize>, executing = false) {
  return error && !RUNNER_ERRORS.test(error) ? { view: summary, stale: true as const, reply: secretaryErrorMessage(error, { executing }).text } : { view: summary };
}
function probe(v: ReturnType<typeof summarize>) {
  const plan = v?.plan;
  const temporal = Object.fromEntries((v?.operations ?? []).flatMap(o => [
    ...(o.scheduling ? [[(o.keys ?? []).join('+') || 'single', { temporal_missing: o.scheduling.temporal_missing ?? [], source_missing: o.scheduling.source_missing ?? [],
      ambiguities: o.scheduling.temporal_ambiguities ?? [], calendar: o.scheduling.calendar_conflicts ?? [], review: o.scheduling.review?.status ?? null }] as const] : []),
    ...(o.batch?.items ?? []).filter(i => i.temporal_missing?.length || i.source_missing?.length).map(i => [i.key, { temporal_missing: i.temporal_missing ?? [], source_missing: i.source_missing ?? [] }] as const),
  ]));
  return { revision: plan?.revision ?? null, status: plan?.status ?? null, groups: plan?.groups.map(g => `${g.key}:${g.status}`) ?? [],
    missing: Object.fromEntries((plan?.actions ?? []).filter(a => a.missing.length).map(a => [a.key, a.missing])),
    issues: Object.fromEntries((plan?.actions ?? []).filter(a => a.issue).map(a => [a.key, a.issue])), temporal };
}

export async function tenantState(admin: PrismaClient, tenant: string) {
  const [appointments, timeOff] = await Promise.all([
    admin.appointment.findMany({ where: { salonId: tenant }, include: { client: { select: { name: true } }, professional: { include: { user: { select: { name: true } } } }, serviceItems: { select: { serviceName: true }, orderBy: { position: 'asc' } } }, orderBy: { startAt: 'asc' } }),
    admin.timeOff.findMany({ where: { professional: { salonId: tenant } }, include: { professional: { include: { user: { select: { name: true } } } } }, orderBy: { startAt: 'asc' } }),
  ]);
  const local = (d: Date) => d.toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16);
  return {
    appointments: appointments.map(a => `${a.client?.name ?? '?'} | ${a.serviceItems.map(s => s.serviceName).join('+')} | ${local(a.startAt)}→${local(a.endAt).slice(11)} | ${a.professional.user.name} | ${a.status}`),
    blocks: timeOff.map(t => `${t.professional?.user.name ?? 'salão'} | ${local(t.startAt)}→${local(t.endAt)} | ${t.reason ?? ''}`),
    reasons: appointments.map(a => a.cancelledReason ?? null), // aligned with `appointments`
    effects: await tenantEffects(admin, tenant),
  };
}
/** `count:hash` per tenant table outside the appointment/time-off lines (EFFECT_TABLES): digests only, no row text. */
async function tenantEffects(admin: PrismaClient, tenant: string): Promise<Record<string, string>> {
  const where = { salonId: tenant }, scoped = { professional: where }, id = { id: 'asc' } as const;
  const rows: Record<(typeof EFFECT_TABLES)[number], Promise<unknown[]>> = {
    appointment_services: admin.appointmentService.findMany({ where, orderBy: [{ appointmentId: 'asc' }, { position: 'asc' }] }),
    appointment_events: admin.appointmentEvent.findMany({ where, orderBy: id }),
    resource_bookings: admin.resourceBooking.findMany({ where, orderBy: [{ appointmentId: 'asc' }, { resourceId: 'asc' }] }),
    outbox_internal: admin.notificationOutbox.findMany({ where: { ...where, channel: 'INTERNAL' }, orderBy: id }),
    outbox_external: admin.notificationOutbox.findMany({ where: { ...where, channel: { not: 'INTERNAL' } }, orderBy: id }),
    customers: admin.clientProfile.findMany({ where, orderBy: id }),
    services: admin.service.findMany({ where, orderBy: id }),
    products: admin.product.findMany({ where, orderBy: id }),
    appointment_products: admin.appointmentProduct.findMany({ where, orderBy: id }),
    closures: admin.salonClosure.findMany({ where, orderBy: id }),
    payments: admin.payment.findMany({ where: { appointment: where }, orderBy: id }),
    professionals: admin.professional.findMany({ where, orderBy: id }),
    working_hours: admin.workingHours.findMany({ where, orderBy: id }),
    professional_services: admin.professionalService.findMany({ where: scoped, orderBy: [{ professionalId: 'asc' }, { serviceId: 'asc' }] }),
  };
  const json = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x);
  const out: Record<string, string> = {};
  for (const [table, query] of Object.entries(rows)) { const list = await query; out[table] = `${list.length}:${createHash('sha256').update(json(list)).digest('hex').slice(0, 16)}`; }
  return out;
}
/** Latest SECRETARY_ROUTER audit row of this tenant written by the send just made (codes only). */
async function routerTelemetry(admin: PrismaClient, tenant: string, seen: Set<string>) {
  const row = await admin.auditLog.findFirst({ where: { salonId: tenant, entityType: 'SECRETARY_ROUTER' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, action: true, metadata: true } });
  if (!row || seen.has(row.id)) return null;
  seen.add(row.id);
  return { path: codesOnly(row.action) ?? null, ...(codesOnly(row.metadata) as Record<string, unknown> | undefined ?? {}) };
}
/** Reschedule pilot arm (H6): the latest SECRETARY_PILOT audit row of this tenant written by the step just made, codes and numbers only
 * (pilotTurnTelemetry's allowlist; never a name, a ref or the owner's words). */
async function pilotTelemetryRow(admin: PrismaClient, tenant: string, seen: Set<string>) {
  const row = await admin.auditLog.findFirst({ where: { salonId: tenant, entityType: 'SECRETARY_PILOT' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, action: true, metadata: true } });
  if (!row || seen.has(row.id)) return null;
  seen.add(row.id);
  return pilotTurnTelemetry(row.action, row.metadata);
}
/** Scenario-level professional hours on top of the seeded fixture (synthetic tenant only). `windows` (a salon scenario)
 * replaces the professional's seeded uniform day with the salon's weekly windows (breaks, shorter days). */
export async function applyProfessionalHours(admin: Pick<PrismaClient, '$transaction'>, identity: FixtureIdentity, hours: ProfessionalHours[], openWeekdays: number[], open: number, close: number) {
  if (!hours.length) return;
  await admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${identity.tenant},true)`;
    await tx.$executeRaw`SELECT set_config('app.current_user_id',${identity.actor},true)`;
    for (const h of hours) {
      const professionalId = identity.bindings['professional:' + h.key];
      if (!professionalId) throw Error('AGENDA_PROFESSIONAL_BINDING');
      if (h.windows) {
        await tx.workingHours.deleteMany({ where: { salonId: identity.tenant, professionalId } });
        if (h.windows.length) await tx.workingHours.createMany({ data: h.windows.map(w => ({ salonId: identity.tenant, professionalId, weekday: w.weekday, startMinutes: w.startMinutes, endMinutes: w.endMinutes })) });
        continue;
      }
      if (h.weekdays) {
        await tx.workingHours.deleteMany({ where: { salonId: identity.tenant, professionalId, weekday: { notIn: h.weekdays } } });
        const extra = h.weekdays.filter(w => !openWeekdays.includes(w));
        if (extra.length) await tx.workingHours.createMany({ data: extra.map(weekday => ({ salonId: identity.tenant, professionalId, weekday, startMinutes: open, endMinutes: close })) });
      }
      if (h.fromMinutes !== undefined || h.toMinutes !== undefined) await tx.workingHours.updateMany({ where: { salonId: identity.tenant, professionalId },
        data: { ...(h.fromMinutes !== undefined ? { startMinutes: h.fromMinutes } : {}), ...(h.toMinutes !== undefined ? { endMinutes: h.toMinutes } : {}) } });
    }
  });
}

export type AgendaRunOptions = { stage?: string; repeat?: number; /** per pass; default = headroom estimate */ maxRequests?: number; closedDay?: 'skip' | 'fail';
  /** default 'off' (texts sent exactly as written, comparable with legacy runs) */ noise?: NoiseProfile;
  /** evaluation only; default AGENDA_ANSWER_DELIVERY, else 'field' (the legacy delivery, comparable with legacy runs) */ answerDelivery?: AnswerDelivery;
  /** F2: the clock of day anchors and the midnight guard (injected in tests; default the system clock) */ clock?: AgendaClock;
  /** C5 (§6.2, `--ids-file` / readScenarioIds): run only these scenario ids of the files given (an unknown id is refused). Never
   * passed by the sealed or validation runners, which run their whole file. */ ids?: readonly string[] };
/** F1: a sealed/validation run hands the runner the preflight it checked before the look (never recomputed), the stage
 * lease it holds (the runner then neither takes nor releases one) and its program-wide proof lease (its paid calls are the only
 * ones the program ledger admits while it runs). */
export type AgendaRunInput = AgendaRunOptions & { preflight?: AgendaPreflight; lease?: StageLease; proofLease?: ProofLease };
/** Pure preflight (no DB, no network): stage headroom, run-day and noise-invariant checks for the selected scenarios, over
 * every São Paulo day the run can reach (F2), with an Intl clock block. */
export function preflightAgendaPractice(input: AgendaScenario[], opts: AgendaRunOptions & { proofLease?: ProofLease } = {}, now = (opts.clock ?? SYSTEM_CLOCK).now()) {
  assertNonProduction(process.env);
  assertSaoPauloClock(); // ICU self-test: AGENDA_TZ_UNAVAILABLE instead of a wrong day
  const repeat = opts.repeat ?? 1, profile = noiseProfile(opts.noise ?? 'off');
  answerDeliveryMode(opts.answerDelivery ?? process.env.AGENDA_ANSWER_DELIVERY); // AGENDA_ANSWER_DELIVERY_ARGUMENT before any file or database
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 8) throw Error('AGENDA_REPEAT');
  if (opts.maxRequests !== undefined && (!Number.isInteger(opts.maxRequests) || opts.maxRequests < 1)) throw Error('AGENDA_MAX_REQUESTS_ARGUMENT');
  // C5: the agent arm is the product flag, read once here (dependencies and effort checked before any file, database or network).
  const agent = agentArm(process.env);
  if (agent) assertAgentArm(process.env);
  // Reschedule pilot arm (SALON_SECRETARY_PILOT_RESCHEDULE): read once here as well; with it on, every owner message goes to the pilot, so an
  // agent arm at the same time would be measured as something it is not.
  const pilot = pilotArm(process.env);
  if (pilot && agent) throw Error('AGENDA_ARM_CONFLICT');
  const stage = agendaStage(opts.stage ?? DEFAULT_AGENDA_STAGE), scenarios = opts.ids ? selectScenarioIds(validateScenarios(input), opts.ids) : validateScenarios(input);
  const resultsRoot = join(process.cwd(), RESULTS), stageFile = stageJournalPath(resultsRoot, stage.name);
  const today = todayInSaoPaulo(now), legacy = legacyOracle(today), legacyByDay = new Map<string, LegacyMap>([[today, legacy.E]]);
  const legacyFor = (day: string) => { if (!legacyByDay.has(day)) legacyByDay.set(day, legacyOracle(day).E); return legacyByDay.get(day)!; };
  const runDay = runDayPreflight(scenarios, today, legacy.E), skipped = runDay.filter(d => d.action === 'SKIP');
  const runnable = scenarios.filter(s => !skipped.some(d => d.id === s.id));
  // F2: every day the run can reach (estimate + one guard sleep); a scenario SKIP on a later reachable day is a rollover skip.
  const dayWindow = dayWindowPreflight(runnable, now, runEstimateMs(runnable, repeat, agent, pilot), legacyFor);
  // Every text the run could send, for every attempt and every reachable day, must keep its meaning under the selected noise (codes only, no text).
  const noise = noisePreflight(runnable, { profile, repeat, today, legacy: legacy.E });
  const violations = [...noise.violations, ...dayWindow.days.slice(1).flatMap(day => noisePreflight(runnable, { profile, repeat, today: day, legacy: legacyFor(day) }).violations)];
  if (violations.length) throw Object.assign(Error('AGENDA_NOISE_INVARIANT'), { details: violations.slice(0, 20) });
  const totals = stageTotals(stageFile, stage.name), maxOutputTokens = outputTokens(process.env);
  // One rerun per midnight the run may cross (the attempt in flight at 00:00), reserved up front like any other request.
  const rerunRequests = (dayWindow.days.length - 1) * Math.max(0, ...runnable.map(s => expectedCalls(s, { agent, pilot }).calls));
  const estimate = headroomEstimate({ scenarios: runnable, repeat, perPassMaxRequests: opts.maxRequests, maxOutputTokens, spentMicroUsd: totals.reservedMicroUsd, capMicroUsd: stage.capMicroUsd,
    extraRequests: rerunRequests, agent, pilot });
  // Program-wide real-spend ledger (shared with the Golden runner): whole chain validated before any database access.
  const programLedger = programSpendLedgerPath(), programSpend = programSpendTotals(programLedger);
  // F1: while a sealed/validation run holds the program-wide proof lease, no other run starts (its paid calls would be refused).
  assertProofAdmits(programLedger, opts.proofLease);
  return { stage, stageFile, resultsRoot, today, repeat, runDay, skipped, runnable, totals, estimate, maxOutputTokens, legacyOracleSha256: legacy.sha256, legacyE: legacy.E, noise, programSpend,
    programLedger, dayWindow, clock: dayWindow.clock, agent, pilot };
}
export type AgendaPreflight = ReturnType<typeof preflightAgendaPractice>;
const closedDayError = (list: { id: string; dates: string[]; day?: string }[], rollover = false) =>
  Object.assign(Error('AGENDA_CLOSED_DAY'), { details: rollover ? { rollover: list } : list });

/** F1/F4: read-only identity of the local disposable database (127.0.0.1:55441/everflair_service_mvp, byte-safe data directory,
 * non-bypass runtime role, FORCE RLS): the sealed/validation infrastructure preflight runs it before a look is consumed. */
export async function agendaDatabaseIdentity() {
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  try { return await assertFreeUseDatabase(admin, prisma); } finally { await admin.$disconnect(); }
}

export async function runAgendaPractice(scenarios: AgendaScenario[], out: string, opts: AgendaRunInput = {}) {
  const clock = opts.clock ?? SYSTEM_CLOCK;
  const pre = opts.preflight ?? preflightAgendaPractice(scenarios, opts, clock.now());
  if (opts.preflight && pre.runnable.some(s => !scenarios.includes(s))) throw Error('AGENDA_PREFLIGHT_MISMATCH');
  const { stage, stageFile, today: firstDay, repeat, runnable, estimate, maxOutputTokens } = pre, profile = pre.noise.profile;
  if (pre.skipped.length && opts.closedDay === 'fail') throw closedDayError(pre.skipped.map(d => ({ id: d.id, dates: [...new Set([...d.closed, ...d.invalid].map(c => c.date))] })));
  if (pre.dayWindow.rolloverSkips.length && opts.closedDay === 'fail') throw closedDayError(pre.dayWindow.rolloverSkips, true);
  assertHeadroom(estimate); // before any network
  // F1: everything that can still throw before the main try/finally is computed BEFORE the stage lease (environment and code
  // only: no file, database or network), so an early refusal (e.g. INVALID_EXAMPLES_MODE) never leaves the stage leased.
  const flags = secretaryFlagSnapshot(process.env), examples = examplesContractTag(process.env), delivery = answerDeliveryMode(opts.answerDelivery ?? process.env.AGENDA_ANSWER_DELIVERY);
  // C5: the arm the preflight read is still this process's (a sealed run hands its own preflight); the evaluator version (§9.4).
  const agent = pre.agent ?? agentArm(process.env), evaluator = evaluatorVersion();
  if (agent !== agentArm(process.env)) throw Error('AGENDA_AGENT_ARM_DRIFT');
  if (agent) assertAgentArm(process.env);
  // Reschedule pilot arm: the same drift check (a sealed run hands its own preflight).
  const pilot = pre.pilot ?? pilotArm(process.env);
  if (pilot !== pilotArm(process.env)) throw Error('AGENDA_PILOT_ARM_DRIFT');
  if (pilot && agent) throw Error('AGENDA_ARM_CONFLICT');
  // C6 (rec 19): the model contract (prompt templates, wire, model, limits, contract flags) every scenario ran under.
  const contractVersion = secretaryContractVersion({ modelId: 'gpt-6-luna', presentation: backendPresentationDigest() });
  const programLedger = programSpendLedgerPath(), programRun = programSpendLabel(`practice:${basename(out)}`), proof = opts.proofLease;
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } }); // no connection before its first query
  const run = clock.now().toISOString().replace(/[:.]/g, '-');
  // F1: one runner per stage journal for the whole run, before any file, database access or network (a sealed run hands its own).
  const ownLease = !opts.lease, lease = opts.lease ?? acquireStageLease(stageFile, stage.name, run);
  let leaseReleased: boolean | null = ownLease ? false : null;
  const releaseOwnLease = () => { if (!ownLease || leaseReleased) return; try { releaseStageLease(lease, stageFile, stage.name); leaseReleased = true; } catch { /* stays: the next run is refused (fail closed) */ } };
  try {
    assertStageLeaseHeld(lease, stageFile, stage.name);
    // Under the lease no other runner reserves: the headroom seen by the preflight must still be there (never found mid-run).
    if (estimate.requiredMicroUsd > stageTotals(stageFile, stage.name).remainingMicroUsd) throw Error('AGENDA_STAGE_HEADROOM');
    mkdirSync(out, { recursive: true });
  } catch (e) { releaseOwnLease(); throw e; }
  // F2: `today` is anchored per scenario attempt (fixture, answers, noise context, legacy E map, rendered oracle, header).
  const legacyByDay = new Map<string, LegacyMap>([[firstDay, pre.legacyE]]);
  const legacyE = (day: string) => { if (!legacyByDay.has(day)) legacyByDay.set(day, legacyOracle(day).E); return legacyByDay.get(day)!; };
  const days: string[] = [], reruns: { id: string; k: number; from: string; to?: string; discarded: string }[] = [], guards: { label: string; action: string; sleepMs: number; code?: string }[] = [];
  const closedDayAttempts: { id: string; k: number; day: string }[] = [];
  const network = globalThis.fetch;
  let active: { scenario: string; step: number; calls: number } | null = null, requests = 0, abort: string | undefined, measured = false, version: string | null = null;
  const versions: Record<string, number> = {};
  // `round`/`record` (agent arm only): the call's position in its step and what the replay needs of it (AgentCallRecord).
  const usage: { scenario: string; step: number; input: number; cached: number; output: number; latencyMs: number; arguments?: string; round?: number; record?: AgentCallRecord }[] = [];
  // Agent arm: eligible owner turns by path (router outcome, codes only).
  const agentPaths: Record<string, number> = {};
  globalThis.fetch = async (input, init) => {
    function halt(code: string): never { abort ??= code; throw Error(code); }
    if (!active) halt('AGENDA_UNEXPECTED_NETWORK');
    if (typeof input !== 'string' || input !== RESPONSES_URL || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') halt('AGENDA_WIRE_REQUEST');
    if (++requests > estimate.maxRequests) halt('AGENDA_MAX_REQUESTS');
    const body = init.body as string; let payload: { max_output_tokens?: number; instructions?: unknown; tools?: { parameters?: unknown }[]; model?: unknown };
    try { payload = JSON.parse(body); } catch { halt('AGENDA_WIRE_REQUEST'); }
    if (!measured) { // measured first request: re-check headroom when the real body is larger than the estimate
      measured = true;
      const bytes = Buffer.byteLength(body, 'utf8'), outTokens = Number(payload.max_output_tokens) || maxOutputTokens;
      if ((bytes > ESTIMATE_BODY_BYTES || outTokens > maxOutputTokens) && estimate.maxRequests * reservationMicroUsd(Math.ceil(Math.max(bytes, ESTIMATE_BODY_BYTES) * 1.1), Math.max(outTokens, maxOutputTokens)) > estimate.remainingMicroUsd) halt('AGENDA_STAGE_HEADROOM');
    }
    const v = requestVersion(payload, examples); version ??= v; versions[v] = (versions[v] ?? 0) + 1;
    const ctx = active;
    // C5 agent arm: the call's position in its step (≤ 3 per owner message), its ledger label `…:s<step>:r<n>` and the clock of the replay.
    const call = ++ctx.calls, at = agent || pilot ? clock.now().toISOString() : '', item = programSpendLabel(`${ctx.scenario}:s${ctx.step}${agent ? `:r${call}` : ''}`);
    // Program-wide real-spend cap first: a refused call consumes neither a stage reservation nor transport.
    try { await assertProgramHeadroom(input, init, { ledger: programLedger, proof, agent, pilot }); } catch (e) { halt(programSpendCode(e)); }
    // F1: bounded lock wait inside reserve(); the row is admitted only for the run holding the stage lease.
    try { reserve(stageFile, run, ctx.scenario, ctx.step, body, stage.name, { lease, agent, pilot }); }
    catch (e) { const code = (e as NodeJS.ErrnoException).code === 'EEXIST' ? 'AGENDA_STAGE_LOCKED' : e instanceof Error ? e.message : 'ERROR'; if (RUN_ABORTS.has(code)) halt(code); throw e; }
    const started = performance.now(); let response: Response;
    const failed = (error: string, http?: number) => { if (agent || pilot) usage.push({ scenario: ctx.scenario, step: ctx.step, input: 0, cached: 0, output: 0, latencyMs: Math.round(performance.now() - started),
      round: call, record: { ...agentCallRecord(call, at, v, payload, undefined, http ?? 200), error } }); };
    // Actual usage (or the worst case) is charged to the program ledger around transport; a ledger failure stops the run.
    try { response = await guardPaidFetch('practice', network, { ledger: programLedger, run: programRun, item, proof, agent, pilot })(input, init); }
    catch (e) { if (isProgramSpendError(e)) halt(e.message); failed('TRANSPORT'); throw e; }
    try {
      const json = await response.clone().json() as { output?: { type?: string; arguments?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } };
      usage.push({ scenario: ctx.scenario, step: ctx.step, input: json.usage?.input_tokens ?? 0, cached: json.usage?.input_tokens_details?.cached_tokens ?? 0, output: json.usage?.output_tokens ?? 0, latencyMs: Math.round(performance.now() - started), arguments: json.output?.find(o => o.type === 'function_call')?.arguments,
        ...(agent || pilot ? { round: call, record: agentCallRecord(call, at, v, payload, json, response.status) } : {}) });
    } catch { failed('UNREADABLE', response.status); /* usage unknown stays absent (C4 arm); reservation remains the bound */ }
    return response;
  };
  const results: { id: string; attempt: number; title: string; steps: number; today: string; rerunOf?: string }[] = [], completed = new Set<string>(); let failure: unknown;
  // The attempt in progress; an abort before its first save still leaves an INCOMPLETE stub for the pass^k report.
  // Assigned inside attemptOnce (a closure): the assertion keeps the outer catch/report from narrowing it to `undefined`.
  let current = undefined as { dir: string; scenario: AgendaScenario; attempt: number; today: string; save?: (complete: boolean) => void; done?: boolean } | undefined;
  /** One attempt, anchored to ONE São Paulo day. ROLLOVER = the day changed inside it (discarded, rerun by the caller);
   * CLOSED = a day the preflight did not cover is closed for this scenario (--closed-day skip; 'fail' stops the run). */
  const attemptOnce = async (s: AgendaScenario, attempt: number, dir: string, namespace: string, rerunOf?: string): Promise<{ kind: 'DONE' | 'CLOSED'; from: string } | { kind: 'ROLLOVER'; discarded: string; from: string }> => {
        const anchoredAt = clock.now(), today = todayInSaoPaulo(anchoredAt);
        const cur: NonNullable<typeof current> = { dir, scenario: s, attempt, today }; current = cur;
        if (!days.includes(today)) days.push(today);
        const stillToday = () => { if (todayInSaoPaulo(clock.now()) !== today) throw new DayRollover(); };
        if (today !== firstDay) { // closed-day checks apply to every day actually used
          const check = runDayPreflight([s], today, legacyE(today))[0];
          if (check.action === 'SKIP') {
            const dates = [...new Set([...check.closed, ...check.invalid].map(c => c.date))];
            if (opts.closedDay === 'fail') { abort ??= 'AGENDA_CLOSED_DAY'; throw closedDayError([{ id: s.id, day: today, dates }], true); }
            writeFileSync(join(dir, `${s.id}.json`), JSON.stringify({ run, stage: stage.name, repeat, attempt, today, dayAnchor: { today, at: anchoredAt.toISOString() }, flags, scenario: s,
              initial: null, version, complete: false, abort: 'AGENDA_CLOSED_DAY', transcript: [] }, null, 2));
            closedDayAttempts.push({ id: s.id, k: attempt, day: today }); cur.done = true;
            return { kind: 'CLOSED', from: today };
          }
        }
        const label = `${s.id}#k${attempt}`, { fixture, hours, multiService } = buildScenarioFixture(s, today);
        const level = noiseLevel(profile, attempt, s), noiseCtx = scenarioNoiseContext(s, today, legacyE(today)), scriptStep = new Map<Step, number>(s.steps.map((st, n) => [st, n + 1] as const));
        const identity = await seedFreeUseFixture(admin, namespace, s.id, fixture, TZ);
        await applyProfessionalHours(admin, identity, hours, fixture.openWeekdays, fixture.openMinutes, fixture.closeMinutes);
        // Appointments with several services (`services`): stored as the product stores one (none for every other scenario).
        await seedMultiServiceAppointments(admin, identity, { namespace, caseId: s.id }, fixture, multiService);
        const actor = { salonId: identity.tenant, userId: identity.actor };
        // D1: the persisted conversation store when SALON_SECRETARY_PERSISTED_STATE is on (the DB gate then asserts its FORCE RLS).
        const secretary = new SalonSecretary(async (): Promise<Model> => createPaidModel(process.env), () => 'gpt-6-luna', undefined, { enabled: () => false }, { enabled: () => true }, persistedSessionStore);
        const session = await secretary.start(actor, 'auto');
        const transcript: unknown[] = []; let view: SecretaryView | undefined = session; let index = 0;
        const book = new AnswerBook(s.answers, label, today, delivery), routerSeen = new Set<string>(), pilotSeen = new Set<string>();
        // 'item' delivery: the fixture's customer names and the texts already sent (original, before noise) tell whom an answer is for.
        const customers = delivery === 'item' ? (fixture as unknown as { customers: { name: string }[] }).customers.map(c => c.name) : [], said: string[] = [];
        const pendingFields = (v?: SecretaryView) => [...new Set((v?.action_plan?.actions ?? []).filter(a => a.status !== 'DONE').flatMap(a => a.missing_fields).map(f => f.includes('.') ? f.slice(f.indexOf('.') + 1) : f).filter(f => f !== 'selection'))];
        const initial = await tenantState(admin, identity.tenant);
        const header = { run, stage: stage.name, repeat, attempt, today, dayAnchor: { today, at: anchoredAt.toISOString() }, ...(rerunOf ? { rerunOf, rerunCause: 'DAY_ROLLOVER' } : {}),
          seedNamespace: namespace, flags, contractVersion, evaluatorVersion: evaluator, ...(agent ? { arm: 'AGENT' } : pilot ? { arm: 'PILOT' } : {}),
          ...(profile !== 'off' ? { noise: { profile, level } } : {}), ...(delivery !== 'field' ? { answerDelivery: delivery } : {}),
          ...(multiService.length ? { seedFormat: { multiService: MULTI_SERVICE_SEED_VERSION } } : {}),
          scenario: s, oracle: s.final ? renderFinal(s.final, today) : undefined, tenant: identity.tenant, initial };
        const save = (complete: boolean) => writeFileSync(join(dir, `${s.id}.json`), JSON.stringify({ ...header, version, complete, ...(abort ? { abort } : {}), transcript }, null, 2));
        cur.save = save;
        const candidateItems = (o: NonNullable<SecretaryView['operations']>[number]) => o.state.scheduling?.candidates?.items ?? (o.state.batch?.draft?.candidates as { items?: { id: string; name: string }[] } | undefined)?.items ?? [];
        const queue: (Step | { answer: string; field: string; use: number; for?: AnswerFor })[] = [...s.steps];
        save(false);
        try {
        while (queue.length) {
          const step = queue.shift()!;
          index++;
          if ('note' in step) { transcript.push({ step: index, note: step.note }); continue; }
          stillToday();
          const before = usage.length, started = performance.now(); let error: string | undefined, input: unknown, router: unknown, confirmed: string[] | undefined, noise: Record<string, unknown> | undefined;
          const user = 'say' in step || 'answer' in step;
          try {
            if ('say' in step || 'answer' in step) {
              // Noise applies AFTER templating to the text sent only (never to oracles or clicks); seed = scenario, attempt, text origin.
              const original = 'say' in step ? renderTemplate(step.say, today) : step.answer;
              const source = 'say' in step ? `say:${scriptStep.get(step)}` : `answer:${step.field}:${step.use}`, seed = noiseSeed(s.id, attempt, source);
              const noised = applyNoise(original, level, seed, noiseCtx), message = noised.text; input = message;
              if (profile !== 'off') noise = { profile, level, seed, scenario: s.id, attempt, step: index, source, original, sent: message, rules: noised.rules };
              if (level !== 'off' && noiseViolations(original, message, noiseCtx).length) { abort ??= 'AGENDA_NOISE_INVARIANT'; throw Error('AGENDA_NOISE_INVARIANT'); }
              active = { scenario: label, step: index, calls: 0 }; process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'true';
              try { view = await secretary.send(actor, { sessionId: session.sessionId, message }); }
              finally { active = null; process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false'; }
              // Answer only what was actually asked, once per answer instance, before the next scripted step.
              if (delivery === 'item') said.push(original);
              const next = book.next(pendingFields(view), delivery === 'item'
                ? answerQuestion(view?.message, view?.action_plan?.actions, { customers, said, later: queue.flatMap(q => 'say' in q ? [q.say] : []) }) : undefined);
              if (next) queue.unshift({ answer: next.text, field: next.field, use: next.use, ...(next.for ? { for: next.for } : {}) });
            } else if ('confirm' in step && step.confirm === 'all') {
              // Every READY group through the Front's "confirm everything that is ready" call (one approval per
              // group, all validated before any executes); without it, one group per call. A group the backend
              // reports as changed comes back READY with a new token and is approved again on the next pass.
              confirmed = []; const tried = new Set<string>();
              const readyGroups = (v?: SecretaryView) => v?.action_plan?.confirmation_groups.filter(g => g.status === 'READY_FOR_CONFIRMATION') ?? [];
              for (let ready = readyGroups(view); ready.length; ready = readyGroups(view)) {
                const plan = view!.action_plan!, token = ready.map(g => `${g.key}:${g.fingerprint}`).join('|');
                if (tried.has(token) || tried.size >= 12) throw Error('CONFIRM_ALL_STUCK');
                tried.add(token);
                const approvals = ready.map(g => ({ plan_ref: plan.plan_ref, revision: plan.revision, group_key: g.key, fingerprint: g.fingerprint }));
                if (typeof secretary.confirmReadyGroups === 'function') {
                  view = await secretary.confirmReadyGroups(actor, session.sessionId, approvals);
                  confirmed.push(...(view.confirmation_batch?.executed ?? []));
                } else {
                  view = await secretary.confirmActionPlanGroup(actor, session.sessionId, approvals[0]);
                  confirmed.push(approvals[0].group_key);
                }
              }
              if (!confirmed.length) throw Error('NOTHING_TO_CONFIRM');
            } else if ('confirm' in step) {
              const plan = view?.action_plan;
              const group = plan?.confirmation_groups.find(g => g.status === 'READY_FOR_CONFIRMATION');
              const ready = plan?.confirmation_groups.filter(g => g.status === 'READY_FOR_CONFIRMATION') ?? [];
              // One click on the Front's primary control: with 2+ ready groups (per-component grouping) that is
              // "Confirmar tudo que está pronto", which a packed plan expressed as its single group.
              if (plan && ready.length > 1 && typeof secretary.confirmReadyGroups === 'function') {
                view = await secretary.confirmReadyGroups(actor, session.sessionId, ready.map(g => ({ plan_ref: plan.plan_ref, revision: plan.revision, group_key: g.key, fingerprint: g.fingerprint })));
                confirmed = view.confirmation_batch?.executed ?? [];
              } else if (plan && group) view = await secretary.confirmActionPlanGroup(actor, session.sessionId, { plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint });
              else if (plan) throw Error('NOTHING_TO_CONFIRM');
              else {
                const op = view?.operations?.find(o => o.state.scheduling?.proposal || o.state.batch?.proposal);
                const proposal = op?.state.scheduling?.proposal ?? op?.state.batch?.proposal;
                if (!op || !proposal) throw Error('NOTHING_TO_CONFIRM');
                view = await secretary.confirmAutomatic(actor, session.sessionId, op.operation_ref, { proposal_ref: proposal.proposal_ref, draft_revision: proposal.draft_revision });
              }
            } else if ('select' in step) {
              const wanted = renderTemplate(step.select, today); input = wanted;
              const match = (view?.operations ?? []).flatMap(o => candidateItems(o).filter(i => i.name.toLowerCase().includes(wanted.toLowerCase())).map(i => ({ op: o.operation_ref, id: i.id })));
              if (match.length !== 1) throw Error('SELECT_' + match.length);
              view = await secretary.selectAutomatic(actor, session.sessionId, match[0].op, match[0].id);
            } else if ('choose' in step) {
              input = step.choose;
              const card = (view?.operations ?? []).filter(o => !step.action || o.action_keys?.includes(step.action)).map(o => ({ op: o.operation_ref, items: candidateItems(o) })).find(c => c.items.length);
              if (!card) throw Error('CHOOSE_NO_CARD');
              const item = card.items[step.choose - 1];
              if (!item) throw Error('CHOOSE_RANGE');
              view = await secretary.selectAutomatic(actor, session.sessionId, card.op, item.id);
            }
          } catch (e) { error = e instanceof Error ? e.message.slice(0, 160) : 'ERROR'; }
          if (user) try { router = await routerTelemetry(admin, identity.tenant, routerSeen); } catch { router = null; }
          let pilotRow: ReturnType<typeof pilotTurnTelemetry> | null = null;
          if (pilot) try { pilotRow = await pilotTelemetryRow(admin, identity.tenant, pilotSeen); } catch { pilotRow = null; }
          const calls = usage.slice(before), summary = summarize(view);
          if (agent && user) { const path = agentTurnOf({ router: router as TranscriptRow['router'] })?.path ?? 'NOT_ELIGIBLE'; agentPaths[path] = (agentPaths[path] ?? 0) + 1; }
          transcript.push({ step: index, action: 'say' in step ? 'say' : 'answer' in step ? 'answer:' + step.field : 'confirm' in step ? (step.confirm === 'all' ? 'confirm:all' : 'confirm') : 'select' in step ? 'select' : 'choose',
            input, ...('answer' in step && step.for ? { answerFor: step.for } : {}), ...(noise ? { noise } : {}), pending: pendingFields(view), error, latencyMs: Math.round(performance.now() - started), calls: calls.length, luna: calls.map(c => c.arguments),
            tokens: calls.reduce((n, c) => ({ input: n.input + c.input, cached: n.cached + c.cached, output: n.output + c.output }), { input: 0, cached: 0, output: 0 }),
            ...(agent || pilot ? { agentCalls: calls.flatMap(c => c.record ? [c.record] : []) } : {}), ...(pilot ? { pilot: pilotRow } : {}),
            ...(confirmed ? { confirmed } : {}), ...(user ? { router } : {}), probe: probe(summary), ...errorView(error, summary, 'confirm' in step), db: await tenantState(admin, identity.tenant) });
          save(false);
          if (abort) throw Error(abort);
          stillToday();
        }
        } catch (e) {
          if (!(e instanceof DayRollover)) throw e;
          // Outcome-independent: the attempt (PASS or not) is kept apart as `<id>.rollover[-n].json`, never graded, and rerun.
          const discarded = `${s.id}.rollover${rerunOf ? '-2' : ''}.json`;
          writeFileSync(join(dir, discarded), JSON.stringify({ ...header, version, complete: false, discarded: true, discardCause: 'DAY_ROLLOVER', rolloverAt: clock.now().toISOString(), transcript }, null, 2));
          try { unlinkSync(join(dir, `${s.id}.json`)); } catch { /* not saved yet */ }
          cur.done = true;
          return { kind: 'ROLLOVER', discarded, from: today };
        }
        save(true); cur.done = true; completed.add(label);
        results.push({ id: s.id, attempt, title: s.title, steps: transcript.length, today, ...(rerunOf ? { rerunOf } : {}) });
        appendFileSync(join(dir, 'index.jsonl'), JSON.stringify({ id: s.id, file: `${s.id}.json`, attempt }) + '\n');
        return { kind: 'DONE', from: today };
  };
  try {
    await assertFreeUseDatabase(admin, prisma);
    for (let attempt = 1; attempt <= repeat; attempt++) {
      const dir = join(out, `k${attempt}`), namespace = `agenda-practice-${run}-k${attempt}`;
      mkdirSync(dir, { recursive: true });
      for (const s of runnable) {
        heartbeatStageLease(lease, stageFile, stage.name); // still this run's stage (AGENDA_STAGE_LEASE_LOST / BUSY otherwise)
        const label = `${s.id}#k${attempt}`;
        // F2 midnight guard, decided by the clock only: not enough time left for this attempt's budget -> wake at 00:00:30.
        const guard = midnightGuard(clock.now(), scenarioBudgetMs(s, perCallBudgetMs(usage.map(u => u.latencyMs)), agent, pilot));
        if (guard.action === 'SLEEP') await clock.sleep(guard.sleepMs);
        if (guard.action !== 'RUN') guards.push({ label, action: guard.action, sleepMs: guard.sleepMs, ...(guard.code ? { code: guard.code } : {}) });
        // At most one rerun, in a fresh seed namespace; a second rollover in the same scenario stops the run (bounded).
        const first = await attemptOnce(s, attempt, dir, namespace);
        if (first.kind === 'ROLLOVER') {
          const second = await attemptOnce(s, attempt, dir, `${namespace}-r1`, first.discarded);
          reruns.push({ id: s.id, k: attempt, from: first.from, to: second.from, discarded: first.discarded });
          if (second.kind === 'ROLLOVER') {
            abort ??= ROLLOVER; if (current) { current.done = false; current.save = undefined; } // left as an INCOMPLETE stub, never graded
            throw Error(ROLLOVER);
          }
        }
      }
    }
  } catch (e) {
    failure = e; abort ??= e instanceof Error ? e.message.slice(0, 80) : 'ERROR';
    // The interrupted attempt is always left as complete:false with the abort code (a stub when nothing was saved yet).
    if (current && !current.done) try {
      if (current.save) current.save(false);
      else writeFileSync(join(current.dir, `${current.scenario.id}.json`), JSON.stringify({ run, stage: stage.name, repeat, attempt: current.attempt, today: current.today, flags, scenario: current.scenario,
        initial: null, version, complete: false, abort, transcript: [] }, null, 2));
    } catch { /* the report below still lists the run as ABORTED */ }
  }
  finally {
    globalThis.fetch = network; process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false';
    releaseOwnLease();
    await admin.$disconnect(); await prisma.$disconnect();
  }
  const cost = usage.reduce((n, u) => n + ((u.input - u.cached) * PRICE.inputPerM + u.cached * PRICE.inputPerM * 0.1 + u.output * PRICE.outputPerM) / 1e6, 0);
  let own: ReturnType<typeof readStage> = [], totals: ReturnType<typeof stageTotals> | { error: string };
  try { own = readStage(stageFile, stage.name).filter(r => r.run === run); totals = stageTotals(stageFile, stage.name); }
  catch (e) { totals = { error: e instanceof Error ? e.message.slice(0, 80) : 'ERROR' }; } // the report is still written
  let programSpend: ReturnType<typeof programSpendSummary> | { error: string };
  try { programSpend = programSpendSummary(programSpendTotals(programLedger), programRun); }
  catch (e) { programSpend = { error: e instanceof Error ? e.message.slice(0, 80) : 'ERROR' }; }
  // C5 agent arm (§6.3): this run's ledger calls by round suffix and per owner message (the chain was validated just above).
  let agentReport: Record<string, unknown> | undefined;
  if (agent) {
    let byRound: ReturnType<typeof spendByRound> | { error: string };
    try { byRound = spendByRound(readFileSync(programLedger, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as unknown), programRun); }
    catch (e) { byRound = { error: e instanceof Error ? e.message.slice(0, 80) : 'ERROR' }; }
    const eligible = AGENT_PATHS.reduce((n, p) => n + (agentPaths[p] ?? 0), 0), fallback = (agentPaths.C4_FALLBACK ?? 0) + (agentPaths.C4_SKIPPED ?? 0);
    // The S1 arm actually run (owner decisions 13 and 19): the effort of each call and the pre-load (assertAgentArm refused an invalid value).
    let efforts: string;
    try { efforts = agentRoundEfforts(process.env).join(','); } catch { efforts = 'invalid'; }
    agentReport = { effort: process.env.SALON_SECRETARY_AGENT_EFFORT ?? 'medium', efforts, preload: agentPreloadEnabled(), callsPerMessage: AGENT_CALLS_PER_MESSAGE, paths: agentPaths, eligibleTurns: eligible,
      fallbackShare: eligible ? Number((fallback / eligible).toFixed(3)) : null, rounds: agentUsageByRound(usage), programSpendByRound: byRound };
  }
  // A stopped run (budget, cap, limit) reports the interrupted attempt and every attempt never started: never PASS.
  const incomplete = current && !current.done ? `${current.scenario.id}#k${current.attempt}` : null;
  const notExecuted = Array.from({ length: repeat }, (_, i) => runnable.map(s => `${s.id}#k${i + 1}`)).flat().filter(l => !completed.has(l) && l !== incomplete);
  // F2: every São Paulo day an attempt was anchored to, per-attempt days, rollover reruns (with their discarded attempt) and guard sleeps.
  const dayReport = { days, attemptDays: Object.fromEntries(results.map(r => [`${r.id}#k${r.attempt}`, r.today])), reruns, closedDayAttempts,
    midnightGuard: { sleeps: guards.filter(g => g.action === 'SLEEP').length, sleptMs: guards.reduce((n, g) => n + g.sleepMs, 0), unguarded: guards.filter(g => g.action === 'RUN_UNGUARDED').length, events: guards },
    clock: pre.clock, lease: { id: lease.id, own: ownLease, released: leaseReleased } };
  const report = { run, status: failure ? 'ABORTED' : 'COMPLETE', ...(failure ? { abort } : {}), today: firstDay, ...dayReport, repeat, version, versions, contractVersion, flags, noise: { profile, levels: pre.noise.levels },
    arm: agent ? 'AGENT' : pilot ? 'PILOT' : 'C4', evaluatorVersion: evaluator, ...(agentReport ? { agent: agentReport } : {}),
    ...(delivery !== 'field' ? { answerDelivery: delivery } : {}),
    scenarios: runnable.length, ids: runnable.map(s => s.id), scenarioAttempts: results.length, incomplete, notExecuted, skipped: pre.skipped.map(d => ({ id: d.id, closed: d.closed, invalid: d.invalid })), requests,
    usage: { input: usage.reduce((n, u) => n + u.input, 0), cached: usage.reduce((n, u) => n + u.cached, 0), output: usage.reduce((n, u) => n + u.output, 0) },
    // C2 A/B: the examples contract tag and per-call provider latency of this run (the pass^k report groups them per run).
    examples, calls: { count: usage.length, latencyMs: { p50: percentile(usage.map(u => u.latencyMs), 0.5), p90: percentile(usage.map(u => u.latencyMs), 0.9) } },
    estimatedActualUsd: Number(cost.toFixed(6)), reservedUsd: own.reduce((n, r) => n + r.reservedMicroUsd, 0) / 1e6, reservedRequests: own.length,
    preflight: { ...estimate, legacyOracleSha256: pre.legacyOracleSha256 }, stage: { ...totals, journal: stage.journal }, stageCapUsd: stage.capMicroUsd / 1e6, programSpend };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (failure) throw failure;
  return report;
}
export type { AgendaStageName };
/** The runner's own projections, for the offline agent replay (.demo/agenda-core/agent-replay.ts): the same view summary, probe and
 * router row every recorded attempt used. */
export { summarize as summarizeView, probe as probeView, routerTelemetry };
