/** Agenda practice runner: real Luna, local disposable DB, synthetic tenants only.
 *
 * Unlike the free-use gate, this runner may CONFIRM proposals through the same
 * authenticated backend path the Front uses (confirmActionPlanGroup /
 * confirmAutomatic). That exercises execution in fresh synthetic tenants of the
 * local disposable database. No production, no external message (fake provider),
 * no payment. Every paid request is admitted against a separate durable stage
 * journal (USD 7 authorized on 2026-09-27) before the network call. */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';
import { createPaidModel, type Model } from '@everflair/salon-secretary';
import { assertSecretaryResponsesPayload } from '../src/openai-cost-guard';
import { SalonSecretary, type SecretaryView } from '../../../src/lib/salon-secretary';
import { prisma } from '../../../src/lib/prisma';
import { humanMessage } from '../../../src/lib/secretary-ui';
import { dateKeyInTimeZone, addCalendarDays } from '../../../src/lib/time';
import { assertFreeUseDatabase } from './free-use-database';
import { seedFreeUseFixture } from './free-use-fixture';
import type { FreeUseFixture } from './free-use-contract';

export const AGENDA_STAGE = 'agenda-core-20260927';
export const AGENDA_STAGE_CAP_MICRO_USD = 7_000_000;
const PRICE = { inputPerM: 0.10, cacheWritePerM: 0.125, outputPerM: 0.50, framing: 8192, maxInput: 64_000 };
const TZ = 'America/Sao_Paulo';

type Step = { say: string } | { confirm: true } | { select: string } | { note: string };
export type AgendaScenario = { id: string; title: string; capability: string[]; steps: Step[];
  appointments?: { key: string; customer: string; professional: string; service: string; day: number; time: string }[];
  customers?: { key: string; name: string; phone?: string }[];
  expect?: string;
  /** Natural replies sent only when the Secretary actually asks for that field (field names without item prefix). */
  answers?: Record<string, string> };

const base = {
  customers: [
    { key: 'amanda', name: 'Amanda Souza', phone: '11987650001' },
    { key: 'joao', name: 'João Pereira', phone: '11987650002' },
    { key: 'fabio', name: 'Fábio Santos', phone: '11987650003' },
    { key: 'carla', name: 'Carla Mendes', phone: '11987650004' },
    { key: 'rosa', name: 'Rosa Viana', phone: '11987650005' },
  ],
  professionals: [{ key: 'tatiana', name: 'Tatiana Rocha' }, { key: 'ricardo', name: 'Ricardo Alves' }],
  services: [
    { key: 'corte', name: 'Corte Completo', durationMin: 60, priceCents: 8000, professionalKeys: ['tatiana', 'ricardo'] },
    { key: 'escova', name: 'Escova', durationMin: 45, priceCents: 6000, professionalKeys: ['tatiana'] },
    { key: 'barba', name: 'Barba', durationMin: 30, priceCents: 4000, professionalKeys: ['ricardo'] },
    { key: 'coloracao', name: 'Coloração', durationMin: 120, priceCents: 20000, professionalKeys: ['tatiana'] },
  ],
  products: [],
  openWeekdays: [1, 2, 3, 4, 5, 6], openMinutes: 9 * 60, closeMinutes: 19 * 60, closures: [],
};
/** Relative day 1 = tomorrow in the salon timezone. Real clock: the DB and JS agree. */
export function scenarioFixture(s: AgendaScenario): FreeUseFixture {
  const today = dateKeyInTimeZone(new Date(), TZ);
  const appointments = (s.appointments ?? []).map(a => {
    const date = addCalendarDays(today, a.day); // America/Sao_Paulo has no DST since 2019.
    return { key: a.key, customerKey: a.customer, professionalKey: a.professional, serviceKey: a.service,
      startAt: new Date(`${date}T${a.time}:00-03:00`).toISOString(), status: 'CONFIRMED' as const };
  });
  return { ...base, customers: [...base.customers, ...(s.customers ?? [])], appointments } as unknown as FreeUseFixture;
}

