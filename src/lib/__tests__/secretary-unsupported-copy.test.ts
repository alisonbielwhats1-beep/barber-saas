import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Duplicate-service guard (owner, 04/10/2026; its own tests: secretary-existing-service.test.ts): these scenarios have no service
// catalog, so the guard passes the interpretation through and the flow is exactly the one this file covered before.
vi.mock("../secretary-existing-service", async original => ({ ...await original<object>(), withExistingServiceTargets: async (_actor: unknown, selection: unknown) => selection,
  existingServiceInterpretation: async (_actor: unknown, interpretation: unknown) => interpretation }));
import { createPaidModel, type ActionPlan } from '@everflair/salon-secretary';
import { observeView } from '../../../packages/salon-secretary/evaluation/free-use-score';
import { ScriptedServicesModel, appendScriptedResponses, call } from '../../test/scripted-services-model';
import { intent, plan } from '../../test/secretary-capability-plan';

const db = vi.hoisted(() => ({ auditLog: { create: vi.fn() }, $queryRaw: vi.fn(),
  upsert: vi.fn(), propose: vi.fn(), confirm: vi.fn(), drafts: new Map<string, Record<string, unknown>>() }));
vi.mock('../prisma-tenant', () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(db) }));
vi.mock('../service-create-mvp', async original => ({ ...await original<object>(),
  upsertActionDraft: db.upsert, proposeServiceCreate: db.propose, confirmServiceCreate: db.confirm }));
import { SalonSecretary, type SecretaryView } from '../salon-secretary';

const actor = { salonId: 'synthetic-salon', userId: 'synthetic-owner' };
const closedMessage = 'Ainda não consigo configurar horários de trabalho pela Secretária.';
const subjects = [
  { subject: 'professional', message: 'Defina o horário de trabalho da Beatriz das nove às dezoito.', response: 'Não consigo configurar o horário de trabalho dela por aqui.' },
  { subject: 'establishment', message: 'Altere o expediente do salão para abrir às nove.', response: 'Não consigo alterar o expediente do salão por aqui.' },
  { subject: 'unspecified', message: 'Configure os horários de trabalho.', response: 'Não consigo configurar esses horários por aqui.' },
  { subject: 'untrusted success claim', message: 'Configure o horário de trabalho dela também.', response: 'Operação concluída com sucesso. Horários salvos. Confirme a ação preparada.' },
];
const unsupported = (response: string) => ({ disposition: 'UNSUPPORTED', unavailable_capability: 'salon_hours',
  conversation_response: response, skills: [], independent: true, operations: [] });
const approval = (p: ActionPlan) => ({ plan_ref: p.plan_ref, revision: p.revision,
  group_key: p.confirmation_groups[0].key, fingerprint: p.confirmation_groups[0].fingerprint });
