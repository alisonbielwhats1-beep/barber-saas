import { createPaidModel, secretaryGuardedFetch, type Model, type ModelRequest, type ModelResponse } from "@everflair/salon-secretary";
import { appendRecordedServicesFrames, createRecordedServicesModel } from "../../packages/salon-secretary/src/recorded-services-model";
import { assertSecretaryAgentModelRequest } from "../../packages/salon-secretary/src/openai-cost-guard";
import { AGENT_PLAN_TOOL } from "../../packages/salon-secretary/src/agent-plan";
import type { AgentLookupCall } from "../../packages/salon-secretary/src/agent-tools";
import type { AgentDirectory, AgentLookupExecutor } from "../../packages/salon-secretary/src/agent-context";

/** C5 agent test harness (docs/c5-spike/11-especificacao-agente.md §8.3). Offline only: no network, no database, no real model.
 * `createAgentFakeModel`: a Model that serves ONE scripted frame per round from the recorded-frames queue (recorded-services-model.ts,
 * appendable), after checking each request with the cost guard's own SDK-boundary function and the round's expectations; a
 * `status` makes it throw the way the SDK does for an incomplete/failed response (ModelBehaviorError), after the frame is consumed.
 * Mismatches are collected (a test asserts none) and also make the call fail. `createFakeAgentExecutor`: the app's lookup executor
 * stand-in (binds the directory refs, records each round and the compaction it was asked for). `agentSdkModel`: the real SDK
 * Responses model behind the {agent:true} guarded fetch, for wire tests over a stubbed global fetch. Synthetic salons and names only. */
export type AgentItemKind = "reasoning" | "commentary" | "function_call" | "function_call_result" | "other";
export type AgentFakeExpect = { readonly tool_choice?: "required" | "propor_plano"; readonly parallel?: boolean; readonly items_after_messages?: readonly AgentItemKind[];
  readonly include?: readonly string[]; readonly effort?: "medium" | "high"; readonly max_output?: number };
/** One round: the items the model emits; `status` throws like the SDK; `providerStatus` is returned as the response status instead;
 * `fail` simulates transport (TRANSPORT) or a call that only ends with its signal (HANG); `waitMs` delays the answer (fake timers). */
export type AgentFakeRound = { readonly output: ModelResponse["output"]; readonly expect?: AgentFakeExpect; readonly status?: "incomplete" | "failed";
  readonly providerStatus?: string; readonly fail?: "TRANSPORT" | "HANG"; readonly waitMs?: number };
export type AgentFakeModel = Model & { readonly requests: ModelRequest[]; readonly mismatches: string[]; append(...rounds: AgentFakeRound[]): void };
type OutputItem = ModelResponse["output"][number];

