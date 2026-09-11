import { agentCatalog, type AgentId, type ToolName, type TraceEntry } from "./catalog";

export class PermissionError extends Error {}
export class DependencyError extends Error {}
export type ExecutionContext = {
  agent: AgentId; accountId: string; trace: TraceEntry[]; needsHuman: boolean;
  draftCreated: boolean; failLookup: boolean;
};
export function authorizeTool(context: ExecutionContext, tool: string, accountId?: string) {
  const allowed: readonly string[] = agentCatalog.find(a => a.id === context.agent)?.permissions ?? [];
  if (!allowed.includes(tool) || (accountId !== undefined && accountId !== context.accountId)) {
    context.trace.push({ step: context.trace.length + 1, tool, status: "blocked", detail: "Operação recusada pela permissão ou pelo escopo da conta." });
    throw new PermissionError("Operação não autorizada.");
  }
}

// This repository is deliberately fictional. Production adapters must recheck
// account/tenant identity in their own transaction; prompts do not authorize access.
export const demoAccountId = "demo-aurora";
export async function executeDemoTool(context: ExecutionContext, tool: ToolName, args: { accountId?: string; topic?: string }) {
  if ((tool === "lookup_account" || tool === "prepare_ticket") && !args.accountId) {
    throw new PermissionError("Conta obrigatória.");
  }
  authorizeTool(context, tool, args.accountId);
  let result: string;
  switch (tool) {
    case "executive_summary":
      result = "Base fictícia: 2 contas, 1 acompanhamento pendente. Estúdio Aurora precisa de ajuda na configuração. Nenhum dado real foi consultado.";
      break;
    case "lookup_account":
      if (context.failLookup) {
        context.trace.push({ step: context.trace.length + 1, tool, status: "failed", detail: "Consulta fictícia indisponível." });
        throw new DependencyError("Consulta indisponível.");
      }
      result = "Conta fictícia Estúdio Aurora. Identidade restrita a esta conversa.";
      break;
    case "search_knowledge":
      result = args.topic === "hours"
        ? "Orientação demonstrativa KB-DEMO-001 v1: confira o horário geral do estabelecimento e a jornada individual de cada profissional. Esta é uma amostra de conhecimento, não um atendimento real."
        : "Nenhuma orientação revisada encontrada. Encaminhe para atendimento humano.";
      break;
    case "prepare_ticket":
      context.needsHuman = true;
      // A retry produces the same draft within the execution, never a real ticket.
      context.draftCreated = true;
      result = "Rascunho fictício preparado para revisão humana. Nenhum ticket foi gravado ou enviado.";
      break;
  }
  context.trace.push({ step: context.trace.length + 1, tool, status: "allowed", detail: result });
  return result;
}