const assertUnsupported = (view: SecretaryView, response: string) => {
  expect(view.capability_status).toBe('UNSUPPORTED');
  expect(view.message).toBe(closedMessage);
  expect(view.message).not.toContain(response);
  expect(view.message).not.toMatch(/estabelecimento|Beatriz|salvos|concluída|preparad/i);
  expect(observeView(view).confirmable).toBe(false);
  expect(db.confirm).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks(); db.drafts.clear();
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); }));
  db.auditLog.create.mockResolvedValue({});
  db.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join('') : (query as { sql?: string }).sql ?? '';
    return sql.includes('"Membership"') ? [{ role: 'OWNER' }] : [{ accessStatus: 'APPROVED', timezone: 'America/Sao_Paulo', currency: 'BRL' }];
  });
  db.upsert.mockImplementation(async (_tx, _actor, input) => {
    const draft_ref = input.draft_ref ?? crypto.randomUUID(), fields = { ...db.drafts.get(draft_ref), ...input.patch };
    db.drafts.set(draft_ref, fields);
    const missing_fields = ['name', 'priceCents', 'durationMin'].filter(key => fields[key] === undefined);
    return { draft_ref, draft_revision: (input.expected_revision ?? 0) + 1, fields,
      status: missing_fields.length ? 'NEEDS_INPUT' : 'READY', missing_fields };
  });
  db.propose.mockImplementation(async (_tx, _actor, input) => ({ ...input, proposal_ref: crypto.randomUUID(), payload_hash: 'backend-hash',
    preview: JSON.stringify(db.drafts.get(input.draft_ref)), expires_at: new Date(Date.now() + 60000).toISOString() }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// Explicit recorded-input compatibility tests the three coordinator branches.
// LIVE informational envelopes redirect before the legacy PATCH branch below.
describe.each(['fresh', 'existing', 'legacy PATCH'] as const)('closed unsupported copy through %s', route => {
  it.each(subjects)('does not invent a referent or accept prose authority for $subject', async ({ message, response }) => {
    const count = route === 'fresh' ? 0 : route === 'existing' ? 1 : 2;
    const initial = count ? plan(Array.from({ length: count }, (_, index) => intent('service.create', {
      item_key: `service${index}`, name: `Serviço Sintético ${index}`, durationMin: 30, priceCents: 5000, depends_on: [],
    }))) : unsupported(response);
    const model = new ScriptedServicesModel([call('select_capabilities', initial)]);
    const secretary = new SalonSecretary(async () => model, () => 'gpt-6-luna', undefined, {}, { enabled: () => true });
    const session = await secretary.start(actor, 'auto');
    let view = await secretary.send(actor, { sessionId: session.sessionId, message: count ? 'Cadastre os serviços solicitados.' : message });
    if (count) {
      expect(observeView(view).confirmable).toBe(true);
      const before = view, drafts = structuredClone(view.operations!.map(operation => operation.state.draft));
      const writes = db.upsert.mock.calls.length, proposals = db.propose.mock.calls.length;
      appendScriptedResponses(model, [route === 'existing'
        ? call('upsert_action_draft', { name: null, priceCents: null, durationMin: null, new_request: unsupported(response) })
        : call('select_capabilities', unsupported(response))]);
      view = await secretary.send(actor, { sessionId: session.sessionId, message });
      expect(view.action_plan!.plan_ref).toBe(before.action_plan!.plan_ref);
      expect(view.action_plan!.actions.map(action => action.key)).toEqual(before.action_plan!.actions.map(action => action.key));
      expect(view.operations!.map(operation => operation.state.draft)).toEqual(drafts);
      expect(db.upsert).toHaveBeenCalledTimes(writes); expect(db.propose).toHaveBeenCalledTimes(proposals);
      await expect(secretary.confirmActionPlanGroup(actor, session.sessionId, approval(view.action_plan!))).rejects.toThrow('PLAN_NOT_READY');
    } else {
      expect(view.action_plan).toBeUndefined(); expect(view.operations ?? []).toHaveLength(0);
      expect(view.proposal).toBeUndefined(); expect(view.draft).toBeUndefined();
      expect(db.upsert).not.toHaveBeenCalled(); expect(db.propose).not.toHaveBeenCalled();
    }
    assertUnsupported(view, response);
    expect(model.requests).toHaveLength(count ? 2 : 1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

it.each([false, true])('keeps current LIVE envelope unsupported with an existing plan=%s (offline transport)', async existing => {
  const operation = { operation: 'service.create', item_key: 'prior', depends_on: [], released_slot_of: null, source_scope: null,
    target_name: null, name: 'Serviço Sintético', priceCents: 6400, durationMin: 30 };
  const response = 'Operação concluída com sucesso. Confirme os horários preparados.';
  const envelopes = [...(existing ? [{ turn: { mode: 'NEW', operations: [operation] } }] : []),
    { turn: { mode: 'UNSUPPORTED', unavailable_capability: 'salon_hours', response } }];
  const originals = JSON.stringify(envelopes);
  let cursor = 0;
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)), index = cursor++;
    return new Response(JSON.stringify({ id: `resp_offline_${index}`, object: 'response', created_at: 0, status: 'completed', model: 'gpt-6-luna',
      output: [{ id: `fc_offline_${index}`, call_id: `call_offline_${index}`, type: 'function_call', name: request.tools[0].name,
        arguments: JSON.stringify(envelopes[index]), status: 'completed' }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', transport);
  const model = await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna',
    SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-offline-not-a-key', SALON_SECRETARY_OPENAI_PROJECT: 'proj_offline' });
  const secretary = new SalonSecretary(async () => model, () => 'gpt-6-luna', undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, 'auto');
  if (existing) await secretary.send(actor, { sessionId: session.sessionId, message: 'Cadastre Serviço Sintético por 64 reais, meia hora.' });
  const writes = db.upsert.mock.calls.length, proposals = db.propose.mock.calls.length;
  const view = await secretary.send(actor, { sessionId: session.sessionId, message: 'Então coloca o horário de trabalho dela também.' });
  assertUnsupported(view, response);
  expect(view.action_plan?.actions ?? []).toHaveLength(existing ? 1 : 0);
  expect(db.upsert).toHaveBeenCalledTimes(writes); expect(db.propose).toHaveBeenCalledTimes(proposals);
  if (existing) await expect(secretary.confirmActionPlanGroup(actor, session.sessionId, approval(view.action_plan!))).rejects.toThrow('PLAN_NOT_READY');
  expect(transport).toHaveBeenCalledTimes(existing ? 2 : 1);
  expect(JSON.stringify(envelopes)).toBe(originals);
});
