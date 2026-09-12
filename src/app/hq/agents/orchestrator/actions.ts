"use server";

import { z } from "zod";
import { withHq } from "@/lib/hq/access";
import { checkRateLimit } from "@/lib/rate-limit";
import { orchestratorConfig } from "@/lib/hq/orchestrator-config";
import { runOrchestrator, type OrchestratorResult } from "@everflare/agents/orchestrator";

export async function testOrchestrator(message: unknown): Promise<OrchestratorResult> {
  // Keep redirects intact and finish authorization before any external work.
  const actorId = await withHq(async (_tx, actor) => actor);
  const parsed = z.string().max(2000).trim().min(1).safeParse(message);
  if (!parsed.success) return { ok: false, steps: [], error: "Digite uma mensagem de até 2.000 caracteres." };
  const config = orchestratorConfig();
  if (!config.ready) return { ok: false, steps: [], error: config.reason };
  try {
    for (const rule of [
      { namespace: "hq-orchestrator-minute", identifier: actorId, limit: 1, windowSeconds: 60 },
      { namespace: "hq-orchestrator-day", identifier: config.project, limit: 10, windowSeconds: 86400 },
    ]) {
      const limit = await checkRateLimit({ ...rule, failClosed: true });
      if ((process.env.VERCEL_ENV && limit.source !== "distributed") || !limit.allowed) {
        return { ok: false, steps: [], error: limit.source === "unavailable" || (process.env.VERCEL_ENV && limit.source !== "distributed")
          ? "O controle de consumo está indisponível. Tente novamente mais tarde."
          : `Limite de testes atingido. Tente novamente em ${limit.retryAfterSeconds} segundos.` };
      }
    }
    return await runOrchestrator({ message: parsed.data, apiKey: config.apiKey, project: config.project,
      agentIds: config.agentIds, signal: AbortSignal.timeout(45000) });
  } catch {
    return { ok: false, steps: [], error: "Não foi possível iniciar o teste. Confira a configuração no servidor." };
  }
}
