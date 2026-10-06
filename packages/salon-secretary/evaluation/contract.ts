import { z } from "zod";
import type { InvalidJevResponseDiagnostic } from "./invalid-response-diagnostic";

/** Frozen evaluation catalogue. Never imported by, or used to authorize, runtime. */
export const skills = ["services", "customers", "scheduling", "financial", "inventory", "communication"] as const;
export const operations = ["service.create", "service.change", "customer.search", "customer.read", "customer.create", "customer.change", "appointment.create", "appointment.list", "appointment.read", "availability.get", "appointment.change", "appointment.cancel", "schedule.block", "financial.report", "product.search", "stock.balance", "stock.movement", "customer.message"] as const;
export const operationSkill = (op: string) => {
  if (op === "customer.message") return "communication";
  if (op.startsWith("service.")) return "services";
  if (op.startsWith("customer.")) return "customers";
  if (op.startsWith("financial.")) return "financial";
  if (op.startsWith("stock.") || op.startsWith("product.")) return "inventory";
  return "scheduling";
};
export const choiceSets = {
  skill: [...skills, "multiple", "unclear", "out_of_catalog"],
  operation: [...operations, "multiple", "unclear", "out_of_catalog"],
  shape: ["single", "independent", "dependent", "unclear", "out_of_catalog"],
  period: ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "comparison", "none", "unclear"],
  metric: ["service_revenue", "realized_revenue", "received_revenue", "outstanding_receivables", "completed_count", "average_ticket", "multiple", "none", "unclear"],
  inventory: ["balance", "low_stock", "IN", "OUT", "search", "none", "unclear"],
  communication: ["EXACT", "GENERATED", "unspecified", "none", "unclear"],
} as const;
export type QuestionId = keyof typeof choiceSets;
export type Decision = { [K in QuestionId]: typeof choiceSets[K][number] };
export const decisionSchema = z.object({
  skill: z.enum(choiceSets.skill), operation: z.enum(choiceSets.operation), shape: z.enum(choiceSets.shape),
  period: z.enum(choiceSets.period), metric: z.enum(choiceSets.metric), inventory: z.enum(choiceSets.inventory), communication: z.enum(choiceSets.communication),
}).strict();
export const inputSchema = z.object({
  message: z.string().min(1).max(1400),
  context: z.object({
    operation: z.enum(operations).optional(),
    waiting_for: z.enum(["time", "end_time", "date", "durationMin", "quantity", "channel", "service", "customer_selection"]).optional(),
    inventory_mode: z.enum(["IN", "OUT"]).optional(),
  }).strict().default({}),
}).strict();
export type EvaluationInput = z.infer<typeof inputSchema>;
export type Evidence = { path: string; anchor: string; kind: "real_output" | "domain_test" | "gate_report"; note: string };
export type EvaluationCase = {
  id: string; category: "A" | "B" | "C" | "D"; input: EvaluationInput;
  expected: {
    decision: Decision; skills: typeof skills[number][]; operations: typeof operations[number][];
    dependencies: { from: number; to: number }[];
    /** Open extraction is oracle-only, never sent to JEV. */
    domainFields: Record<string, unknown>;
    fastPathPatch?: Record<string, unknown>;
    requiresOpenExtraction: boolean;
  };
  evidence: Evidence[];
};
export type ChoiceAnswer = { choice: string; probabilities: Record<string, number>; confidence: number | null };
export type EvaluationResult = {
  provider: "JEV" | "FAST_PATH" | "LUNA_ARCHIVE";
  status: "OK" | "NO_MATCH" | "ERROR";
  decision: Decision | null;
  resolvedSkills?: typeof skills[number][];
  interpretedOperations?: typeof operations[number][];
  dependencies: { from: number; to: number }[] | null;
  answers: Partial<Record<QuestionId, ChoiceAnswer>>;
  fastPathPatch?: Record<string, unknown>;
  latencyMs: number;
  usage: { inputTokens: number | null; outputTokens: number | null };
  estimatedCostUsd: number | null;
  actualCostUsd: null;
  modelRequested: string | null; modelReturned: string | null;
  requestId: string | null;
  error: "MISSING_KEY" | "NETWORK_DISABLED" | "INVALID_INPUT" | "INVALID_RESPONSE" | "AUTH" | "RATE_LIMIT" | "HTTP" | "TIMEOUT" | "NETWORK" | null;
  /** Sanitized evaluation-only evidence, present only when a provider response is rejected. */
  invalidResponseDiagnostic?: InvalidJevResponseDiagnostic;
  fallbackReasons: string[];
  /** This evaluation result is never executable. */
  executable: false;
};
export function emptyResult(provider: EvaluationResult["provider"]): EvaluationResult {
  return { provider, status: "ERROR", decision: null, dependencies: null, answers: {}, latencyMs: 0,
    usage: { inputTokens: null, outputTokens: null }, estimatedCostUsd: null, actualCostUsd: null,
    modelRequested: null, modelReturned: null, requestId: null, error: null, fallbackReasons: [], executable: false };
}
