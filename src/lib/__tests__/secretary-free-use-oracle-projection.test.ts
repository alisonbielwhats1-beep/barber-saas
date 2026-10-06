import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { publishedOperation } from '@everflair/salon-secretary';
import { goldenSuite } from '../../../packages/salon-secretary/evaluation/free-use-golden';
import { parseFreeUseSuite, preflightFreeUseSuite, suiteSchema } from '../../../packages/salon-secretary/evaluation/free-use-contract';
import { oracleProjectionCatalog, validateOracleProjection, type OracleSurface } from '../../../packages/salon-secretary/evaluation/free-use-oracle-projection';
import { observeView, scoreTurn } from '../../../packages/salon-secretary/evaluation/free-use-score';
import { collectedActionFields } from '../secretary-action-plan';

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function suite(action: Record<string, unknown>) {
  return { schemaVersion: 1, suiteId: 'projection-preflight', timezone: 'America/Sao_Paulo', clock: '2027-04-12T12:00:00Z',
    fixture: { customers: [], professionals: [], services: [], products: [], appointments: [], openWeekdays: [], openMinutes: 480, closeMinutes: 1080 },
    cases: [{ id: 'Synthetic1', family: 'oracle projection', criterion: 'Evaluate a structurally possible path without choosing its value.',
      turns: [{ message: 'Mensagem sintética imutável.', expect: { actionCount: 1, actions: [action] } }] }] };
}
function serviceView(reference = 'service-right', priceCents = 6300) {
  return { sessionId: 'session', message: 'Confira antes de confirmar.', capability_status: 'SUPPORTED',
    action_plan: { plan_ref: 'plan', revision: 1, actions: [{ key: 'a', operation: 'service.change', mutation: true, status: 'READY_FOR_CONFIRMATION',
      fields: { target_name: 'Escova Sintética', priceCents }, missing_fields: [], assessment: { proposal_token: 'proposal' } }],
    confirmation_groups: [{ status: 'READY_FOR_CONFIRMATION' }] },
    operations: [{ operation_ref: 'child', action_keys: ['a'], state: {
      draft: { draft_ref: 'draft', fields: { name: 'Escova Sintética', durationMin: 45, priceCents }, change: { service_ref: reference } },
      proposal: { proposal_ref: 'proposal', fields: { name: 'Escova Sintética', durationMin: 45, priceCents }, change: { service_ref: reference } },
    } }] };
}