/** Kinds of the input items after the leading system/user messages, in order. */
export function agentItemKinds(input: ModelRequest["input"]): AgentItemKind[] {
  if (typeof input === "string") return [];
  const items = input as unknown as readonly Record<string, unknown>[];
  const first = items.findIndex(item => !((item.type === undefined || item.type === "message") && (item.role === "system" || item.role === "user")));
  return (first < 0 ? [] : items.slice(first)).map(item => item.type === "reasoning" ? "reasoning" : item.type === "message" ? "commentary"
    : item.type === "function_call" ? "function_call" : item.type === "function_call_result" ? "function_call_result" : "other");
}
const abortable = (signal: AbortSignal | undefined, ms: number | null) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const timer = ms === null ? undefined : setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});
export function createAgentFakeModel(rounds: readonly AgentFakeRound[], rawUsage?: Record<string, unknown>): AgentFakeModel {
  const script = [...rounds], frames = createRecordedServicesModel(rounds.map(round => round.output), rawUsage), requests: ModelRequest[] = [], mismatches: string[] = [];
  const check = (index: number, request: ModelRequest, round: AgentFakeRound) => {
    const settings = request.modelSettings, wanted = round.expect ?? {}, tag = `r${index + 1}`;
    try { assertSecretaryAgentModelRequest(request, { round: (index + 1) as 1 | 2 | 3, forced: settings.toolChoice === AGENT_PLAN_TOOL }); }
    catch (error) { mismatches.push(`${tag}:guard:${(error as Error).message}`); }
    const same = (field: string, actual: unknown, expected: unknown) => { if (expected !== undefined && JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push(`${tag}:${field}`); };
    same("tool_choice", settings.toolChoice, wanted.tool_choice); same("parallel", settings.parallelToolCalls, wanted.parallel);
    same("items_after_messages", agentItemKinds(request.input), wanted.items_after_messages);
    same("include", (settings.providerData as { include?: unknown } | undefined)?.include, wanted.include);
    same("effort", settings.reasoning?.effort, wanted.effort); same("max_output", settings.maxTokens, wanted.max_output);
  };
  return {
    requests, mismatches,
    append(...more: AgentFakeRound[]) { script.push(...more); appendRecordedServicesFrames(frames, more.map(round => round.output)); },
    async getResponse(request: ModelRequest): Promise<ModelResponse> {
      const index = requests.push(request) - 1, round = script[index];
      if (!round) throw Error("FAKE_SCRIPT_EXHAUSTED");
      const before = mismatches.length;
      check(index, request, round);
      const response = await frames.getResponse(request);
      if (mismatches.length > before) throw Error("FAKE_EXPECTATION");
      if (round.waitMs) await abortable(request.signal, round.waitMs);
      if (round.fail === "HANG") await abortable(request.signal, null);
      if (round.fail === "TRANSPORT") throw Object.assign(new Error("FAKE_TRANSPORT"), { name: "APIConnectionError" });
      if (round.status) throw Object.assign(new Error("FAKE_TERMINAL_STATE"), { name: "ModelBehaviorError" });
      return { ...response, providerData: { ...response.providerData, model: "gpt-6-luna", status: round.providerStatus ?? "completed" } };
    },
    async *getStreamedResponse(): AsyncGenerator<never> { throw Error("STREAM_NOT_SUPPORTED"); },
  };
}

/** Protocol items as the SDK converts a Responses output (openaiResponsesConverter convertToOutputItem). */
export const fakeReasoning = (id: string, encrypted: string | null = `cifrado-${id}`): OutputItem =>
  ({ type: "reasoning", id, content: [], providerData: encrypted === null ? { id, type: "reasoning" } : { id, type: "reasoning", encrypted_content: encrypted } });
export const fakeCommentary = (id: string, text: string, phase: "commentary" | "final_answer" | null = "commentary"): OutputItem => phase
  ? { type: "message", id, role: "assistant", status: "completed", phase, content: [{ type: "output_text", text }], providerData: { phase } }
  : { type: "message", id, role: "assistant", status: "completed", content: [{ type: "output_text", text }] };
export const fakeCall = (name: string, args: unknown, callId: string): OutputItem =>
  ({ type: "function_call", id: `fc_${callId}`, callId, name, arguments: typeof args === "string" ? args : JSON.stringify(args), status: "completed", providerData: { id: `fc_${callId}`, type: "function_call" } });
export const fakePlanCall = (plan: unknown, callId: string) => fakeCall(AGENT_PLAN_TOOL, plan, callId);

/** Synthetic plans: a talk answer (no action) and one read action. */
export const talkPlan = (resposta = "Resposta sintética do teste.") => ({ resultado: "CONVERSA", resposta, acoes: [], acoes_fora: 0, pergunta: null });
export const readPlan = (dia = "2031-05-06") => ({ resultado: "PLANO", resposta: null, acoes_fora: 0, pergunta: null, acoes: [{ chave: "leitura", operacao: "appointment.list",
  citacao_acao: "trecho sintético", atendimento: null, cliente: null, profissional: "p1", novo_profissional: null, servicos: null, inicio: null, fim: null, dia, motivo: null,
  recorrencia: null, depende_de: [], ocupa_horario_de: null, bases: [{ campo: "dia", tipo: "DITO", ref: null, citacao: "trecho" }], premissas: [] }] });

/** A synthetic salon (two professionals, two services) for the loop tests; refs bound in this order. */
export const FAKE_DIRECTORY: AgentDirectory = { today: { date: "2031-05-06", weekday: "terça-feira", timezone: "America/Belem" },
  professionals: [{ ref: "p1", nome: "Ximena Guedes" }, { ref: "p2", nome: "Tobias Uchoa" }],
  services: [{ ref: "s1", nome: "Escova Modelada", duracao_min: 45 }, { ref: "s2", nome: "Hidratação Capilar", duracao_min: 30 }] };
export type FakeExecutorRound = { readonly calls: readonly AgentLookupCall[]; readonly compact: boolean };
export type FakeExecutor = AgentLookupExecutor & { readonly rounds: FakeExecutorRound[] };
export type FakeExecutorOptions = { readonly directory?: AgentDirectory | "AGENT_DIRECTORY_TRUNCATED" | "AGENT_UNAVAILABLE";
  readonly answer?: (call: AgentLookupCall, compact: boolean, round: number) => string; readonly throws?: boolean };
export function createFakeAgentExecutor(options: FakeExecutorOptions = {}): FakeExecutor {
  const rounds: FakeExecutorRound[] = [];
  return {
    rounds,
    async directory(context) {
      if (options.directory === "AGENT_DIRECTORY_TRUNCATED" || options.directory === "AGENT_UNAVAILABLE") return { ok: false, code: options.directory };
      const directory = options.directory ?? FAKE_DIRECTORY;
      for (const professional of directory.professionals) context.binding.bind("p", `prof-${professional.ref}`, { name: professional.nome });
      for (const service of directory.services) context.binding.bind("s", `serv-${service.ref}`, { name: service.nome, durationMin: service.duracao_min });
      return { ok: true, directory };
    },
    async round(calls, _context, roundOptions?: { readonly compact?: boolean }) {
      const compact = roundOptions?.compact === true;
      rounds.push({ calls: [...calls], compact });
      if (options.throws) throw Error("FAKE_EXECUTOR_DOWN");
      return calls.map(call => options.answer?.(call, compact, rounds.length) ?? JSON.stringify({ consulta: call.name, rodada: rounds.length }));
    },
  };
}

/** Real SDK Responses model behind the {agent:true} guarded fetch (what the model factory passes when SALON_SECRETARY_AGENT is on;
 * until createPaidModel takes the option, the client's fetch is swapped here). The test stubs the global fetch. */
export const SDK_CONFIG = { SALON_SECRETARY_ALLOW_PAID_CALLS: "true", SALON_SECRETARY_MODEL: "gpt-6-luna", SALON_SECRETARY_OPENAI_API_KEY: "synthetic-offline-not-a-key",
  SALON_SECRETARY_OPENAI_PROJECT: "proj_offline" };
export async function agentSdkModel(): Promise<Model> {
  const model = await createPaidModel(SDK_CONFIG);
  (model as unknown as { _client: { fetch: typeof fetch } })._client.fetch = secretaryGuardedFetch("gpt-6-luna", { agent: true });
  return model;
}
/** Raw Responses output items and body (what the fake network answers). */
export const httpReasoning = (id: string) => ({ id, type: "reasoning", summary: [], encrypted_content: `cifrado-${id}` });
export const httpCommentary = (id: string, text: string) => ({ id, type: "message", role: "assistant", status: "completed", phase: "commentary", content: [{ type: "output_text", text, annotations: [] }] });
export const httpCall = (name: string, args: unknown, callId: string) => ({ id: `fc_${callId}`, type: "function_call", call_id: callId, name, arguments: JSON.stringify(args), status: "completed" });
export const responsesJson = (index: number, output: readonly unknown[], extra: { readonly status?: string; readonly usage?: Record<string, unknown> } = {}) =>
  new Response(JSON.stringify({ id: `resp_${index}`, object: "response", created_at: 0, status: extra.status ?? "completed", model: "gpt-6-luna", output,
    usage: extra.usage ?? { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }), { status: 200, headers: { "content-type": "application/json" } });
