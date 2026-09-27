import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { classifyPreparationAudit } = require('../../../scripts/secretary-staging-audit.cjs');
const actor = { salonId: 'fixture-a', userId: 'owner-a' };
const draft = { ...actor, entityType: 'SECRETARY_SCHEDULING', action: 'DRAFT' };

describe('staging read/preparation audit reconciliation', () => {
  it('classifies published draft and inference telemetry without inventing a business mutation', () => {
    const rows = [draft, { ...actor, entityType: 'SALON_SECRETARY_USAGE', action: 'MODEL_CALL_STARTED' }];
    expect(classifyPreparationAudit(rows, actor).technicalEvents).toBe(2);
  });
  it.each([
    { ...draft, salonId: 'fixture-b' }, { ...draft, userId: 'other-user' },
    { ...draft, action: 'EXECUTED' }, { ...draft, entityType: 'SERVICE', action: 'UPDATE' },
    { ...draft, entityType: 'UNKNOWN' },
  ])('does not excuse operational, foreign or unrecognized events as telemetry', row => {
    expect(() => classifyPreparationAudit([row], actor)).toThrow('UNEXPECTED_AUDIT_EVENT');
  });
});
