import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";
import { orchestratorConfig } from "../src/lib/hq/orchestrator-config";
import { orchestratorAgents } from "@everflare/agents/orchestrator";

// Run with the react-server condition to retain the server-only config boundary.
// Reads saved resources only. Never creates agents, sessions, or inference.
async function main() {
  loadEnvConfig(process.cwd(), true);
  const config = orchestratorConfig();
  if (!config.ready) {
    console.error(config.reason);
    process.exitCode = 1;
    return;
  }
  const client = new OpenAI({ apiKey: config.apiKey, project: config.project,
    baseURL: "https://api.openai.com/v1", maxRetries: 0, timeout: 10000 });
  const checks = await Promise.all(orchestratorAgents.map(async agent => {
    const agentId = config.agentIds[agent];
    try {
      const saved = await client.beta.agents.retrieve(agentId);
      return { agent, agentId, model: saved.model, accessible: saved.id === agentId };
    } catch (error) {
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      return { agent, agentId, accessible: false, status,
        detail: status === 401 || status === 403 ? "Confira chave, projeto e permissão api.agents.read."
          : "Não foi possível comprovar o acesso ao agente." };
    }
  }));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), project: config.project,
    operation: "read-only", checks }, null, 2));
  if (checks.some(check => !check.accessible)) process.exitCode = 1;
}

main().catch(() => {
  console.error("Não foi possível verificar os agentes. Detalhes do fornecedor foram omitidos.");
  process.exitCode = 1;
});
