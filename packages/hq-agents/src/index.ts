import { Agent, Runner, tool, Usage, MaxTurnsExceededError, ModelBehaviorError, type Model, type ModelResponse } from "@openai/agents";
import { z } from "zod";
import { agentCatalog, scenarios, type ScenarioId, type LabResult, type RunStatus, type ToolName } from "./catalog";
import { demoAccountId, executeDemoTool, type ExecutionContext } from "./policy";
export { agentCatalog, scenarios, statusLabels } from "./catalog";
export type { LabResult, ScenarioId } from "./catalog";

type Call = { name: string; args: { accountId?: string; topic?: string } };
const calls: Record<ScenarioId, Call[]> = {
  overview: [{ name: "executive_summary", args: {} }],
  hours: [{ name: "lookup_account", args: { accountId: demoAccountId } }, { name: "search_knowledge", args: { topic: "hours" } }],
  unknown: [{ name: "search_knowledge", args: { topic: "unknown" } }, { name: "prepare_ticket", args: { accountId: demoAccountId } }],
  cross_account: [{ name: "lookup_account", args: { accountId: "demo-other-account" } }],
  payment: [{ name: "confirm_payment", args: {} }],
  loop: [{ name: "executive_summary", args: {} }],
  outage: [{ name: "lookup_account", args: { accountId: demoAccountId } }],
};

// Only a local, scripted Model is exported through this entry point. No real
// OpenAI provider, media upload, free-form input or production repository exists.
class ScenarioModel implements Model {
  turns = 0;
  lastTool = "";
  constructor(private id: ScenarioId, private context: ExecutionContext) {}
  async getResponse(): Promise<ModelResponse> {
    const index = this.turns++;
    const call = calls[this.id][this.id === "loop" ? 0 : index];
    if (call) {
      this.lastTool = call.name;
      return { usage: new Usage(), output: [{ type: "function_call", callId: "local-" + index, name: call.name, arguments: JSON.stringify(call.args) }] };
    }
    const output = this.context.trace.at(-1)?.detail ?? "Cenário sem resultado.";
    return { usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: output }] }] };
  }
  async *getStreamedResponse(): AsyncGenerator<never> {
    throw new Error("Streaming não é utilizado no laboratório.");
  }
}

function toolsFor(context: ExecutionContext) {
  const permitted = agentCatalog.find(a => a.id === context.agent)!.permissions;
  return permitted.map(name => {
    const parameters = name === "lookup_account" || name === "prepare_ticket"
      ? z.object({ accountId: z.string().min(1).max(100) }).strict()
      : name === "search_knowledge"
        ? z.object({ topic: z.string().min(1).max(100) }).strict()
        : z.object({}).strict();
    return tool({
      name, description: "Ferramenta local demonstrativa: " + name,
      parameters, errorFunction: null,
      execute: args => executeDemoTool(context, name as ToolName, args),
    });
  });
}

export async function runLabScenario(input: unknown, options: { signal?: AbortSignal } = {}): Promise<LabResult> {
  const id = z.enum(scenarios.map(s => s.id) as [ScenarioId, ...ScenarioId[]]).parse(input);
  const scenario = scenarios.find(s => s.id === id)!;
  const context: ExecutionContext = { agent: scenario.agent, accountId: demoAccountId, trace: [], needsHuman: false, draftCreated: false, failLookup: id === "outage" };
  const model = new ScenarioModel(id, context);
  const runner = new Runner({ tracingDisabled: true });
  const agent = new Agent({
    name: agentCatalog.find(a => a.id === scenario.agent)!.name,
    instructions: "Laboratório fictício. Use somente ferramentas permitidas e preserve o escopo. Nenhuma resposta representa IA real.",
    model, tools: toolsFor(context),
  });
  const started = Date.now();
  let status: RunStatus = "completed";
  let output = "";
  try {
    options.signal?.throwIfAborted();
    const result = await runner.run(agent, scenario.message, { maxTurns: 4, signal: options.signal });
    status = context.needsHuman ? "needs_human" : "completed";
    output = String(result.finalOutput ?? "Sem resposta final.");
  } catch (error) {
    if (options.signal?.aborted) {
      status = "cancelled"; output = "Execução cancelada.";
    } else if (error instanceof MaxTurnsExceededError) {
      status = "limit"; output = "Execução interrompida após quatro rodadas. Revise o fluxo antes de tentar novamente.";
    } else if (context.trace.some(e => e.status === "blocked") || error instanceof ModelBehaviorError) {
      status = "blocked"; output = "Operação bloqueada. Nenhum dado foi alterado.";
      if (!context.trace.some(e => e.status === "blocked")) context.trace.push({ step: context.trace.length + 1, tool: model.lastTool, status: "blocked", detail: "O SDK recusou uma ferramenta não disponível para este agente." });
    } else {
      status = "failed"; output = "Não foi possível concluir a consulta. Encaminhe para atendimento humano; nenhuma ação foi confirmada.";
    }
  }
  return {
    id: crypto.randomUUID(), scenarioId: id, agent: scenario.agent, status, output,
    trace: context.trace, mode: "simulation", externalCalls: 0, costUsd: 0, turns: model.turns,
    durationMs: Date.now() - started, expectedStatus: scenario.expectedStatus,
    passed: status === scenario.expectedStatus,
  };
}
