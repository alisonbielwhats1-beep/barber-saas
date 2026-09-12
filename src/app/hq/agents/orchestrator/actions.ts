"use server";

import { z } from "zod";
import { withHq } from "@/lib/hq/access";
import { checkRateLimit } from "@/lib/rate-limit";
import { orchestratorConfig } from "@/lib/hq/orchestrator-config";
import { runOrchestrator, type OrchestratorResult } from "@everflare/agents/orchestrator";
import { openConversation, sealConversation } from "@/lib/hq/orchestrator-conversation";
import { orchestratorKnowledge } from "@/lib/hq/orchestrator-knowledge";
import { reserveLocalOrchestratorAttempt } from "@/lib/hq/orchestrator-local-quota";

const optionsSchema = z.object({
  mode: z.enum(["customer", "internal"]).default("customer"),
  intent: z.enum(["continue", "reclassify", "review"]).default("continue"),
  conversationToken: z.string().min(1).max(800000).optional(),
}).strict();

export async function testOrchestrator(message: unknown, options: unknown = {}): Promise<OrchestratorResult> {
  // Keep redirects intact and finish authorization before any external work.
  const actorId = await withHq(async (_tx, actor) => actor);
  const parsed = z.string().max(2000).trim().min(1).safeParse(message);
  if (!parsed.success) return { ok: false, steps: [], error: "Digite uma mensagem de até 2.000 caracteres." };
  const config = orchestratorConfig();
  if (!config.ready) return { ok: false, steps: [], error: config.reason };
  const request = optionsSchema.safeParse(options);
  if (!request.success) return { ok: false, steps: [], error: "Opções de conversa inválidas." };
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  if (secret.length < 32) return { ok: false, steps: [], error: "Configure o segredo de autenticação do laboratório no servidor." };
  const registry = JSON.stringify([config.project, config.agentIds]);
  let conversation;
  try {
    conversation = request.data.conversationToken ? openConversation(request.data.conversationToken, actorId, registry, secret) : undefined;
  } catch {
    return { ok: false, steps: [], error: "Conversa inválida ou expirada. Inicie uma nova simulação." };
  }
  if (conversation?.featureIntake?.status === "prepared") {
    return { ok: false, steps: [], error: "A recomendação desta sugestão já está pronta para sua avaliação. Inicie outra conversa para um novo assunto." };
  }
  if (conversation && (conversation.history.length >= 6 || conversation.pendingApproval)) {
    return { ok: false, steps: [], error: conversation.pendingApproval
      ? "Esta simulação aguarda aprovação humana. Nenhuma decisão foi executada. Inicie outra conversa para um novo teste."
      : "Esta conversa atingiu seis mensagens. Inicie outra simulação." };
  }
  try {
    for (const rule of [
      { namespace: "hq-orchestrator-minute", identifier: actorId, limit: 1, windowSeconds: 60 },
      { namespace: "hq-orchestrator-day", identifier: config.project, limit: config.dailyLimit, windowSeconds: 86400 },
    ]) {
      const limit = await checkRateLimit({ ...rule, failClosed: true });
      if ((process.env.VERCEL_ENV && limit.source !== "distributed") || !limit.allowed) {
        return { ok: false, steps: [], error: limit.source === "unavailable" || (process.env.VERCEL_ENV && limit.source !== "distributed")
          ? "O controle de consumo está indisponível. Tente novamente mais tarde."
          : `Limite de testes atingido. Tente novamente em ${limit.retryAfterSeconds} segundos.` };
      }
    }
    if (process.env.APP_ENV === "development" && !process.env.VERCEL_ENV) {
      const reservation = await reserveLocalOrchestratorAttempt(config.project, actorId, config.dailyLimit);
      if (reservation !== "reserved") return { ok: false, steps: [], error: reservation === "unavailable"
        ? "O registro local de consumo está indisponível. Nenhuma sessão foi iniciada."
        : reservation === "daily" ? "O limite diário do laboratório foi atingido, incluindo os testes anteriores ao reinício."
        : "Aguarde um minuto entre as mensagens de teste." };
    }
    const { conversation: next, ...result } = await runOrchestrator({ message: parsed.data, apiKey: config.apiKey, project: config.project,
      agentIds: config.agentIds, signal: AbortSignal.timeout(45000), mode: request.data.mode, intent: request.data.intent, conversation,
      knowledge: orchestratorKnowledge() });
    return next && result.ok ? { ...result, conversationToken: sealConversation(next, actorId, registry, secret) } : result;
  } catch {
    return { ok: false, steps: [], error: "Não foi possível iniciar o teste. Confira a configuração no servidor." };
  }
}