describe('closed operation and observed-surface oracle admission', () => {
  it('covers the complete published operation catalog with immutable finite paths', () => {
    expect(Object.keys(oracleProjectionCatalog).sort()).toEqual([...publishedOperation.options].sort());
    expect(Object.isFrozen(oracleProjectionCatalog)).toBe(true);
    for (const surfaces of Object.values(oracleProjectionCatalog)) for (const paths of Object.values(surfaces)) {
      expect(Object.isFrozen(paths)).toBe(true); expect(new Set(paths).size).toBe(paths.length);
      expect(paths.every(path => !path.includes('*') && !/\.\d+(?:\.|$)/.test(path))).toBe(true);
    }
  });
  it.each([
    ['service.change', 'effective', 'service_ref'], ['service.create', 'effective', 'customer_ref'],
    ['customer.change', 'effective', 'customer_ref'], ['customer.change', 'proposalFields', 'change.service_ref'],
    ['stock.movement', 'effective', 'stock'], ['stock.movement', 'proposalFields', 'product_ref'],
    ['appointment.create', 'effective', 'startLocal'], ['appointment.create', 'proposalFields', 'customer_ref'],
    ['appointment.change', 'proposalFields', 'snapshot.appointment_ref'], ['customer.message', 'effective', 'recipient.customer_ref'],
    ['financial.report', 'resultContains', 'metrics.value'], ['customer.read', 'resultContains', 'customer_ref'],
    ['service.change', 'proposalFields', 'change.serviceId'], ['service.change', 'effective', '__proto__.priceCents'],
    ['appointment.read', 'resultContains', 'services.0.id'], ['service.change', 'effective', ''],
  ] as const)('blocks %s / %s / %s before execution instead of converting its expected value', (operation, surface, path) => {
    const input = suite({ operation, [surface]: { [path]: '$ref:synthetic:value' } }), original = JSON.stringify(input);
    const result = preflightFreeUseSuite(input);
    expect(result).toMatchObject({ status: 'BLOCKED', reason: 'FREE_USE_ORACLE_PROJECTION_INVALID' });
    if (result.status === 'BLOCKED') expect(result.issues).toContainEqual(expect.objectContaining({
      projection: expect.objectContaining({ operation, surface, path }),
      location: ['cases', 0, 'turns', 0, 'expect', 'actions', 0, surface, path],
    }));
    expect(() => parseFreeUseSuite(input)).toThrow('FREE_USE_ORACLE_PROJECTION_INVALID');
    expect(suiteSchema.safeParse(input).success).toBe(false); expect(JSON.stringify(input)).toBe(original);
  });
  it.each(['preserve', 'forbiddenEffective', 'sourceBackedEffective', 'allowMissing'])('validates the %s path surface without allowing a vacuous assertion', list => {
    expect(preflightFreeUseSuite(suite({ operation: 'service.change', [list]: ['service_ref'] }))).toMatchObject({ status: 'BLOCKED', reason: 'FREE_USE_ORACLE_PROJECTION_INVALID' });
  });
  it.each([
    ['service.change', 'effective', 'priceCents'], ['service.change', 'proposalFields', 'change.service_ref'],
    ['customer.change', 'proposalFields', 'change.customer_ref'], ['stock.movement', 'effective', 'product_ref'],
    ['stock.movement', 'proposalFields', 'product.id'], ['appointment.create', 'proposalFields', 'snapshot.customer_ref'],
    ['appointment.change', 'proposalFields', 'action_snapshot.appointment_ref'], ['customer.message', 'proposalFields', 'recipient.customer_ref'],
    ['appointment.create', 'proposalFields', 'snapshot.create.customer_ref'], ['appointment.cancel', 'proposalFields', 'snapshot.cancel.appointment_ref'],
    ['financial.report', 'fields', 'financial.metrics'], ['financial.report', 'resultContains', 'value'],
  ] as const)('accepts structurally possible optional %s / %s / %s without fabricating presence or value', (operation, surface, path) => {
    const input = suite({ operation, [surface]: { [path]: null } }), result = parseFreeUseSuite(input);
    expect(result.cases[0].turns[0].expect.actions[0][surface as OracleSurface]).toEqual({ [path]: null });
  });
  it('keeps missing exemptions attached to an actual valid check and preserves schema normalization', () => {
    const result = parseFreeUseSuite(suite({ operation: 'appointment.change', effective: { time: '16:00' }, allowMissing: ['time'] }));
    expect(result.fixture.closures).toEqual([]); expect(result.cases[0].turns[0].expect.actions[0].index).toBe(0);
    expect(result.cases[0].turns[0].expect.actions[0].allowMissing).toEqual(['time']);
    expect(preflightFreeUseSuite(suite({ operation: 'appointment.change', allowMissing: ['time'] })).status).toBe('BLOCKED');
  });
  it('unknown operations and ordinary malformed suites stay blocked', () => {
    expect(preflightFreeUseSuite(suite({ operation: 'service.erase' }))).toMatchObject({ status: 'BLOCKED', reason: 'FREE_USE_ORACLE_PROJECTION_INVALID' });
    expect(preflightFreeUseSuite({})).toMatchObject({ status: 'BLOCKED', reason: 'FREE_USE_SUITE_INVALID' });
  });
  it('does not mutate or relax the frozen Golden 30 or the scoring implementation', () => {
    const paths = ['docs/SECRETARY_GOLDEN_FREE_USE_30.md', 'packages/salon-secretary/evaluation/free-use-golden.ts', 'packages/salon-secretary/evaluation/free-use-score.ts'];
    const before = paths.map(sha), input = goldenSuite(), original = JSON.stringify(input);
    expect(parseFreeUseSuite(input)).toEqual(input); expect(input.cases).toHaveLength(30);
    expect(JSON.stringify(input)).toBe(original); expect(paths.map(sha)).toEqual(before);
  });
  it('matches the actual service-change projection rather than falling back to draft/raw identity', () => {
    const raw = serviceView(), observation = observeView(raw);
    expect(observation.actions[0].effective).toEqual({ name: 'Escova Sintética', durationMin: 45, priceCents: 6300 });
    expect(observation.actions[0].effective).not.toHaveProperty('service_ref');
    expect(raw.operations[0].state.draft.change.service_ref).toBe('service-right');
    const valid = parseFreeUseSuite(suite({ operation: 'service.change', effective: { priceCents: 6300 }, proposalFields: { 'change.service_ref': '$ref:service:right' } }));
    expect(scoreTurn(valid.cases[0].turns[0].expect, observation, { 'service:right': 'service-right' }).pass).toBe(true);
  });
  it.each(['identity', 'price'] as const)('a wrong %s on a valid path remains a safety failure in the unchanged scorer', kind => {
    const input = parseFreeUseSuite(suite({ operation: 'service.change', effective: { priceCents: 6300 }, proposalFields: { 'change.service_ref': '$ref:service:right' } }));
    const observed = observeView(kind === 'identity' ? serviceView('wrong-service') : serviceView('service-right', 630));
    const score = scoreTurn(input.cases[0].turns[0].expect, observed, { 'service:right': 'service-right' });
    expect(score.pass).toBe(false); expect(score.metrics.safetyFailures).toBeGreaterThan(0);
    expect(score.safety).toContain(kind === 'identity' ? 'PROPOSAL:service.change:change.service_ref' : 'EFFECTIVE:service.change:priceCents');
  });
  it('pure preflight performs no provider or database access', () => {
    const fetch = vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); }); vi.stubGlobal('fetch', fetch);
    try {
      expect(validateOracleProjection({ operation: 'service.change', effective: { service_ref: 'ref' } })).toHaveLength(1);
      expect(preflightFreeUseSuite(suite({ operation: 'service.change', effective: { service_ref: 'ref' } })).status).toBe('BLOCKED');
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('accepted ActionPlan fields exclude the wire evidence actually removed by collectedActionFields', () => {
    const fields = collectedActionFields({ sessionId: 'child', message: 'Revisar', inventory: {
      fields: { mode: 'IN', quantity: 5 }, query: 'Produto Sintético', low_stock: false,
    } } as unknown as Parameters<typeof collectedActionFields>[0], { key: 'stock', operation: 'stock.movement', fields: {
      source_scope: 'Entraram cinco unidades de Produto Sintético.', inventory: { product_name: 'Produto Sintético', quantity: 5,
        quantity_evidence: 'cinco unidades', reference: { kind: 'NAMED', literal: 'Produto Sintético' } }, requested_fields: [], clear_fields: [],
    } } as unknown as Parameters<typeof collectedActionFields>[1]);
    expect(fields).not.toHaveProperty('source_scope'); expect(fields.inventory).toEqual({ mode: 'IN', quantity: 5, product_name: 'Produto Sintético', low_stock: false });
    for (const path of ['source_scope', 'inventory.quantity_evidence', 'inventory.reference.kind', 'inventory.reference.literal']) {
      expect(preflightFreeUseSuite(suite({ operation: 'stock.movement', fields: { [path]: 'wire-only' } })).status).toBe('BLOCKED');
    }
    for (const operation of publishedOperation.options) expect(validateOracleProjection({ operation, fields: { source_scope: 'wire-only' } })).toHaveLength(1);
  });
});

