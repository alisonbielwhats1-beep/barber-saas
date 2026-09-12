import "server-only";
import { orchestratorAgentIds, orchestratorProject } from "@everflare/agents/orchestrator";

export function orchestratorConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const project = env.HQ_ORCHESTRATOR_PROJECT_ID?.trim() || orchestratorProject;
  const agentIds = {
    TRIAGE: env.HQ_TRIAGE_AGENT_ID?.trim() || orchestratorAgentIds.TRIAGE,
    PRODUCT: env.HQ_PRODUCT_AGENT_ID?.trim() || orchestratorAgentIds.PRODUCT,
    CHIEF: env.HQ_CHIEF_AGENT_ID?.trim() || orchestratorAgentIds.CHIEF,
  };
  const reason = env.HQ_ORCHESTRATOR_ENABLED !== "true" ? "O teste aguarda ativação no servidor."
    : !["development", "test", "staging"].includes(env.APP_ENV ?? "") || env.VERCEL_ENV === "production"
      ? "Este primeiro teste está disponível apenas em desenvolvimento ou homologação."
    : !apiKey ? "A chave da OpenAI ainda não foi configurada no servidor."
    : !/^proj_[a-zA-Z0-9_-]+$/.test(project) || Object.values(agentIds).some(id => !/^agent_[a-zA-Z0-9_-]+$/.test(id)) || new Set(Object.values(agentIds)).size !== 3
      ? "Confira o projeto e os três IDs distintos dos agentes no servidor."
    : "";
  return { ready: !reason, reason, apiKey, project, agentIds };
}
