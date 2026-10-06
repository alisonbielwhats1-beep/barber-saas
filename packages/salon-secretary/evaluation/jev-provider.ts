import { z } from "zod";
import { choiceSets, decisionSchema, emptyResult, inputSchema, operationSkill, operations, type EvaluationInput, type EvaluationResult, type QuestionId } from "./contract";
import { diagnoseInvalidJevResponse, sanitizeInvalidJevResponse } from "./invalid-response-diagnostic";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-1.13.0";
/** Official price audited 2026-09-22; estimate, not an invoice. */
export const INPUT_USD_PER_MILLION = 0.042;
export type JevWireRequest = { model: typeof JEV_MODEL; state: unknown; questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, null> }> };
/** Evaluation-only protocol extension. The original flat protocol remains the default. */
export type JevEvaluationProtocol = { build(input: EvaluationInput): JevWireRequest; parse(raw: unknown): EvaluationResult };
const instructions: Record<QuestionId, string> = {
  skill: "Qual capacidade é necessária? services=cadastro de serviços; customers=cadastro de clientes; scheduling=agenda; financial=relatórios; inventory=estoque; communication=mensagem fake. Use multiple para mais de uma, unclear se indeterminada, out_of_catalog para capacidade não publicada.",
  operation: "Qual operação é pedida? Escolha somente a operação publicada; multiple se há mais de uma; unclear se não é possível determinar; out_of_catalog se não suportada. Use context.operation para continuação, sem inventar nova operação.",
  shape: "O pedido é uma operação single, várias independent, ou dependent quando uma depende do sucesso/slot da outra? Use unclear para intenção ambígua e out_of_catalog para pedido não suportado. Nunca execute ações.",
  period: "Qual período financeiro explícito? today=hoje, yesterday=ontem, this_week=esta semana, last_week=semana passada, this_month=este mês, last_month=mês passado. comparison para comparar períodos; none sem período financeiro; unclear se ambíguo. Não converter datas.",
  metric: "Qual métrica financeira? Faturamento sem qualificador=service_revenue; com produtos=realized_revenue; recebido=received_revenue; a receber=outstanding_receivables; atendimentos realizados=completed_count; ticket médio=average_ticket; multiple para várias. none fora de Financial; unclear se não suportada (lucro/taxas/estornos). Nunca calcular valores.",
  inventory: "Qual intenção de estoque: balance=consultar saldo; low_stock=produtos acabando; IN=entrada; OUT=saída; search=localizar produto; none fora de estoque; unclear se ambíguo. Não calcular saldo ou extrair quantidade.",
  communication: "EXACT quando há texto literal para enviar sem reescrita; GENERATED somente se explicitamente solicitado redigir/educadamente; unspecified quando pede aviso sem texto literal nem geração explícita; none sem mensagem; unclear se ambíguo. Não gerar texto.",
};
const safeText = (text: string) => !/(?:\+?\d[\s().-]*){8,}|\b(?:sk-|ts[_-](?:live|test)[_-])|(?:api[_ -]?key|password|secret|bearer|salon[_]?id|customer_ref)\s*[:=]|[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\//iu.test(text);
export function buildJevRequest(input: EvaluationInput) {
  const parsed = inputSchema.parse(input);
  if (!safeText(parsed.message)) throw Error("INVALID_INPUT");
  return { model: JEV_MODEL as typeof JEV_MODEL, state: parsed, questions: Object.fromEntries(
    (Object.keys(choiceSets) as QuestionId[]).map(id => [id, { type: "choice" as const, instructions: instructions[id], criteria: Object.fromEntries(choiceSets[id].map(value => [value, null])) }]),
  ) };
}
const answerSchema = z.object({ type: z.literal("choice"), choice: z.string(), probabilities: z.record(z.string(), z.number().min(0).max(1)), confidence: z.number().min(0).max(1).optional() }).strict();
const responseSchema = z.object({ model: z.literal(JEV_MODEL), answers: z.record(z.string(), answerSchema), usage: z.object({ input_tokens: z.number().int().nonnegative().optional(), output_tokens: z.number().int().nonnegative().optional() }).strict().optional() }).strict();
export function parseJevResponse(raw: unknown): EvaluationResult {
  const data = responseSchema.parse(raw), result = emptyResult("JEV");
  const ids = Object.keys(choiceSets) as QuestionId[];
  if (Object.keys(data.answers).sort().join() !== [...ids].sort().join()) throw Error("INVALID_RESPONSE");
  const values: Record<string, string> = {};
  for (const id of ids) {
    const a = data.answers[id], allowed = [...choiceSets[id]] as string[];
    if (!allowed.includes(a.choice) || Object.keys(a.probabilities).sort().join() !== allowed.sort().join()) throw Error("INVALID_RESPONSE");
    if (Math.abs(Object.values(a.probabilities).reduce((n, x) => n + x, 0) - 1) > 1e-6 || a.probabilities[a.choice] < Math.max(...Object.values(a.probabilities)) - 1e-6) throw Error("INVALID_RESPONSE");
    result.answers[id] = { choice: a.choice, probabilities: a.probabilities, confidence: a.confidence ?? null };
    values[id] = a.choice;
    if (a.confidence === undefined) result.fallbackReasons.push(`MISSING_CONFIDENCE:${id}`);
  }
  result.decision = decisionSchema.parse(values);
  const d = result.decision;
  if (operations.includes(d.operation as typeof operations[number]) && operationSkill(d.operation) !== d.skill) throw Error("INVALID_RESPONSE");
  if (d.shape === "single" && ["multiple", "unclear", "out_of_catalog"].includes(d.operation)) throw Error("INVALID_RESPONSE");
  if (["dependent", "independent"].includes(d.shape) && d.operation !== "multiple") throw Error("INVALID_RESPONSE");
  if (d.metric !== "none" && d.skill !== "financial" && d.skill !== "multiple" && d.skill !== "out_of_catalog" && d.skill !== "unclear") throw Error("INVALID_RESPONSE");
  if (d.inventory !== "none" && !["inventory", "multiple", "unclear"].includes(d.skill)) throw Error("INVALID_RESPONSE");
  if (d.communication !== "none" && !["communication", "multiple", "unclear"].includes(d.skill)) throw Error("INVALID_RESPONSE");
  result.dependencies = d.shape === "single" || d.shape === "out_of_catalog" ? [] : null;
  if (Object.values(d).includes("unclear")) result.fallbackReasons.push("AMBIGUOUS");
  if (d.shape !== "single") result.fallbackReasons.push("UNSUPPORTED_PLAN_OR_OUT_OF_CATALOG");
  result.status = "OK"; result.modelRequested = JEV_MODEL; result.modelReturned = data.model;
  result.usage = { inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null };
  result.estimatedCostUsd = result.usage.inputTokens === null ? null : result.usage.inputTokens * INPUT_USD_PER_MILLION / 1_000_000;
  return result;
}

/** No ambient fetch, SDK import, DB, tools, logging, dotenv loading or automatic fallback. */
export class JevDecisionProvider {
  constructor(private readonly options: {
    transport: typeof fetch;
    credential: () => string | undefined;
    timeoutMs?: number;
    now?: () => number;
    protocol?: JevEvaluationProtocol;
  }) {}
  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const now = this.options.now ?? (() => performance.now()), started = now();
    let result = emptyResult("JEV"), timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const key = this.options.credential()?.trim();
      if (!key) { result.error = "MISSING_KEY"; return result; }
      let body: JevWireRequest;
      try { body = (this.options.protocol?.build ?? buildJevRequest)(input); } catch { result.error = "INVALID_INPUT"; return result; }
      // Never serialize credentials into body, error, result, metadata or logs.
      if (JSON.stringify(body).includes(key)) { result.error = "INVALID_INPUT"; return result; }
      const timeoutMs = this.options.timeoutMs ?? 10_000;
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) { result.error = "INVALID_INPUT"; return result; }
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error("DEADLINE")); }, timeoutMs); });
      const attempt = async () => {
        const response = await this.options.transport(JEV_ENDPOINT, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
        if (controller.signal.aborted) return;
        const headerId = response.headers.get("x-request-id");
        const requestId = headerId && /^[A-Za-z0-9_-]{1,100}$/.test(headerId) && !headerId.includes(key) ? headerId : null;
        if (!response.ok) {
          result.error = response.status === 401 || response.status === 403 ? "AUTH" : response.status === 429 ? "RATE_LIMIT" : "HTTP";
          // Do not read/log an error body that might echo credentials or input.
          return;
        }
        let raw: unknown, hasJson = false;
        let sanitized: ReturnType<typeof sanitizeInvalidJevResponse> | null = null;
        try {
          raw = await response.json(); hasJson = true;
          if (controller.signal.aborted) return;
          // Capture only a whitelisted structural sketch before strict validation.
          sanitized = sanitizeInvalidJevResponse(raw, body);
          result = (this.options.protocol?.parse ?? parseJevResponse)(raw);
          result.requestId = requestId;
        } catch {
          const location = hasJson ? diagnoseInvalidJevResponse(raw, body) : { reason: "MALFORMED_PROVIDER_RESPONSE" as const, path: "$" };
          result.error = "INVALID_RESPONSE";
          result.requestId = requestId;
          result.invalidResponseDiagnostic = { ...location, httpStatus: response.status, requestId,
            sanitizedInvalidResponse: sanitized ?? sanitizeInvalidJevResponse(hasJson ? raw : undefined, body) };
        }
      };
      await Promise.race([attempt(), deadline]);
    } catch { result.error = controller.signal.aborted ? "TIMEOUT" : "NETWORK"; }
    finally {
      if (timer) clearTimeout(timer);
      result.latencyMs = now() - started;
      if (result.error) { result.status = "ERROR"; result.fallbackReasons = [result.error]; }
    }
    return result;
  }
}

/** Explicitly gated factory, unused by CLI/runtime. Key comes ONLY from TYPESAFE_API_KEY. */
export function createJevEvaluationProvider(env: Record<string, string | undefined>, authorization: { allowNetwork: boolean }, transport: typeof fetch): JevDecisionProvider {
  if (!authorization.allowNetwork) throw Error("NETWORK_DISABLED");
  if (env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "false") throw Error("OPENAI_MUST_REMAIN_DISABLED");
  return new JevDecisionProvider({ transport, credential: () => env.TYPESAFE_API_KEY });
}