describe('union of real child, batch and shared-proposal projections', () => {
  function verify(operation: string, state: Record<string, unknown>, checks: Record<string, unknown>, mutation = true) {
    const input = parseFreeUseSuite(suite({ operation, ...checks }));
    const observed = observeView({ sessionId: 'session', message: 'Resultado revisável.', capability_status: 'SUPPORTED', action_plan: {
      plan_ref: 'plan', revision: 1, actions: [{ key: 'a', operation, fields: {}, mutation, status: mutation ? 'READY_FOR_CONFIRMATION' : 'DONE',
        missing_fields: [], assessment: mutation ? { proposal_token: 'token' } : {} }], confirmation_groups: mutation ? [{ status: 'READY_FOR_CONFIRMATION' }] : [],
    }, operations: [{ operation_ref: 'child', action_keys: ['a'], state }] });
    expect(scoreTurn(input.cases[0].turns[0].expect, observed, {}).pass).toBe(true);
    return observed;
  }
  it.each(['customer.search', 'customer.read'])('%s publishes a resolved customer DTO as a result', operation => {
    const customer = { id: 'customer', name: 'Cliente Sintético', phone: null, email: 'sintetico@example.invalid' };
    const observed = verify(operation, { customer: { operation, patch: {}, requested: [], target: customer.id, customer, message: 'Resultado' } },
      { resultContains: customer }, false);
    expect(observed.actions[0].result).toEqual(customer);
  });
  it('whole empty object arrays are comparable without admitting index traversal', () => {
    const fields = { appointment_ref: 'appointment', reason: 'Solicitação do cliente' };
    verify('appointment.cancel', { scheduling: { fields, draft: { fields }, proposal: { proposal_ref: 'token', fields,
      action_snapshot: { affected: [], services: [] }, review: { conflicts: [], alternatives: [] } } } }, {
      proposalFields: { 'action_snapshot.affected': [], 'action_snapshot.services': [], 'review.conflicts': [], 'review.alternatives': [] },
    });
    expect(preflightFreeUseSuite(suite({ operation: 'appointment.cancel', proposalFields: { 'action_snapshot.affected.0.id': 'appointment' } })).status).toBe('BLOCKED');
  });
  it('a cancellation can expose the communication parent proposal without changing its effective action', () => {
    const fields = { appointment_ref: 'appointment', reason: 'Solicitação do cliente' };
    const message = { channel: 'WHATSAPP', message_mode: 'EXACT', content: 'Texto literal revisado' };
    const proposal = { proposal_ref: 'token', operation: 'customer.message', fields: message, recipient: { customer_ref: 'customer' },
      dependency: { snapshot: { appointment_ref: 'appointment' }, fields } };
    const observed = verify('appointment.cancel', { communication: { fields: message, proposal,
      cancel: { operation: 'appointment.cancel', fields, draft: { fields }, proposal_deferred: true } } }, {
      effective: { appointment_ref: 'appointment' }, proposalFields: { 'recipient.customer_ref': 'customer', 'fields.content': message.content,
        'fields.channel': 'WHATSAPP', 'fields.message_mode': 'EXACT', 'dependency.snapshot.appointment_ref': 'appointment' },
    });
    expect(observed.actions[0].proposal).toEqual(proposal); expect(observed.actions[0].effective).not.toHaveProperty('content');
  });
  it.each(['appointment.create', 'appointment.cancel'])('%s admits the shared batch policy and snapshots', operation => {
    const cancelKey = operation === 'appointment.cancel' ? 'a' : 'cancel', createKey = operation === 'appointment.create' ? 'a' : 'create';
    const plan = { execution_policy: 'all_or_nothing', items: [
      { key: cancelKey, operation: 'appointment.cancel', depends_on: [], fields: { appointment_ref: 'appointment', reason: 'Solicitação' } },
      { key: createKey, operation: 'appointment.create', depends_on: [cancelKey], released_slot_of: cancelKey, fields: { customer_ref: 'customer', date: '2027-04-12', time: '10:00' } },
    ] };
    verify(operation, { batch: { plan, draft: { plan, missing_fields: [] }, proposal: { proposal_ref: 'token', plan,
      snapshot: { cancel: { appointment_ref: 'appointment', affected: [] }, create: { customer_ref: 'customer' } } } } }, {
      proposalFields: { 'plan.execution_policy': 'all_or_nothing', 'snapshot.cancel.appointment_ref': 'appointment', 'snapshot.cancel.affected': [], 'snapshot.create.customer_ref': 'customer' },
    });
  });
});
