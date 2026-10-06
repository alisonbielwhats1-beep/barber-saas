import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ModelCallUsage } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
/** Also an OpenRouter model id ("deepseek/deepseek-v4.1-flash"): one slash between two plain segments. */
const id = z.string().max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$|^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/).refine(s => !s.startsWith("sk-"));
/** C4: 1 INTERPRETATION, then at most one 2 SOURCE_LITERAL_REPAIR. C5 agent (flag SALON_SECRETARY_AGENT): calls 1..3 of one message,
 * AGENT_LOOKUP (a round that may consult) or AGENT_PLAN (forced plan; the 3rd call always is). Pilot of the reschedule (flag
 * SALON_SECRETARY_PILOT_RESCHEDULE): 1 PILOT_INTERPRETATION, then at most one 2 PILOT_REPAIR (format repair). */
export const SECRETARY_USAGE_PURPOSES = ['INTERPRETATION', 'SOURCE_LITERAL_REPAIR', 'AGENT_LOOKUP', 'AGENT_PLAN', 'PILOT_INTERPRETATION', 'PILOT_REPAIR'] as const;
type UsagePurpose = (typeof SECRETARY_USAGE_PURPOSES)[number];
/** What the recorder takes: a C4 event (ModelCallUsage), an agent event (instrumentAgentModel) or a pilot event (instrumentPilotModel), same
 * fields, wider attempt/purpose. */
export type SecretaryUsageEvent = Omit<ModelCallUsage, 'attempt' | 'purpose'> & { attempt: 1 | 2 | 3; purpose: UsagePurpose };
const agentPurpose = (purpose: UsagePurpose) => purpose === 'AGENT_LOOKUP' || purpose === 'AGENT_PLAN';
const pilotPurpose = (purpose: UsagePurpose) => purpose === 'PILOT_INTERPRETATION' || purpose === 'PILOT_REPAIR';
/** One run is one family: C4, agent or pilot. */
const family = (purpose: UsagePurpose) => agentPurpose(purpose) ? 'AGENT' : pilotPurpose(purpose) ? 'PILOT' : 'C4';
/** The admitted attempt/purpose pairs (the C4 and agent pairs exactly as before). */
const pairAdmitted = (attempt: 1 | 2 | 3, purpose: UsagePurpose) => agentPurpose(purpose) ? attempt < 3 || purpose === 'AGENT_PLAN'
  : pilotPurpose(purpose) ? attempt === 1 ? purpose === 'PILOT_INTERPRETATION' : attempt === 2 && purpose === 'PILOT_REPAIR'
  : attempt === 1 ? purpose === 'INTERPRETATION' : attempt === 2 && purpose === 'SOURCE_LITERAL_REPAIR';
const eventSchema = z.object({
  attempt: z.union([z.literal(1), z.literal(2), z.literal(3)]), purpose: z.enum(SECRETARY_USAGE_PURPOSES),
  timestamp: z.string().datetime(), status: z.enum(["STARTED", "SUCCEEDED", "FAILED", "TIMEOUT", "ABORTED"]),
  usage_status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE", "UNKNOWN"]),
  model_id_requested: id, model_id_returned: id.nullable(), request_id: id.nullable(), response_id: id.nullable(),
  requests: counter, input_tokens: counter, cached_input_tokens: counter, cache_write_tokens: counter,
  output_tokens: counter, reasoning_tokens: counter, total_tokens: counter,
  // Owner 06/10/2026: the provider-reported real cost of the call (micro-USD), when the provider reports one.
  cost_micro_usd: z.number().int().nonnegative().max(10_000_000).optional(),
}).strict();
export const SECRETARY_USAGE_ENTITY = "SALON_SECRETARY_USAGE";

/** Internal only: immutable intent + terminal event. No migration, prompt, message or error body. One run = one family (C4 or
 * agent); attempt n only after n−1 SUCCEEDED, never after an AGENT_PLAN; the terminal event keeps its STARTED purpose. */
export function usageRecorder(actor: ServiceActor, sessionId: string, runId: string, modelId: string) {
  const session_id = z.string().uuid().parse(sessionId);
  const run_id = z.string().uuid().parse(runId);
  const attempts = new Map<number, { call_id: string; finalId: string; status: ModelCallUsage['status']; purpose: UsagePurpose }>();
  const model_id_requested = id.parse(modelId);
  return async (event: SecretaryUsageEvent) => {
    const safe = eventSchema.parse({ ...event, model_id_requested });
    if (!pairAdmitted(safe.attempt, safe.purpose)) throw Error('USAGE_ATTEMPT_INVALID');
    let attempt = attempts.get(safe.attempt);
    if (safe.status === 'STARTED') {
      const previous = attempts.get(safe.attempt - 1);
      if (attempt || safe.attempt > 1 && (previous?.status !== 'SUCCEEDED' || previous.purpose === 'AGENT_PLAN' || family(previous.purpose) !== family(safe.purpose)))
        throw Error('USAGE_ATTEMPT_INVALID');
      attempt = { call_id: randomUUID(), finalId: randomUUID(), status: 'STARTED', purpose: safe.purpose };
    } else if (!attempt || attempt.status !== 'STARTED' || attempt.purpose !== safe.purpose) throw Error('USAGE_ATTEMPT_INVALID');
    const { call_id, finalId } = attempt;
    await withTenant(actor, tx => tx.auditLog.create({ data: {
      id: safe.status === "STARTED" ? call_id : finalId,
      salonId: actor.salonId, userId: actor.userId, actorName: "Secretária — telemetria técnica",
      entityType: SECRETARY_USAGE_ENTITY, entityId: call_id,
      action: safe.status === "STARTED" ? "MODEL_CALL_STARTED" : "MODEL_CALL_FINISHED",
      metadata: { ...safe, schema_version: 2, interpretation_source: "MODEL", run_id, session_id, salon_id: actor.salonId, call_id },
    } }));
    attempts.set(safe.attempt, { ...attempt, status: safe.status });
  };
}
