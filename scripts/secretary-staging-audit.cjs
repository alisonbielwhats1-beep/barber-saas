'use strict';

// Published read/preparation telemetry is not an operational business mutation.
// Never ignore AuditLog wholesale: execution, unknown events and other actors fail.
const preparationEvents = new Set([
  'SALON_SECRETARY_USAGE:MODEL_CALL_STARTED',
  'SALON_SECRETARY_USAGE:MODEL_CALL_FINISHED',
  'SECRETARY_SKILL_LOAD:SKILLS_LOADED',
  'SECRETARY_OPERATION_PLAN:OPERATIONS_PREPARED',
  'SECRETARY_ROUTER:DIRECT_LUNA',
  'SECRETARY_SCHEDULING:DRAFT',
  'SECRETARY_LATENCY:SCHEDULING_TIMINGS',
]);

function classifyPreparationAudit(records, actor) {
  const counts = {};
  for (const row of records) {
    const event = `${row.entityType}:${row.action}`;
    if (row.salonId !== actor.salonId || row.userId !== actor.userId || !preparationEvents.has(event)) {
      throw Error('UNEXPECTED_AUDIT_EVENT');
    }
    counts[event] = (counts[event] || 0) + 1;
  }
  return { technicalEvents: records.length, counts };
}

module.exports = { classifyPreparationAudit };