type Reservation = { stage: string; id: string; run: string; scenario: string; step: number; bodyBytes: number; maxOutputTokens: number; reservedMicroUsd: number; previousHash: string; rowHash: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function readStage(file: string): Reservation[] {
  if (!existsSync(file)) return [];
  let prior = 'GENESIS', total = 0; const rows: Reservation[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as Reservation; const { rowHash, ...body } = row;
    if (row.stage !== AGENDA_STAGE || row.previousHash !== prior || rowHash !== digest(JSON.stringify(body))) throw Error('AGENDA_STAGE_JOURNAL');
    total += row.reservedMicroUsd; if (total > AGENDA_STAGE_CAP_MICRO_USD) throw Error('AGENDA_STAGE_JOURNAL');
    rows.push(row); prior = rowHash;
  }
  return rows;
}
export function stageTotals(file: string) { const rows = readStage(file); return { requests: rows.length, reservedUsd: rows.reduce((n, r) => n + r.reservedMicroUsd, 0) / 1e6 }; }
export function reserve(file: string, run: string, scenario: string, step: number, body: string): Reservation {
  const payload = JSON.parse(body); assertSecretaryResponsesPayload(payload, 'gpt-6-luna');
  const bodyBytes = Buffer.byteLength(body, 'utf8'), inputUpper = bodyBytes + PRICE.framing;
  if (inputUpper > PRICE.maxInput) throw Error('AGENDA_INPUT_CAP');
  const reservedMicroUsd = Math.ceil(inputUpper * PRICE.cacheWritePerM + payload.max_output_tokens * PRICE.outputPerM);
  const lock = file + '.lock', fd = openSync(lock, 'wx', 0o600);
  try {
    const rows = readStage(file), spent = rows.reduce((n, r) => n + r.reservedMicroUsd, 0);
    if (spent + reservedMicroUsd > AGENDA_STAGE_CAP_MICRO_USD) throw Error('AGENDA_STAGE_CAP');
    const body2 = { stage: AGENDA_STAGE, id: randomUUID(), run, scenario, step, bodyBytes, maxOutputTokens: payload.max_output_tokens, reservedMicroUsd, previousHash: rows.at(-1)?.rowHash ?? 'GENESIS' };
    const row = { ...body2, rowHash: digest(JSON.stringify(body2)) };
    const out = openSync(file, 'a', 0o600); try { writeSync(out, JSON.stringify(row) + '\n'); fsyncSync(out); } finally { closeSync(out); }
    return row;
  } finally { closeSync(fd); unlinkSync(lock); }
}

function summarize(view: SecretaryView | undefined) {
  if (!view) return undefined;
  const plan = view.action_plan;
  const ops = (view.operations ?? []).map(op => {
    const st = op.state, sch = st.scheduling, batch = st.batch;
    return { keys: op.action_keys, message: humanMessage(st.message ?? ''),
      scheduling: sch ? { operation: sch.operation, fields: sch.draft?.fields ?? sch.fields, missing: sch.draft?.missing_fields, waiting_for: sch.waiting_for,
        review: sch.draft?.review ? { status: sch.draft.review.status, message: sch.draft.review.message } : undefined,
        candidates: sch.candidates?.items.map(i => i.name), proposal: sch.proposal?.preview, receipt: sch.receipt,
        alternatives: sch.alternatives?.map(a => a.startLocal), appointments: sch.appointments?.map(a => `${a.customer_name} ${a.start_local} ${a.professional_name} ${a.status}`) } : undefined,
      batch: batch ? { items: (batch.draft?.plan ?? batch.plan)?.items.map(i => ({ key: i.key, operation: i.operation, fields: i.fields, depends_on: i.depends_on })), missing: batch.draft?.missing_fields,
        review: batch.draft?.review, proposal: batch.proposal?.preview, receipt: batch.receipt, candidates: batch.draft?.candidates } : undefined,
      other: !sch && !batch ? { skill: st.skill, capability: st.capability_status } : undefined };
  });
  return { message: humanMessage(view.message ?? ''), capability_status: view.capability_status,
    plan: plan ? { status: plan.status, revision: plan.revision, actions: plan.actions.map(a => ({ key: a.key, operation: a.operation, status: a.status, missing: a.missing_fields, depends_on: a.depends_on, preview: a.assessment?.preview, issue: a.assessment?.issue, fields: a.fields })),
      groups: plan.confirmation_groups.map(g => ({ key: g.key, status: g.status, keys: g.action_keys })) } : undefined, operations: ops };
}

async function tenantState(admin: PrismaClient, tenant: string) {
  const [appointments, timeOff] = await Promise.all([
    admin.appointment.findMany({ where: { salonId: tenant }, include: { client: { select: { name: true } }, professional: { include: { user: { select: { name: true } } } }, serviceItems: { select: { serviceName: true }, orderBy: { position: 'asc' } } }, orderBy: { startAt: 'asc' } }),
    admin.timeOff.findMany({ where: { professional: { salonId: tenant } }, include: { professional: { include: { user: { select: { name: true } } } } }, orderBy: { startAt: 'asc' } }),
  ]);
  const local = (d: Date) => d.toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16);
  return {
    appointments: appointments.map(a => `${a.client?.name ?? '?'} | ${a.serviceItems.map(s => s.serviceName).join('+')} | ${local(a.startAt)}→${local(a.endAt).slice(11)} | ${a.professional.user.name} | ${a.status}`),
    blocks: timeOff.map(t => `${t.professional?.user.name ?? 'salão'} | ${local(t.startAt)}→${local(t.endAt)} | ${t.reason ?? ''}`),
  };
}

