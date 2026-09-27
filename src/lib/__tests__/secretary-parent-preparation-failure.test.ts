/** Regression of parent readiness after preparation failure.
 * All I/O is mocked; these are synthetic LIVE-wire failure cases, not Luna evidence.
 * Historical P1 input/expected and before-fix artifacts are preserved independently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as api from '../../../packages/salon-secretary/src/index';
import { SalonSecretary } from '../salon-secretary';
import { schedulingState } from '../secretary-scheduling';
import { expandedWire } from '../../test/secretary-wire-schema';
import { intent } from '../../test/secretary-capability-plan';

const io = vi.hoisted(() => ({ audits: [] as any[], fault: '', executor: vi.fn(), access: vi.fn() }));
vi.mock('../prisma-tenant', () => ({ withTenant: vi.fn(async (_actor, run) => run({ auditLog: { create: async ({ data }: any) => {
  if (data.metadata?.attempt === 2 && (io.fault === 'audit-start2' && data.metadata.status === 'STARTED' || io.fault === 'audit-terminal2' && data.metadata.status === 'SUCCEEDED')) throw Error('INDEPENDENT_AUDIT_FAILURE');
  io.audits.push(structuredClone(data)); return data;
} } })) }));
vi.mock('../customer-catalog', async original => ({ ...await original<any>(), assertCustomerAccess: io.access }));
vi.mock('../scheduling-actions', async original => ({ ...await original<any>(), confirmAppointmentCreate: io.executor }));

type Route = 'PATCH' | 'SELECTED_PATCH' | 'NEW' | 'ADD' | 'RESUME' | 'FRESH_NEW';
type Fault = 'literal' | 'value' | 'schema' | 'timeout' | 'audit-start2' | 'audit-terminal2' | 'first-schema';
type Schema = { properties?: Record<string, Schema>; anyOf?: Schema[]; enum?: unknown[]; type?: string; items?: Schema };
const actor = { salonId: 'independent-parent-salon', userId: 'independent-parent-owner' };
const forbiddenNetwork = vi.fn(async () => { throw Error('REAL_NETWORK_FORBIDDEN'); });
beforeEach(() => {
  io.audits.length = 0; io.fault = ''; io.access.mockReset().mockResolvedValue(undefined);
  io.executor.mockReset().mockImplementation(() => { throw Error('INDEPENDENT_EXECUTOR_MUST_NOT_BE_REACHED'); });
  forbiddenNetwork.mockClear(); vi.stubGlobal('fetch', forbiddenNetwork);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function fieldsObject(schema: Schema, operation: string): Schema {
  if (schema.properties) return schema;
  const selected = schema.anyOf?.find(branch => {
    const op = branch.properties?.operation;
    return op?.enum?.includes(operation) || op?.anyOf?.some(option => option.enum?.includes(operation));
  });
  if (!selected) throw Error('SYNTHETIC_OPERATION_BRANCH_MISSING');
  return selected;
}
function nullFields(schema: Schema) { return Object.fromEntries(Object.keys(schema.properties ?? {}).map(key => [key, null])); }
function liveEnvelope(request: any, route: Route, suspendedRef?: string) {
  // Build NEW synthetic frames from the current published schema, with neutral
  // fields explicit. This does not alter/adapt any captured historical output.
  const wire = expandedWire(request.tools[0].parameters) as Schema;
  const mode = route === 'SELECTED_PATCH' ? 'PATCH' : route === 'FRESH_NEW' ? 'NEW' : route;
  const branch = wire.properties?.turn.anyOf?.find(x => x.properties?.mode.enum?.includes(mode));
  if (!branch) throw Error('SYNTHETIC_ROUTE_BRANCH_MISSING:' + mode);
  let operationsSchema: Schema;
  if (mode === 'RESUME') {
    const patches = branch.properties!.patches;
    operationsSchema = (patches.properties ? patches : patches.anyOf!.find(x => x.properties)!).properties!.operations;
  } else operationsSchema = branch.properties!.operations;
  const patch = mode === 'PATCH' || mode === 'RESUME';
  const item = operationsSchema.items!;
  const keys = mode === 'RESUME' ? ['saved_a', 'saved_b'] : route === 'SELECTED_PATCH' ? ['a'] : mode === 'PATCH' ? ['a', 'b'] : ['new_visit'];
  const operations = keys.map(key => {
    const schema = fieldsObject(patch ? item.properties!.fields : item, 'appointment.change');
    const fields: any = nullFields(schema);
    fields.operation = 'appointment.change'; fields.time = { value: '16:00', literal: '4pm' };
    if (patch) return { item_key: key, fields };
    fields.item_key = key; fields.customer_name = 'Célia'; return fields;
  });
  return mode === 'RESUME' ? { turn: { mode, plan_ref: suspendedRef, patches: { operations } } } : { turn: { mode, operations } };
}
function leaves(frame: any) { return (frame.turn.patches?.operations ?? frame.turn.operations).map((op: any) => op.fields ?? op); }
function sourceFor(route: Route) {
  return ({ PATCH: 'Mude Lara e Bia para 16h.', SELECTED_PATCH: 'Mude Lara para 16h.', NEW: 'Agora quero remarcar Célia para 16h.', ADD: 'Inclua também uma remarcação de Célia para 16h.', RESUME: 'Retome o pedido anterior e mude os dois para 16h.', FRESH_NEW: 'Remarque Célia para 16h.' })[route];
}
function approval(plan: api.ActionPlan) {
  const group = plan.confirmation_groups.find(g => g.status !== 'DONE')!;
  return { plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint };
}
function seededPlan(parentId: string, prefix = '') {
  const children = ['a', 'b', 'done'].map((key, index) => {
    const fields = { customer_name: ['Lara', 'Bia', 'Dora'][index], appointment_ref: randomUUID(), date: '2027-04-14', time: '14:00', source_date: '2027-04-13', source_time: '13:00' };
    const state: any = { ...schedulingState(), operation: 'appointment.change', fields, message: key === 'done' ? 'Recibo concluído.' : 'Proposta pronta. Use Confirmar para executar.',
      draft: { draft_ref: randomUUID(), draft_revision: 7 + index, fields: structuredClone(fields), status: 'READY', missing_fields: [] } };
    if (key === 'done') state.receipt = { receipt_ref: randomUUID(), operation: 'appointment.change', outcome: 'COMPLETED', appointment_ref: fields.appointment_ref };
    else state.proposal = { proposal_ref: randomUUID(), draft_revision: 7 + index, payload_hash: key.repeat(64), expires_at: new Date(Date.now() + 300000).toISOString() };
    return { id: randomUUID(), actor, skill: 'scheduling', planOwner: parentId, key: prefix + key, expires: Date.now() + 300000, busy: false, turns: 1, cancelled: false, scheduling: state };
  });
  let plan = api.createActionPlan({ skills: ['scheduling'], independent: true, operations: children.map(c => intent('appointment.change', { item_key: c.key, depends_on: [], customer_name: c.scheduling.fields.customer_name, date: '2027-04-14', time: '14:00', source_date: '2027-04-13', source_time: '13:00' })) });
  for (const child of children) plan = api.assessPlanAction(plan, child.key, child.scheduling.receipt ? { status: 'DONE', missing_fields: [], preview: 'Recibo já persistido' } : {
    status: 'READY_FOR_CONFIRMATION', missing_fields: [], preview: 'Proposta anterior: quarta 14h', proposal_token: `${child.scheduling.proposal.proposal_ref}:${child.scheduling.draft.draft_revision}:${child.scheduling.proposal.payload_hash}`,
  });
  return { children, saved: { actionPlan: plan, actionUnits: children.map(c => ({ kind: 'single' as const, child: c.id, keys: [c.key] })), children: children.map(c => c.id), groupReceipts: new Set(['already-finished-historical-group']) } };
}
function preserved(children: any[]) { return children.map(c => ({ id: c.id, key: c.key, fields: structuredClone(c.scheduling.fields), draft: structuredClone(c.scheduling.draft), receipt: structuredClone(c.scheduling.receipt), cancelled: c.cancelled })); }

const cases: { route: Route; fault: Fault }[] = [
  ...(['literal', 'value', 'schema', 'timeout', 'audit-start2', 'audit-terminal2', 'first-schema'] as Fault[]).map(fault => ({ route: 'PATCH' as const, fault })),
  ...(['NEW', 'ADD', 'RESUME', 'FRESH_NEW'] as Route[]).flatMap(route => (['literal', 'schema', 'timeout'] as Fault[]).map(fault => ({ route, fault }))),
  ...(['literal', 'timeout'] as Fault[]).map(fault => ({ route: 'SELECTED_PATCH' as const, fault })),
];

describe('independent parent fail-closed lifecycle matrix; synthetic offline I/O only', () => {
  it.each(cases)('$route / $fault blocks OLD and NEW tokens without changing committed data or DONE', async ({ route, fault }) => {
    io.fault = fault;
    const parentId = randomUUID(), active = seededPlan(parentId), saved = seededPlan(parentId, 'saved_');
    const fresh = route === 'FRESH_NEW';
    let first: any, requestCount = 0;
    const source: api.Model = { async getResponse(request) {
      requestCount++;
      if (requestCount > 2) throw Error('UNEXPECTED_THIRD_MODEL_CALL');
      if (requestCount === 1) first = liveEnvelope(request, route, saved.saved.actionPlan.plan_ref);
      if (fault === 'timeout' && requestCount === 2) throw Object.assign(Error('SYNTHETIC_TIMEOUT'), { name: 'TimeoutError' });
      const frame = structuredClone(first);
      if (fault === 'first-schema' && requestCount === 1 || fault === 'schema' && requestCount === 2) leaves(frame)[0].time = '16:00';
      if (requestCount === 2 && ['value', 'audit-start2', 'audit-terminal2'].includes(fault)) {
        for (const field of leaves(frame)) field.time.literal = '16h';
        if (fault === 'value') leaves(frame)[0].time.value = '17:00';
      }
      return { usage: new api.Usage(), output: [{ type: 'function_call', callId: randomUUID(), name: (request.tools[0] as any).name, arguments: JSON.stringify(frame) }] };
    }, async *getStreamedResponse() { throw Error('STREAM_FORBIDDEN'); } };
    const secretary = new SalonSecretary(async () => source, () => 'gpt-6-luna', undefined, {}, { enabled: () => true });
    const parent: any = { id: parentId, actor, skill: 'auto', expires: Date.now() + 300000, busy: false, turns: 1, cancelled: false, multiActionV2: true,
      ...(fresh ? {} : active.saved), ...(route === 'RESUME' ? { suspendedPlans: [saved.saved] } : {}) };
    const sessions: Map<string, any> = (secretary as any).sessions; sessions.set(parentId, parent);
    if (!fresh) active.children.forEach(c => sessions.set(c.id, c));
    if (route === 'RESUME') saved.children.forEach(c => sessions.set(c.id, c));
    const before = preserved(active.children), savedBefore = preserved(saved.children), savedPlanBefore = structuredClone(saved.saved.actionPlan);
    const old = fresh ? null : approval(parent.actionPlan), groupReceiptsBefore = fresh ? null : [...parent.groupReceipts];
    let failure: unknown, returned: any;
    try { returned = await secretary.send(actor, { sessionId: parentId, message: sourceFor(route), ...(route === 'SELECTED_PATCH' ? { operation_ref: active.children[0].id } : {}) }); } catch (error) { failure = error; }
    // The selected adapter catches its error and returns FAILED_SAFE; the global
    // boundary propagates. Both must withdraw readiness before any confirmation.
    if (route === 'SELECTED_PATCH') {
      expect(returned.action_plan.actions.find((a: any) => a.key === 'a').status).toBe('FAILED_SAFE');
      expect(active.children[1].scheduling.proposal).toBeDefined();
    } else expect(failure).toBeDefined();
    expect(requestCount).toBe(['first-schema', 'audit-start2'].includes(fault) ? 1 : 2);
    expect(forbiddenNetwork).not.toHaveBeenCalled(); expect(parent.busy).toBe(false); expect(parent.cancelled).toBe(false);
    if (fresh) {
      expect(parent.actionPlan).toBeUndefined(); expect(parent.children ?? []).toEqual([]);
      await expect(secretary.confirmActionPlanGroup(actor, parentId, { plan_ref: randomUUID(), revision: 1, group_key: 'group_1', fingerprint: 'a'.repeat(64) })).rejects.toThrow();
    } else {
      expect(preserved(active.children)).toEqual(before);
      expect([...parent.groupReceipts]).toEqual(groupReceiptsBefore);
      expect(parent.actionPlan.actions.find((a: any) => a.key === 'done').status).toBe('DONE');
      await expect(secretary.confirmActionPlanGroup(actor, parentId, old)).rejects.toThrow('CONFIRMATION_STALE');
      const view: any = (secretary as any).view(parent);
      expect(view.action_plan.confirmation_groups.some((g: any) => g.status === 'READY_FOR_CONFIRMATION')).toBe(false);
      for (const child of active.children.filter(c => c.key !== 'done' && (route !== 'SELECTED_PATCH' || c.key === 'a'))) expect(child.scheduling.message).not.toContain('Use Confirmar');
      await expect(secretary.confirmActionPlanGroup(actor, parentId, approval(parent.actionPlan))).rejects.toThrow();
      expect(preserved(active.children)).toEqual(before);
    }
    if (route === 'RESUME') {
      expect(parent.actionPlan.plan_ref).toBe(active.saved.actionPlan.plan_ref);
      expect(preserved(saved.children)).toEqual(savedBefore);
      expect(saved.saved.actionPlan).toEqual(savedPlanBefore);
    }
    expect(io.executor).not.toHaveBeenCalled();
  });
  it.each(['a', 'b'])('projection failure in child %s still withdraws every open carrier before cleanup', async key => {
    const parentId = randomUUID(), active = seededPlan(parentId), before = preserved(active.children);
    const source: api.Model = { getResponse: vi.fn(async () => { throw Error('MODEL_MUST_NOT_RUN'); }), async *getStreamedResponse() { throw Error('NO_STREAM'); } };
    const secretary = new SalonSecretary(async () => source, () => 'gpt-6-luna', undefined, {}, { enabled: () => true });
    const parent: any = { id: parentId, actor, skill: 'auto', expires: Date.now() + 300000, busy: false, turns: 1, cancelled: false, multiActionV2: true, ...active.saved };
    const sessions = (secretary as any).sessions; sessions.set(parentId, parent); active.children.forEach(c => sessions.set(c.id, c));
    const old = approval(parent.actionPlan), originalProjection = (secretary as any).projectView.bind(secretary);
    (secretary as any).projectView = (session: any) => {
      if (session.id === active.children.find(c => c.key === key)!.id) throw Error('INDEPENDENT_PROJECTION_FAILURE');
      return originalProjection(session);
    };
    await expect(secretary.send(actor, { sessionId: parentId, message: 'Mude Lara e Bia para 16h.' })).rejects.toThrow('INDEPENDENT_PROJECTION_FAILURE');
    expect(source.getResponse).not.toHaveBeenCalled(); expect(preserved(active.children)).toEqual(before);
    for (const child of active.children.filter(c => c.key !== 'done')) expect(child.scheduling.proposal).toBeUndefined();
    expect(parent.actionPlan.actions.filter((a: any) => a.key !== 'done').every((a: any) => a.status === 'FAILED_SAFE')).toBe(true);
    expect(parent.actionPlan.actions.find((a: any) => a.key === 'done').status).toBe('DONE');
    (secretary as any).projectView = originalProjection;
    await expect(secretary.confirmActionPlanGroup(actor, parentId, old)).rejects.toThrow('CONFIRMATION_STALE');
    await expect(secretary.confirmActionPlanGroup(actor, parentId, approval(parent.actionPlan))).rejects.toThrow();
    expect(io.executor).not.toHaveBeenCalled(); expect(forbiddenNetwork).not.toHaveBeenCalled();
  });
  it.each(['NEW', 'ADD', 'RESUME', 'PATCH_TARGET'] as const)('failure after valid %s selection withdraws prepared candidates and fresh approvals', async route => {
    const parentId = randomUUID(), active = seededPlan(parentId), saved = seededPlan(parentId, 'saved_');
    const before = preserved(active.children), savedBefore = preserved(saved.children);
    const preparedChildren: { child: any; snapshot: ReturnType<typeof preserved> }[] = [];
    let requests = 0;
    const source: api.Model = { async getResponse(request) {
      requests++; const frame = liveEnvelope(request, route === 'PATCH_TARGET' ? 'PATCH' : route, saved.saved.actionPlan.plan_ref);
      for (const field of leaves(frame)) field.time.literal = '16h';
      return { usage: new api.Usage(), output: [{ type: 'function_call', callId: randomUUID(), name: (request.tools[0] as any).name, arguments: JSON.stringify(frame) }] };
    }, async *getStreamedResponse() { throw Error('NO_STREAM'); } };
    const secretary = new SalonSecretary(async () => source, () => 'gpt-6-luna', undefined, {}, { enabled: () => true });
    const parent: any = { id: parentId, actor, skill: 'auto', expires: Date.now() + 300000, busy: false, turns: 1, cancelled: false, multiActionV2: true, ...active.saved,
      ...(route === 'RESUME' ? { suspendedPlans: [saved.saved] } : {}) };
    const sessions = (secretary as any).sessions; sessions.set(parentId, parent); active.children.forEach(c => sessions.set(c.id, c));
    if (route === 'RESUME') saved.children.forEach(c => sessions.set(c.id, c));
    const oldApproval = approval(parent.actionPlan), savedApproval = approval(saved.saved.actionPlan);
    const apply = vi.spyOn(secretary as any, 'applyPlanOperation').mockImplementation(async (_actor: any, child: any) => {
      // Model-independent prepared state simulates a committed adapter draft.
      // Domain I/O is deliberately not imitated or called by this test.
      const fields = { customer_name: 'Célia', appointment_ref: randomUUID(), date: '2027-04-14', time: '16:00', source_date: '2027-04-13', source_time: '13:00' };
      Object.assign(child.scheduling, { operation: 'appointment.change', fields, message: 'Proposta nova. Use Confirmar para executar.',
        draft: { draft_ref: randomUUID(), draft_revision: 1, fields: structuredClone(fields), status: 'READY', missing_fields: [] },
        proposal: { proposal_ref: randomUUID(), draft_revision: 1, payload_hash: 'c'.repeat(64), expires_at: new Date(Date.now() + 300000).toISOString() } });
      preparedChildren.push({ child, snapshot: preserved([child]) });
    });
    let preparedCandidate: any;
    const record = vi.spyOn(secretary as any, 'recordAutomaticState').mockImplementation(async (_actor: any, current: any) => {
      preparedCandidate = current;
      expect(current.actionPlan.confirmation_groups.some((g: any) => g.status === 'READY_FOR_CONFIRMATION')).toBe(true);
      throw Error('INDEPENDENT_POST_PREPARE_AUDIT_FAILURE');
    });
    let patchBoundaryReached = false;
    if (route === 'PATCH_TARGET') {
      const originalPatch = (secretary as any).applyExistingPlanPatches.bind(secretary);
      vi.spyOn(secretary as any, 'applyExistingPlanPatches').mockImplementation(async (a: any, p: any, pending: any, selection: any, source: any) => {
        patchBoundaryReached = true;
        // The decoder accepted original keys. Simulate canonical-target drift
        // before domain application; the real target validation must reject.
        return originalPatch(a, p, pending, { ...selection, operations: selection.operations.map((op: any) => ({ ...op, item_key: 'no_longer_eligible' })) }, source);
      });
    }
    if (route === 'RESUME') await expect(secretary.resumePlan(actor, parentId, saved.saved.actionPlan.plan_ref)).rejects.toThrow('INDEPENDENT_POST_PREPARE_AUDIT_FAILURE');
    else await expect(secretary.send(actor, { sessionId: parentId, message: sourceFor(route === 'PATCH_TARGET' ? 'PATCH' : route) })).rejects.toThrow(route === 'PATCH_TARGET' ? 'CONTINUATION_ACTION_MISMATCH' : 'INDEPENDENT_POST_PREPARE_AUDIT_FAILURE');
    expect(requests).toBe(route === 'RESUME' ? 0 : 1); expect(forbiddenNetwork).not.toHaveBeenCalled();
    expect(preserved(active.children)).toEqual(before); expect(preserved(saved.children)).toEqual(savedBefore);
    if (route === 'NEW' || route === 'ADD') { expect(apply).toHaveBeenCalledOnce(); expect(preparedChildren).toHaveLength(1); }
    if (route === 'PATCH_TARGET') { expect(patchBoundaryReached).toBe(true); expect(record).not.toHaveBeenCalled(); }
    else expect(record).toHaveBeenCalledOnce();
    for (const { child, snapshot } of preparedChildren) {
      expect(preserved([child])).toEqual(snapshot); expect(child.scheduling.proposal).toBeUndefined(); expect(child.scheduling.message).not.toContain('Use Confirmar');
    }
    // NEW's failed candidate was never published, but must be closed too.
    if (route === 'NEW') expect(preparedCandidate.actionPlan.confirmation_groups.some((g: any) => g.status === 'READY_FOR_CONFIRMATION')).toBe(false);
    if (route === 'RESUME') {
      expect(parent.actionPlan.plan_ref).toBe(saved.saved.actionPlan.plan_ref);
      await expect(secretary.confirmActionPlanGroup(actor, parentId, savedApproval)).rejects.toThrow('CONFIRMATION_STALE');
    }
    await expect(secretary.confirmActionPlanGroup(actor, parentId, oldApproval)).rejects.toThrow('CONFIRMATION_STALE');
    expect(parent.actionPlan.confirmation_groups.some((g: any) => g.status === 'READY_FOR_CONFIRMATION')).toBe(false);
    await expect(secretary.confirmActionPlanGroup(actor, parentId, approval(parent.actionPlan))).rejects.toThrow();
    const currentIds: string[] = parent.children ?? [];
    for (const id of currentIds) { const child = sessions.get(id); if (!child.scheduling?.receipt) expect(child.scheduling.message).not.toContain('Use Confirmar'); }
    expect(io.executor).not.toHaveBeenCalled();
  });
});
