/** Evaluation-only data contract. Oracles are never passed to the interpreter. */
import { z } from 'zod';
import { validateOracleProjection, type OracleProjectionIssue } from './free-use-oracle-projection';
export const fieldValue = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]);
const fields = z.record(z.string(), fieldValue);
const entity = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/), name: z.string().min(1) });
export const fixtureSchema = z.object({
  customers: z.array(entity.extend({ phone: z.string().nullable().optional(), email: z.string().nullable().optional() }).strict()),
  professionals: z.array(entity.strict()),
  services: z.array(entity.extend({ durationMin: z.number().int().positive(), priceCents: z.number().int().nonnegative(), professionalKeys: z.array(z.string()).min(1) }).strict()),
  products: z.array(entity.extend({ stock: z.number().int().nonnegative(), minStock: z.number().int().nonnegative().default(1) }).strict()),
  appointments: z.array(z.object({ key: z.string(), customerKey: z.string(), professionalKey: z.string(), serviceKey: z.string(),
    startAt: z.string().datetime({ offset: true }), status: z.enum(['CONFIRMED', 'COMPLETED']).default('CONFIRMED'),
    payment: z.object({ amountCents: z.number().int().nonnegative(), paidAt: z.string().datetime({ offset: true }) }).strict().optional() }).strict()),
  openWeekdays: z.array(z.number().int().min(0).max(6)), openMinutes: z.number().int(), closeMinutes: z.number().int(),
  closures: z.array(z.object({ startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }), reason: z.string() }).strict()).default([]),
}).strict();
export const actionExpectationSchema = z.object({
  operation: z.string(), index: z.number().int().nonnegative().default(0), referenceTurn: z.number().int().positive().optional(),
  fields: fields.optional(), effective: fields.optional(), allowMissing: z.array(z.string()).default([]),
  missingAll: z.array(z.string()).optional(), missingAny: z.array(z.string()).optional(), missingOnly: z.array(z.string()).optional(),
  statusAny: z.array(z.string()).optional(), candidateKind: z.string().optional(),
  proposal: z.boolean().optional(), proposalFields: fields.optional(), resultContains: fields.optional(), resultRequired: z.boolean().optional(),
  availability: z.object({date:z.string(),durationMin:z.number().int().positive(),professionalRef:z.string(),startMinute:z.number().int(),endMinute:z.number().int(),minResults:z.number().int().nonnegative(),excluded:z.array(z.object({startMinute:z.number().int(),endMinute:z.number().int()}).strict())}).strict().optional(),
  dependsOn: z.array(z.object({operation:z.string(),index:z.number().int().nonnegative().default(0)}).strict()).optional(),
  reviewStatus: z.string().optional(), reviewCause: z.string().optional(),
  preserve: z.array(z.string()).optional(), sameDraft: z.boolean().optional(), changedApproval: z.boolean().optional(),
  forbiddenEffective: z.array(z.string()).optional(), sourceBackedEffective: z.array(z.string()).optional(),
}).strict();
export const turnExpectationSchema = z.object({
  actionCount: z.number().int().nonnegative().optional(), actions: z.array(actionExpectationSchema).default([]),
  capabilityStatus: z.string().optional(), confirmable: z.boolean().optional(),
  planSameAsTurn:z.number().int().positive().optional(),planDifferentFromTurn:z.number().int().positive().optional(),
  forbidOperations: z.array(z.string()).default([]), nonEmptyMessage: z.boolean().default(true),
  allowSafeClarification: z.boolean().default(false),
}).strict();
export const caseSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,63}$/), family: z.string().min(1),
  criterion: z.string().min(1), clock: z.string().datetime({ offset: true }).optional(),
  requireOverlap: z.boolean().default(false), fixture: fixtureSchema.optional(),
  turns: z.array(z.object({ message: z.string().min(1).max(12000),
    when: z.object({ operation:z.string().optional(),index:z.number().int().nonnegative().optional(),
      missingAny:z.array(z.string()).min(1).optional(),reviewStatusAny:z.array(z.enum(['AVAILABLE','CONFLICT_OVERRIDABLE','CONFLICT_HARD_BLOCK'])).min(1).optional(),
      temporalMissingAny:z.array(z.enum(['date','time','source_date','source_time','end_date','end_time'])).min(1).optional(),
      confirmable:z.boolean().optional(),proposal:z.boolean().optional(),
    }).strict().refine(gate=>gate.missingAny!==undefined||gate.reviewStatusAny!==undefined||gate.temporalMissingAny!==undefined||gate.confirmable!==undefined||gate.proposal!==undefined,'EMPTY_TURN_GATE').optional(),
    expect: turnExpectationSchema }).strict()).min(1).max(20),
}).strict();
export const suiteSchema = z.object({
  schemaVersion: z.literal(1), suiteId: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  timezone: z.literal('America/Sao_Paulo'), clock: z.string().datetime({ offset: true }),
  source: z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  fixture: fixtureSchema, cases: z.array(caseSchema).min(1).max(100),
}).strict().superRefine((suite, ctx) => {
  if (new Set(suite.cases.map(c => c.id)).size !== suite.cases.length) ctx.addIssue({ code: 'custom', message: 'DUPLICATE_CASE_ID' });
  // Admission boundary only: standalone score-unit-test fragments stay syntactic.
  // Every prepared/run suite passes here before database or provider dispatch.
  suite.cases.forEach((c, caseIndex) => c.turns.forEach((turn, turnIndex) => turn.expect.actions.forEach((action, actionIndex) => {
    for (const issue of validateOracleProjection(action)) ctx.addIssue({ code: 'custom', message: 'FREE_USE_ORACLE_PROJECTION_INVALID',
      path: ['cases', caseIndex, 'turns', turnIndex, 'expect', 'actions', actionIndex, ...issue.location], params: { oracleProjection: issue } });
  })));
});
export type FreeUseFixture = z.infer<typeof fixtureSchema>;
export type FreeUseCase = z.infer<typeof caseSchema>;
export type FreeUseSuite = z.infer<typeof suiteSchema>;
export type TurnExpectation = z.infer<typeof turnExpectationSchema>;
export type EntityBindings = Record<string, string>;
export type FixtureIdentity = { tenant: string; actor: string; foreignTenant: string; foreignActor: string; bindings: EntityBindings };
export type CaseStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_EXECUTED';
export const noEffects = { confirmations: 0, operationalWrites: 0, externalMessages: 0 };

export function preflightFreeUseSuite(input: unknown) {
  const parsed = suiteSchema.safeParse(input);
  if (parsed.success) return { status: 'VALID' as const, suite: parsed.data };
  const issues = parsed.error.issues.map(issue => ({ location: issue.path, code: issue.message,
    ...('params' in issue && issue.params?.oracleProjection ? { projection: issue.params.oracleProjection as OracleProjectionIssue } : {}) }));
  return { status: 'BLOCKED' as const, reason: issues.some(issue => issue.projection) ? 'FREE_USE_ORACLE_PROJECTION_INVALID' : 'FREE_USE_SUITE_INVALID', issues };
}
export function parseFreeUseSuite(input: unknown): FreeUseSuite {
  const result = preflightFreeUseSuite(input);
  if (result.status === 'VALID') return result.suite;
  throw Object.assign(new Error(result.reason), { issues: result.issues });
}