export async function runAgendaPractice(scenarios: AgendaScenario[], out: string, opts: { maxRequests: number }) {
  mkdirSync(out, { recursive: true });
  const stageFile = join(process.cwd(), 'packages/salon-secretary/evaluation/results/agenda-core/stage-budget.jsonl');
  mkdirSync(join(process.cwd(), 'packages/salon-secretary/evaluation/results/agenda-core'), { recursive: true });
  const run = new Date().toISOString().replace(/[:.]/g, '-');
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const network = globalThis.fetch;
  let active: { scenario: string; step: number } | null = null, requests = 0;
  const usage: { scenario: string; step: number; input: number; cached: number; output: number; latencyMs: number; arguments?: string }[] = [];
  globalThis.fetch = async (input, init) => {
    if (!active) throw Error('AGENDA_UNEXPECTED_NETWORK');
    if (typeof input !== 'string' || input !== 'https://api.openai.com/v1/responses' || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') throw Error('AGENDA_WIRE_REQUEST');
    if (++requests > opts.maxRequests) throw Error('AGENDA_MAX_REQUESTS');
    reserve(stageFile, run, active.scenario, active.step, init.body);
    const started = performance.now(), response = await network(input, init), ctx = active;
    try {
      const json = await response.clone().json() as { output?: { type?: string; arguments?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } };
      usage.push({ scenario: ctx.scenario, step: ctx.step, input: json.usage?.input_tokens ?? 0, cached: json.usage?.input_tokens_details?.cached_tokens ?? 0, output: json.usage?.output_tokens ?? 0, latencyMs: Math.round(performance.now() - started), arguments: json.output?.find(o => o.type === 'function_call')?.arguments });
    } catch { /* usage unknown stays absent; reservation remains the bound */ }
    return response;
  };
  const results: unknown[] = [];
  try {
    await assertFreeUseDatabase(admin, prisma);
    for (const s of scenarios) {
      const fixture = scenarioFixture(s);
      const identity = await seedFreeUseFixture(admin, `agenda-practice-${run}`, s.id, fixture, TZ);
      const actor = { salonId: identity.tenant, userId: identity.actor };
      const secretary = new SalonSecretary(async (): Promise<Model> => createPaidModel(process.env), () => 'gpt-6-luna', undefined, { enabled: () => false }, { enabled: () => true });
      const session = await secretary.start(actor, 'auto');
      const transcript: unknown[] = []; let view: SecretaryView | undefined = session; let index = 0;
      const usedAnswers = new Set<string>();
      const pendingFields = (v?: SecretaryView) => [...new Set((v?.action_plan?.actions ?? []).filter(a => a.status !== 'DONE').flatMap(a => a.missing_fields).map(f => f.includes('.') ? f.slice(f.indexOf('.') + 1) : f).filter(f => f !== 'selection'))];
      const initial = await tenantState(admin, identity.tenant);
      const queue: (Step | { answer: string; field: string })[] = [...s.steps];
      while (queue.length) {
        const step = queue.shift()!;
        index++;
        if ('note' in step) { transcript.push({ step: index, note: step.note }); continue; }
        const before = usage.length, started = performance.now(); let error: string | undefined;
        try {
          if ('say' in step || 'answer' in step) {
            active = { scenario: s.id, step: index }; process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'true';
            try { view = await secretary.send(actor, { sessionId: session.sessionId, message: 'say' in step ? step.say : step.answer }); }
            finally { active = null; process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false'; }
            // Answer only what was actually asked, once per field, before the next scripted step.
            const field = pendingFields(view).find(f => s.answers?.[f] !== undefined && !usedAnswers.has(f));
            if (field && !error) { usedAnswers.add(field); queue.unshift({ answer: s.answers![field], field }); }
          } else if ('confirm' in step) {
            const plan = view?.action_plan;
            const group = plan?.confirmation_groups.find(g => g.status === 'READY_FOR_CONFIRMATION');
            if (plan && group) view = await secretary.confirmActionPlanGroup(actor, session.sessionId, { plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint });
            else if (plan) throw Error('NOTHING_TO_CONFIRM');
            else {
              const op = view?.operations?.find(o => o.state.scheduling?.proposal || o.state.batch?.proposal);
              const proposal = op?.state.scheduling?.proposal ?? op?.state.batch?.proposal;
              if (!op || !proposal) throw Error('NOTHING_TO_CONFIRM');
              view = await secretary.confirmAutomatic(actor, session.sessionId, op.operation_ref, { proposal_ref: proposal.proposal_ref, draft_revision: proposal.draft_revision });
            }
          } else if ('select' in step) {
            const match = (view?.operations ?? []).flatMap(o => {
              const items = o.state.scheduling?.candidates?.items ?? (o.state.batch?.draft?.candidates as { items?: { id: string; name: string }[] } | undefined)?.items ?? [];
              return items.filter(i => i.name.toLowerCase().includes(step.select.toLowerCase())).map(i => ({ op: o.operation_ref, id: i.id }));
            });
            if (match.length !== 1) throw Error('SELECT_' + match.length);
            view = await secretary.selectAutomatic(actor, session.sessionId, match[0].op, match[0].id);
          }
        } catch (e) { error = e instanceof Error ? e.message.slice(0, 160) : 'ERROR'; }
        const calls = usage.slice(before);
        transcript.push({ step: index, action: 'say' in step ? 'say' : 'answer' in step ? 'answer:' + step.field : 'confirm' in step ? 'confirm' : 'select', input: 'say' in step ? step.say : 'answer' in step ? step.answer : 'select' in step ? step.select : undefined, pending: pendingFields(view),
          error, latencyMs: Math.round(performance.now() - started), calls: calls.length, luna: calls.map(c => c.arguments), tokens: calls.reduce((n, c) => ({ input: n.input + c.input, cached: n.cached + c.cached, output: n.output + c.output }), { input: 0, cached: 0, output: 0 }),
          view: summarize(view), db: await tenantState(admin, identity.tenant) });
        writeFileSync(join(out, `${s.id}.json`), JSON.stringify({ scenario: s, tenant: identity.tenant, initial, transcript }, null, 2));
      }
      results.push({ id: s.id, title: s.title, steps: transcript.length });
      appendFileSync(join(out, 'index.jsonl'), JSON.stringify({ id: s.id, file: `${s.id}.json` }) + '\n');
    }
  } finally {
    globalThis.fetch = network; process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false';
    await admin.$disconnect(); await prisma.$disconnect();
  }
  const cost = usage.reduce((n, u) => n + ((u.input - u.cached) * PRICE.inputPerM + u.cached * PRICE.inputPerM * 0.1 + u.output * PRICE.outputPerM) / 1e6, 0);
  const report = { run, scenarios: results.length, requests, usage: { input: usage.reduce((n, u) => n + u.input, 0), cached: usage.reduce((n, u) => n + u.cached, 0), output: usage.reduce((n, u) => n + u.output, 0) },
    estimatedActualUsd: Number(cost.toFixed(6)), stage: stageTotals(stageFile), stageCapUsd: AGENDA_STAGE_CAP_MICRO_USD / 1e6 };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}
