import type { JevWireRequest } from "./jev-provider";

/** Evaluation-only evidence. Never retain the provider body or arbitrary string values. */
export type InvalidResponseReason =
  | "MALFORMED_PROVIDER_RESPONSE"
  | "MISSING_FIELD"
  | "INVALID_TYPE"
  | "INVALID_CHOICE"
  | "QUESTION_COUNT_MISMATCH"
  | "PROBABILITY_SCHEMA_INVALID"
  | "CONFIDENCE_SCHEMA_INVALID"
  | "USAGE_SCHEMA_INVALID"
  | "MODEL_MISMATCH"
  | "UNEXPECTED_FIELD"
  | "SEMANTIC_CONFLICT"
  | "UNCLASSIFIED_VALIDATION_FAILURE";

type ObservedType = "undefined" | "null" | "array" | "object" | "string" | "number" | "boolean" | "other";
type SanitizedAnswer = {
  observedType: ObservedType;
  presentFields: ("type" | "choice" | "probabilities" | "confidence")[];
  unexpectedFieldCount: number;
  choiceType: ObservedType;
  publishedChoice: string | null;
  probabilitiesType: ObservedType;
  publishedProbabilityKeys: string[];
  unexpectedProbabilityKeyCount: number;
  publishedProbabilities: Record<string, number>;
  confidenceType: ObservedType;
  confidence: number | null;
};
export type SanitizedInvalidResponse = {
  observedType: ObservedType;
  presentTopLevelFields: ("model" | "answers" | "usage")[];
  unexpectedTopLevelFieldCount: number;
  modelType: ObservedType;
  publishedModel: string | null;
  answersType: ObservedType;
  answerCount: number | null;
  returnedQuestions: string[];
  unexpectedQuestionCount: number;
  answers: Record<string, SanitizedAnswer>;
  usageType: ObservedType;
  usage: { inputTokens: number | null; outputTokens: number | null };
};
export type InvalidJevResponseDiagnostic = {
  reason: InvalidResponseReason;
  path: string;
  httpStatus: number;
  requestId: string | null;
  sanitizedInvalidResponse: SanitizedInvalidResponse;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const observedType = (value: unknown): ObservedType => {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (record(value)) return "object";
  const kind = typeof value;
  return kind === "string" || kind === "number" || kind === "boolean" ? kind : "other";
};
const own = (value: Record<string, unknown>, field: string) => Object.prototype.hasOwnProperty.call(value, field);
const validProbability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const validTokenCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Only published question/choice names and bounded numeric values may leave this function. */
export function sanitizeInvalidJevResponse(raw: unknown, request: JevWireRequest): SanitizedInvalidResponse {
  const top = record(raw) ? raw : {};
  const returned = record(top.answers) ? top.answers : {};
  const knownQuestions = Object.keys(request.questions);
  const answers: Record<string, SanitizedAnswer> = {};
  for (const id of knownQuestions) {
    if (!own(returned, id)) continue;
    const value = returned[id], answer = record(value) ? value : {};
    const allowed = Object.keys(request.questions[id].criteria);
    const probabilities = record(answer.probabilities) ? answer.probabilities : {};
    answers[id] = {
      observedType: observedType(value),
      presentFields: (["type", "choice", "probabilities", "confidence"] as const).filter(field => own(answer, field)),
      unexpectedFieldCount: Object.keys(answer).filter(field => !["type", "choice", "probabilities", "confidence"].includes(field)).length,
      choiceType: observedType(answer.choice),
      publishedChoice: typeof answer.choice === "string" && allowed.includes(answer.choice) ? answer.choice : null,
      probabilitiesType: observedType(answer.probabilities),
      publishedProbabilityKeys: allowed.filter(choice => own(probabilities, choice)),
      unexpectedProbabilityKeyCount: Object.keys(probabilities).filter(choice => !allowed.includes(choice)).length,
      publishedProbabilities: Object.fromEntries(allowed.filter(choice => validProbability(probabilities[choice])).map(choice => [choice, probabilities[choice]])) as Record<string, number>,
      confidenceType: observedType(answer.confidence),
      confidence: validProbability(answer.confidence) ? answer.confidence : null,
    };
  }
  const usage = record(top.usage) ? top.usage : {};
  return {
    observedType: observedType(raw),
    presentTopLevelFields: (["model", "answers", "usage"] as const).filter(field => own(top, field)),
    unexpectedTopLevelFieldCount: Object.keys(top).filter(field => !["model", "answers", "usage"].includes(field)).length,
    modelType: observedType(top.model), publishedModel: top.model === request.model ? request.model : null,
    answersType: observedType(top.answers), answerCount: record(top.answers) ? Object.keys(top.answers).length : null,
    returnedQuestions: knownQuestions.filter(id => own(returned, id)),
    unexpectedQuestionCount: Object.keys(returned).filter(id => !knownQuestions.includes(id)).length,
    answers,
    usageType: observedType(top.usage),
    usage: { inputTokens: validTokenCount(usage.input_tokens) ? usage.input_tokens : null,
      outputTokens: validTokenCount(usage.output_tokens) ? usage.output_tokens : null },
  };
}

type Failure = { reason: InvalidResponseReason; path: string };
const failure = (reason: InvalidResponseReason, path: string): Failure => ({ reason, path });

/** Mirrors the current strict transport checks solely to locate a rejection. It never validates or repairs a response. */
export function diagnoseInvalidJevResponse(raw: unknown, request: JevWireRequest): Failure {
  if (!record(raw)) return failure("MALFORMED_PROVIDER_RESPONSE", "$");
  if (Object.keys(raw).some(key => !["model", "answers", "usage"].includes(key))) return failure("UNEXPECTED_FIELD", "$");
  if (!own(raw, "model")) return failure("MISSING_FIELD", "model");
  if (typeof raw.model !== "string") return failure("INVALID_TYPE", "model");
  if (raw.model !== request.model) return failure("MODEL_MISMATCH", "model");
  if (!own(raw, "answers")) return failure("MISSING_FIELD", "answers");
  if (!record(raw.answers)) return failure("INVALID_TYPE", "answers");
  const expected = Object.keys(request.questions), actual = Object.keys(raw.answers);
  const missing = expected.find(id => !own(raw.answers as Record<string, unknown>, id));
  if (missing) return failure("QUESTION_COUNT_MISMATCH", `answers.${missing}`);
  if (actual.length !== expected.length) return failure("QUESTION_COUNT_MISMATCH", "answers");
  for (const id of expected) {
    const path = `answers.${id}`, value = raw.answers[id];
    if (!record(value)) return failure("INVALID_TYPE", path);
    if (Object.keys(value).some(key => !["type", "choice", "probabilities", "confidence"].includes(key))) return failure("UNEXPECTED_FIELD", path);
    if (!own(value, "type")) return failure("MISSING_FIELD", `${path}.type`);
    if (typeof value.type !== "string") return failure("INVALID_TYPE", `${path}.type`);
    if (value.type !== "choice") return failure("INVALID_CHOICE", `${path}.type`);
    if (!own(value, "choice")) return failure("MISSING_FIELD", `${path}.choice`);
    if (typeof value.choice !== "string") return failure("INVALID_TYPE", `${path}.choice`);
    const allowed = Object.keys(request.questions[id].criteria);
    if (!allowed.includes(value.choice)) return failure("INVALID_CHOICE", `${path}.choice`);
    if (!own(value, "probabilities")) return failure("MISSING_FIELD", `${path}.probabilities`);
    if (!record(value.probabilities)) return failure("PROBABILITY_SCHEMA_INVALID", `${path}.probabilities`);
    const probabilities = value.probabilities;
    if (Object.keys(probabilities).length !== allowed.length || Object.keys(probabilities).some(key => !allowed.includes(key)))
      return failure("PROBABILITY_SCHEMA_INVALID", `${path}.probabilities`);
    for (const choice of allowed) if (!validProbability(probabilities[choice]))
      return failure("PROBABILITY_SCHEMA_INVALID", `${path}.probabilities.${choice}`);
    const values = allowed.map(choice => probabilities[choice] as number);
    if (Math.abs(values.reduce((sum, probability) => sum + probability, 0) - 1) > 1e-6 ||
      (probabilities[value.choice] as number) < Math.max(...values) - 1e-6)
      return failure("PROBABILITY_SCHEMA_INVALID", `${path}.probabilities`);
    if (own(value, "confidence") && !validProbability(value.confidence)) return failure("CONFIDENCE_SCHEMA_INVALID", `${path}.confidence`);
  }
  if (own(raw, "usage")) {
    if (!record(raw.usage)) return failure("USAGE_SCHEMA_INVALID", "usage");
    if (Object.keys(raw.usage).some(key => !["input_tokens", "output_tokens"].includes(key))) return failure("UNEXPECTED_FIELD", "usage");
    for (const field of ["input_tokens", "output_tokens"] as const) {
      if (own(raw.usage, field) && !validTokenCount(raw.usage[field])) return failure("USAGE_SCHEMA_INVALID", `usage.${field}`);
    }
  }
  // The flat protocol also checks cross-dimension consistency after its transport schema.
  const choices = Object.fromEntries(expected.map(id => [id, (raw.answers as Record<string, Record<string, unknown>>)[id].choice]));
  if (expected.includes("operation") && expected.includes("skill") && expected.includes("shape")) {
    const operation = choices.operation, skill = choices.skill, shape = choices.shape;
    const operationSkill = typeof operation === "string" && operation.startsWith("service.") ? "services"
      : typeof operation === "string" && operation.startsWith("customer.") && operation !== "customer.message" ? "customers"
        : operation === "customer.message" ? "communication"
          : typeof operation === "string" && operation.startsWith("financial.") ? "financial"
            : typeof operation === "string" && (operation.startsWith("product.") || operation.startsWith("stock.")) ? "inventory"
              : typeof operation === "string" && (operation.startsWith("appointment.") || operation.startsWith("availability.") || operation === "schedule.block") ? "scheduling" : null;
    if (operationSkill && operationSkill !== skill) return failure("SEMANTIC_CONFLICT", "answers.operation.choice");
    if (shape === "single" && ["multiple", "unclear", "out_of_catalog"].includes(operation as string)) return failure("SEMANTIC_CONFLICT", "answers.operation.choice");
    if (["dependent", "independent"].includes(shape as string) && operation !== "multiple") return failure("SEMANTIC_CONFLICT", "answers.operation.choice");
  }
  return failure("UNCLASSIFIED_VALIDATION_FAILURE", "$");
}
