import { selectionSchema, type SelectedOperation } from '@everflair/salon-secretary';
import { schedulingOperation, schedulingPatch } from './scheduling-contract';

/** Project an already decoded operation, not natural language. Validate the
 * complete closed envelope before removing neutral cross-capability slots, so
 * unknown keys (even null) and non-neutral foreign values cannot disappear.
 * Graph metadata and literal witnesses remain available to their own guards;
 * only domain fields may enter a scheduling draft. */
export function projectSchedulingOperation(input: unknown) {
  const selected = selectionSchema.shape.operations.element.parse(input) as SelectedOperation & { temporal_negative_context?: unknown };
  const {
    item_key, depends_on, released_slot_of, source_scope, temporal_evidence, temporal_negative_context, operation,
    target_name, name, priceCents, durationMin, phone, email, requested_fields, clear_fields,
    communication, inventory, financial, ...domain
  } = selected;
  if ([target_name, name, priceCents, durationMin, phone, email, communication, inventory, financial].some(value => value != null)
    || requested_fields.length || clear_fields.length) throw Error('CAPABILITY_FIELD_MISMATCH');
  return {
    operation: schedulingOperation.parse(operation),
    fields: schedulingPatch.parse(Object.fromEntries(Object.entries(domain).filter(([, value]) => value != null))),
    item_key, depends_on: depends_on ?? [], released_slot_of,
    source_scope: source_scope ?? undefined, temporal_evidence: temporal_evidence ?? undefined,
    temporal_negative_context: temporal_negative_context ?? undefined,
  };
}
