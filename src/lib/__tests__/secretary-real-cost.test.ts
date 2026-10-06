import { describe, expect, it, vi } from "vitest";
import { modelCallUsage } from "@everflair/salon-secretary";
type ModelResponse = NonNullable<Parameters<typeof modelCallUsage>[2]>;

/** Owner decision 06/10/2026: the credit charges x10 on the REAL cost of each call, the cost OpenRouter reports in `usage.cost`
 * (the SDK keeps the raw response in providerData). Nothing in the request changes. */
const created: Record<string, unknown>[] = [];
vi.mock("../prisma-tenant", () => ({ withTenant: async (_a: unknown, fn: (tx: unknown) => unknown) => fn({ auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; } } }) }));
import { usageRecorder } from "../salon-secretary-usage";

const response = (usage: Record<string, unknown>) => ({ usage: undefined, output: [], providerData: { model: "deepseek/deepseek-v4.1-flash", usage } } as unknown as ModelResponse);
const chatUsage = { prompt_tokens: 11_000, completion_tokens: 220, total_tokens: 11_220, prompt_tokens_details: { cached_tokens: 9_900 } };

describe("the call's real cost", () => {
  it("is read from OpenRouter's usage.cost (USD) into micro-USD, rounded up", () => {
    expect(modelCallUsage("deepseek/deepseek-v4.1-flash", "SUCCEEDED", response({ ...chatUsage, cost: 0.0005996 }))).toMatchObject({ cost_micro_usd: 600, input_tokens: 11_000 });
  });
  it("is absent when the provider does not report one (OpenAI) or reports something unusable", () => {
    expect(modelCallUsage("deepseek/deepseek-v4.1-flash", "SUCCEEDED", response(chatUsage))).not.toHaveProperty("cost_micro_usd");
    for (const cost of [-1, "0.1", Number.NaN, 50]) expect(modelCallUsage("deepseek/deepseek-v4.1-flash", "SUCCEEDED", response({ ...chatUsage, cost }))).not.toHaveProperty("cost_micro_usd");
  });
  it("reaches the usage row the credit charges from", async () => {
    const record = usageRecorder({ salonId: "s", userId: "u" }, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "deepseek/deepseek-v4.1-flash");
    const started = modelCallUsage("deepseek/deepseek-v4.1-flash", "STARTED"), finished = modelCallUsage("deepseek/deepseek-v4.1-flash", "SUCCEEDED", response({ ...chatUsage, cost: 0.0006 }));
    await record({ ...started, attempt: 1, purpose: "INTERPRETATION" });
    await record({ ...finished, attempt: 1, purpose: "INTERPRETATION" });
    expect(created.at(-1)).toMatchObject({ action: "MODEL_CALL_FINISHED", metadata: expect.objectContaining({ cost_micro_usd: 600 }) });
  });
});
