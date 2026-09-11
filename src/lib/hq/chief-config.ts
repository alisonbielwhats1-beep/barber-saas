import "server-only";
export function chiefConfig(env: Record<string,string|undefined> = process.env) {
  const amount = Number(env.HQ_CHIEF_MONTHLY_USD);
  const budgetMicros = Number.isFinite(amount) && amount >= 1 && amount <= 20 ? Math.floor(amount * 1000000) : 0;
  const enabled = env.HQ_CHIEF_ENABLED === "true";
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const reason = !enabled ? "O piloto aguarda ativação administrativa." : !apiKey ? "A chave da OpenAI API ainda não foi configurada no servidor." : !budgetMicros ? "Configure um teto mensal entre US$ 1 e US$ 20." : "";
  return { ready: !reason, reason, budgetMicros, apiKey };
}
