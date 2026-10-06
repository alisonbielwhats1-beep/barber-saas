/** Evaluation admission only. This catalog describes observeView/scoreTurn
 * surfaces, not runtime permissions or values. No fallback across surfaces. */
import type { CapabilitySelection } from '../src/skill-registry';

type Operation = CapabilitySelection['operations'][number]['operation'];
export type OracleSurface = 'fields' | 'effective' | 'proposalFields' | 'resultContains';
type Projection = Readonly<Record<OracleSurface, readonly string[]>>;
export const ORACLE_PROJECTION_VERSION = 'free-use-observed-paths-v2';
const prefix = (name: string, paths: readonly string[]) => paths.map(path => `${name}.${path}`);
const service = ['name', 'priceCents', 'durationMin'];
const customer = ['name', 'phone', 'email'];
// collectedActionFields reconstructs accepted fields and removes transport
// evidence. Wire-only source_scope and inventory witness/reference leaves are
// not observable accepted ActionPlan fields, even when Luna supplied them.
const linguisticCommon = ['target_name', ...service, 'phone', 'email', 'requested_fields', 'clear_fields'];
const temporal = ['customer_name', 'service_name', 'professional_name', 'date', 'day_offset', 'weekday', 'time', 'period',
  'source_date', 'source_day_offset', 'source_weekday', 'source_time', 'end_date', 'end_time', 'reason',
  'destination_mode', 'override_requested', 'override_reason'];
const reasonProof = ['kind', 'message_sha256', 'start', 'end', 'original_text', 'interpreted_text'];
const scheduling = [...temporal, 'appointment_ref', 'customer_ref', 'service_ref', 'professional_ref',
  ...prefix('reason_source', reasonProof), ...prefix('override_reason_source', reasonProof)];
const inventory = ['mode', 'quantity', 'reason'];
const inventoryLinguistic = ['product_name', 'low_stock', ...inventory];
const financial = ['metrics', 'period', 'compare_period', 'group_by'];
const message = ['channel', 'message_mode', 'content'];
const journal = ['proposal_ref', 'draft_ref', 'draft_revision', 'expires_at', 'payload_hash', 'preview'];
const product = ['id', 'name', 'stock', 'minStock', 'active', 'unit', 'revision'];
const snapshot = ['customer_ref', 'customer_name', 'service_ref', 'service_revision', 'service_name', 'professional_ref', 'professional_name',
  'date', 'startLocal', 'endLocal', 'timezone', 'priceCents', 'priceType', 'durationMin', 'quote', 'overbook.reason', 'overbook.conflict_hash'];
const actionSnapshot = ['kind', 'professional_ref', 'professional_name', 'timezone', 'startLocal', 'endLocal', 'appointment_ref', 'revision',
  'before_start', 'before_end', 'before_timezone', 'customer_name', 'customer_ref', 'priceCents', 'requires_acceptance', 'resource_ids', 'waiting_count', 'waiting_hash', 'services', 'affected'];
const review = ['status', 'startLocal', 'endLocal', 'durationMin', 'causes', 'override_allowed', 'missing_fields', 'message', 'conflicts', 'alternatives'];
const schedulingProposal = [...journal, 'operation', 'temporal_missing', 'source_missing', 'pending_temporal_ambiguities', 'pending_calendar_conflicts', ...prefix('fields', scheduling), ...prefix('review', review)];
const batchProposal = [...journal, 'batch_ref', 'batch_revision', 'operation', 'status', 'missing_fields', 'message', ...prefix('review', review),
  'plan.execution_policy', 'plan.items', 'candidates.item_key', 'candidates.field', 'candidates.items',
  ...prefix('snapshot.cancel', actionSnapshot), ...prefix('snapshot.create', snapshot), ...prefix('snapshot.create_fields', scheduling),
  'snapshot.customer_revision', 'snapshot.professional_revision', 'snapshot.resource_revision'];
const appointment = ['appointment_ref', 'customer_ref', 'customer_name', 'professional_ref', 'professional_name', 'service_ref',
  'start_at', 'end_at', 'start_local', 'end_local', 'status', 'revision', 'timezone', 'priceCents', 'services'];
const slots = ['startLocal', 'endLocal', 'professional_ref'];
const projection = (fields: readonly string[], effective: readonly string[], proposalFields: readonly string[], resultContains: readonly string[]): Projection =>
  Object.freeze({ fields: Object.freeze([...new Set(fields)]), effective: Object.freeze([...new Set(effective)]),
    proposalFields: Object.freeze([...new Set(proposalFields)]), resultContains: Object.freeze([...new Set(resultContains)]) });
const mutation = (fields: readonly string[], effective: readonly string[], proposalFields: readonly string[], resultContains: readonly string[] = []): Projection =>
  projection(fields, effective, proposalFields, resultContains);
const read = (fields: readonly string[], effective: readonly string[], resultContains: readonly string[]): Projection =>
  projection(fields, effective, [], resultContains);
