import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ModelCallUsage } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const id = z.string().max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/).refine(s => !s.startsWith("sk-"));
const eventSchema = z.object({
  attempt: z.union([z.literal(1), z.literal(2)]), purpose: z.enum(['INTERPRETATION', 'SOURCE_LITERAL_REPAIR']),
  timestamp: z.string().datetime(), status: z.enum(["STARTED", "SUCCEEDED", "FAILED", "TIMEOUT", "ABORTED"]),
  usage_status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE", "UNKNOWN"]),
  model_id_requested: id, model_id_returned: id.nullable(), request_id: id.nullable(), response_id: id.nullable(),
  requests: counter, input_tokens: counter, cached_input_tokens: counter, cache_write_tokens: counter,
  output_tokens: counter, reasoning_tokens: counter, total_tokens: counter,
}).strict();
export const SECRETARY_USAGE_ENTITY = "SALON_SECRETARY_USAGE";

/** Internal only: immutable intent + terminal event. No migration, prompt, message or error body. */
export function usageRecorder(actor: ServiceActor, sessionId: string, runId: string, modelId: string) {
  const session_id = z.string().uuid().parse(sessionId);
  const run_id = z.string().uuid().parse(runId);
  const attempts = new Map<number, { call_id: string; finalId: string; status: ModelCallUsage['status'] }>();
  const model_id_requested = id.parse(modelId);
  return async (event: ModelCallUsage) => {
    const safe = eventSchema.parse({ ...event, model_id_requested });
    if ((safe.attempt === 1) !== (safe.purpose === 'INTERPRETATION')) throw Error('USAGE_ATTEMPT_INVALID');
    let attempt = attempts.get(safe.attempt);
    if (safe.status === 'STARTED') {
      if (attempt || safe.attempt === 2 && attempts.get(1)?.status !== 'SUCCEEDED') throw Error('USAGE_ATTEMPT_INVALID');
      attempt = { call_id: randomUUID(), finalId: randomUUID(), status: 'STARTED' };
    } else if (!attempt || attempt.status !== 'STARTED') throw Error('USAGE_ATTEMPT_INVALID');
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
