import "server-only";
import { orchestratorAgentIds, orchestratorProject, validAgentIds } from "@everflare/agents/orchestrator";

export function orchestratorConfig(env: Record<string, string | undefined> = process.env) {
  // Time-boxed local diagnostic allowance; hosted environments always retain ten.
  const diagnosticUntil = Date.parse(env.HQ_ORCHESTRATOR_DIAGNOSTIC_UNTIL ?? "");
  const remainingDiagnosticMs = diagnosticUntil - Date.now();
  const dailyLimit = env.APP_ENV === "development" && !env.VERCEL_ENV &&
    remainingDiagnosticMs > 0 && remainingDiagnosticMs <= 86400000
      ? env.HQ_ORCHESTRATOR_DIAGNOSTIC_LIMIT === "24" ? 24 : 20 : 10;
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const project = env.HQ_ORCHESTRATOR_PROJECT_ID?.trim() || orchestratorProject;
  const agentIds = {
    TRIAGE: env.HQ_TRIAGE_AGENT_ID?.trim() || orchestratorAgentIds.TRIAGE,
    SALES: env.HQ_SALES_AGENT_ID?.trim() || orchestratorAgentIds.SALES,
    CUSTOMER_SUCCESS: env.HQ_CUSTOMER_SUCCESS_AGENT_ID?.trim() || orchestratorAgentIds.CUSTOMER_SUCCESS,
    PRODUCT: env.HQ_PRODUCT_AGENT_ID?.trim() || orchestratorAgentIds.PRODUCT,
    OPERATIONS: env.HQ_OPERATIONS_AGENT_ID?.trim() || orchestratorAgentIds.OPERATIONS,
    MARKETING: env.HQ_MARKETING_AGENT_ID?.trim() || orchestratorAgentIds.MARKETING,
    CHIEF: env.HQ_CHIEF_AGENT_ID?.trim() || orchestratorAgentIds.CHIEF,
  };
  const reason = env.HQ_ORCHESTRATOR_ENABLED !== "true" ? "O teste aguarda ativação no servidor."
    : !["development", "test", "staging"].includes(env.APP_ENV ?? "") || env.VERCEL_ENV === "production"
      ? "Este primeiro teste está disponível apenas em desenvolvimento ou homologação."
    : !apiKey ? "A chave da OpenAI ainda não foi configurada no servidor."
    : !/^proj_[a-zA-Z0-9_-]+$/.test(project) || !validAgentIds(agentIds)
      ? "Confira o projeto e os sete IDs distintos dos agentes no servidor."
    : "";
  return { ready: !reason, reason, apiKey, project, agentIds, dailyLimit };
}
