"use server";

import { withHq } from "@/lib/hq/access";
import { runLabScenario } from "@everflare/agents";

export async function simulateAgent(scenario: string) {
  // Authorization is deliberately outside the catch: Next redirects must retain
  // their semantics. Do not hold a database transaction while running an agent.
  await withHq(async () => undefined);
  try {
    return { ok: true as const, result: await runLabScenario(scenario) };
  } catch {
    return { ok: false as const, error: "Cenário inválido. Escolha uma das opções do laboratório." };
  }
}