const serviceProposal = [...journal, 'requirements_version', 'currency', ...prefix('fields', service)];
const customerProposal = [...journal, 'operation', 'requested_fields', ...prefix('fields', customer), ...prefix('patch', customer)];
const schedulingLinguistic = [...linguisticCommon, ...temporal];
const stockLinguistic = [...linguisticCommon, ...prefix('inventory', inventoryLinguistic)];
const communicationProposal = [...journal, 'operation', ...prefix('fields', message),
  ...prefix('recipient', ['customer_ref', 'name', 'masked_recipient', 'contact_revision']),
  ...prefix('dependency.snapshot', actionSnapshot), ...prefix('dependency.fields', scheduling)];

// Object-array traversal is deliberately absent: valueAt does not traverse
// arrays. Whole arrays remain valid (including an empty object array, which the
// existing fieldValue/score contract can compare). Optional paths are
// allowed regardless of whether a particular turn has filled them yet.
export const oracleProjectionCatalog = Object.freeze({
  'service.create': mutation(linguisticCommon, service, serviceProposal),
  'service.change': mutation(linguisticCommon, service, [...serviceProposal, 'change.service_ref', 'change.service_revision', 'change.price_type',
    ...prefix('change.before', service), ...prefix('change.patch', service)]),
  'customer.create': mutation(linguisticCommon, customer, customerProposal),
  'customer.change': mutation(linguisticCommon, customer, [...customerProposal, 'change.customer_ref', 'change.customer_revision', ...prefix('change.before', customer)]),
  'customer.search': read(linguisticCommon, customer, ['id', ...customer]),
  'customer.read': read(linguisticCommon, customer, ['id', ...customer]),
  'product.search': read(stockLinguistic, ['product_ref'], product),
  'stock.balance': read(stockLinguistic, ['product_ref'], product),
  'stock.movement': mutation(stockLinguistic, [...inventory, 'product_ref'], [...journal, 'operation', ...prefix('fields', inventory),
    ...prefix('product', product), 'delta', 'projected_stock', 'quantity_origin',
    ...prefix('quantity_resolution', ['status', 'catalog_unit', 'quantity', 'basis', 'expression', 'source_hash', 'cause', 'count', 'unit_text', 'identity_status'])]),
  'financial.report': read([...linguisticCommon, ...prefix('financial', financial)], financial, ['id', 'value', 'unit', 'definition', 'coverage', 'reason']),
  'appointment.create': mutation(schedulingLinguistic, scheduling, [...schedulingProposal, ...prefix('snapshot', snapshot), ...batchProposal], slots),
  'appointment.change': mutation(schedulingLinguistic, scheduling, [...schedulingProposal, ...prefix('action_snapshot', actionSnapshot)]),
  // observeView may use a single cancel proposal, a shared batch proposal, or
  // the communication parent's proposal when its cancellation is deferred.
  'appointment.cancel': mutation(schedulingLinguistic, scheduling, [...schedulingProposal, ...prefix('action_snapshot', actionSnapshot), ...batchProposal, ...communicationProposal]),
  'schedule.block': mutation(schedulingLinguistic, scheduling, [...schedulingProposal, ...prefix('action_snapshot', actionSnapshot)]),
  'appointment.list': read(schedulingLinguistic, scheduling, appointment),
  'appointment.read': read(schedulingLinguistic, scheduling, appointment),
  'availability.get': read(schedulingLinguistic, scheduling, slots),
  'customer.message': mutation([...linguisticCommon, ...prefix('communication', ['recipient_name', ...message])], message, communicationProposal),
} satisfies Record<Operation, Projection>);

export type OracleProjectionIssue = { operation: string; surface: string; path: string; location: (string | number)[] };
type OracleAction = { operation: string; fields?: Record<string, unknown>; effective?: Record<string, unknown>;
  proposalFields?: Record<string, unknown>; resultContains?: Record<string, unknown>; allowMissing?: string[];
  preserve?: string[]; forbiddenEffective?: string[]; sourceBackedEffective?: string[] };
const surfaces: OracleSurface[] = ['fields', 'effective', 'proposalFields', 'resultContains'];
const safePath = (path: string) => /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(path) &&
  !path.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part));
export function validateOracleProjection(action: OracleAction): OracleProjectionIssue[] {
  const issues: OracleProjectionIssue[] = [];
  const add = (surface: string, path: string, location: (string | number)[]) => issues.push({ operation: action.operation, surface, path, location });
  if (!Object.hasOwn(oracleProjectionCatalog, action.operation)) {
    add('operation', action.operation, ['operation']); return issues;
  }
  const catalog: Projection = oracleProjectionCatalog[action.operation as Operation];
  const accepts = (surface: OracleSurface, path: string) => safePath(path) && catalog[surface].includes(path);
  for (const surface of surfaces) for (const path of Object.keys(action[surface] ?? {}))
    if (!accepts(surface, path)) add(surface, path, [surface, path]);
  for (const list of ['preserve', 'forbiddenEffective', 'sourceBackedEffective'] as const)
    action[list]?.forEach((path, index) => { if (!accepts('effective', path)) add('effective', path, [list, index]); });
  // allowMissing is consulted only while comparing fields/effective/proposal.
  // A name not present in any corresponding check cannot grant an exemption.
  action.allowMissing?.forEach((path, index) => {
    if (!(['fields', 'effective', 'proposalFields'] as const).some(surface => Object.hasOwn(action[surface] ?? {}, path) && accepts(surface, path)))
      add('allowMissing', path, ['allowMissing', index]);
  });
  return issues;
}
