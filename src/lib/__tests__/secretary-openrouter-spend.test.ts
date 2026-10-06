import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OPENROUTER_CHAT_URL, chatOutboundBody } from '../../../packages/salon-secretary/src/openai-cost-guard';
import { secretaryModelProfile } from '../../../packages/salon-secretary/src/model-registry';
import {
  OPENROUTER_RESERVATION_PRICING_SHA256, PROGRAM_SPEND_BASENAME, PROGRAM_SPEND_WALLETS, guardPaidFetch, openRouterChatEstimator, openRouterCostEstimator, programSpendEstimator,
  programSpendTotals, programSpendWalletOfModel, responsesEstimator,
} from '../../../packages/salon-secretary/evaluation/program-spend';
import {
  FREE_USE_DEEPSEEK_MISSION, FREE_USE_DEEPSEEK_PRICING, FREE_USE_DEEPSEEK_PRICING_SHA256, FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION, FreeUseBudget, freeUseMission, freeUseMissionPricing,
} from '../../../packages/salon-secretary/evaluation/free-use-budget';

// Offline only: temporary ledgers/journals and fake transports; the network and the real program ledger are never touched.
const MODEL = 'deepseek/deepseek-v4.1-flash';
const chat = () => ({ model: MODEL, messages: [{ role: 'system', content: 'synthetic instructions ' + 'x'.repeat(12_000) }, { role: 'user', content: 'synthetic message' }],
  tools: [{ type: 'function', function: { name: 'upsert_action_draft', description: 'local', parameters: { type: 'object' }, strict: true } }],
  tool_choice: { type: 'function', function: { name: 'upsert_action_draft' } }, parallel_tool_calls: false, max_tokens: 8192, stream: false, store: false });
const outbound = () => JSON.stringify(chatOutboundBody(chat() as Parameters<typeof chatOutboundBody>[0], secretaryModelProfile(MODEL)));
const wire = (body = outbound()) => ({ method: 'POST', body });
const usage = { prompt_tokens: 20_000, prompt_tokens_details: { cached_tokens: 5_000 }, completion_tokens: 700, completion_tokens_details: { reasoning_tokens: 0 }, total_tokens: 20_700, cost: 0.0012 };
const directories: string[] = [];
const dir = () => { const directory = mkdtempSync(join(tmpdir(), 'openrouter-spend-')); directories.push(directory); return directory; };
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('DeepSeek spend admission (offline)', () => {
  it('the sealed estimator admits only the C4 body as it leaves the cost guard, priced at the highest default-route rates', () => {
    expect(programSpendEstimator('openrouter-chat')).toMatchObject({ name: 'openrouter-chat', models: [MODEL], pricingSha256: FREE_USE_DEEPSEEK_PRICING_SHA256 });
    const body = outbound(), estimate = openRouterChatEstimator.worstCase(OPENROUTER_CHAT_URL, wire(body));
    expect(estimate).toEqual({ estimator: 'openrouter-chat', model: MODEL, bodyBytes: Buffer.byteLength(body), maxOutputTokens: 8192,
      worstCaseMicroUsd: Math.ceil((Buffer.byteLength(body) + 8192) * 0.45 + 8192 * 2.40), pricingSha256: FREE_USE_DEEPSEEK_PRICING_SHA256 });
    for (const [input, init] of [['https://api.openai.com/v1/responses', wire()], [OPENROUTER_CHAT_URL, wire(JSON.stringify(chat()))],
      [OPENROUTER_CHAT_URL, wire(JSON.stringify({ ...JSON.parse(outbound()), provider: { order: ['any'] } }))], [OPENROUTER_CHAT_URL, { method: 'GET', body: outbound() }]] as const)
      expect(() => openRouterChatEstimator.worstCase(input, init)).toThrow('PROGRAM_SPEND_WIRE');
    expect(() => openRouterChatEstimator.worstCase(OPENROUTER_CHAT_URL, wire(), { agent: true })).toThrow('PROGRAM_SPEND_WIRE');
    expect(openRouterChatEstimator.actual({ usage })).toEqual({ usage: { input: 20_000, cached: 5_000, output: 700, reasoning: 0 }, chargedMicroUsd: Math.ceil(20_000 * 0.45 + 700 * 2.40) });
  });

  it('OpenRouter calls go to their own wallet and settle at the cost OpenRouter reports; the OpenAI wallet keeps its old rows only', async () => {
    expect(programSpendWalletOfModel(MODEL)).toBe('openrouter'); expect(programSpendWalletOfModel('gpt-6-luna')).toBe('openai');
    expect(PROGRAM_SPEND_WALLETS.openrouter.capHistory.at(-1)?.microUsd).toBe(2_400_000);
    const body = outbound(), estimate = openRouterCostEstimator.worstCase(OPENROUTER_CHAT_URL, wire(body));
    expect(estimate).toEqual({ estimator: 'openrouter-cost', model: MODEL, bodyBytes: Buffer.byteLength(body), maxOutputTokens: 8192,
      worstCaseMicroUsd: Math.ceil((Buffer.byteLength(body) + 8192) * 0.45 + 8192 * 2.40), pricingSha256: OPENROUTER_RESERVATION_PRICING_SHA256 });
    expect(openRouterCostEstimator.actual({ usage })).toEqual({ usage: { input: 20_000, cached: 5_000, output: 700, reasoning: 0, costMicroUsd: 1200 }, chargedMicroUsd: 1200 });
    expect(openRouterCostEstimator.actual({ usage: { ...usage, cost: undefined } })).toBeNull();
    const ledger = join(dir(), PROGRAM_SPEND_WALLETS.openrouter.basename), transport = async () => new Response(JSON.stringify({ id: 'gen-synthetic', object: 'chat.completion', usage }), { status: 200 });
    const paid = guardPaidFetch('golden', transport, { ledger, run: 'golden:deepseek-offline', estimator: openRouterCostEstimator });
    expect((await paid(OPENROUTER_CHAT_URL, wire())).status).toBe(200);
    const totals = programSpendTotals(ledger);
    expect(totals).toMatchObject({ wallet: 'openrouter', ledger: 'program-spend-openrouter-20261004', capMicroUsd: 2_400_000 });
    expect(totals.byRun['golden:deepseek-offline']?.spentMicroUsd).toBe(1200);
    // Wallets admit only their own estimators for new reservations.
    expect(() => guardPaidFetch('golden', transport, { ledger, run: 'x', estimator: responsesEstimator })).toThrow('PROGRAM_SPEND_ESTIMATOR');
    const openai = join(dir(), PROGRAM_SPEND_BASENAME);
    for (const estimator of [openRouterChatEstimator, openRouterCostEstimator]) expect(() => guardPaidFetch('golden', transport, { ledger: openai, run: 'x', estimator })).toThrow('PROGRAM_SPEND_ESTIMATOR');
  });

  it('runs under its own mission (US$ 50 of reservations, owner-approved 04/10) with its own pricing; the Luna wire is refused there', () => {
    expect(freeUseMission(FREE_USE_DEEPSEEK_MISSION).capMicroUsd).toBe(75_000_000);
    expect(freeUseMissionPricing(FREE_USE_DEEPSEEK_MISSION)).toEqual({ pricing: FREE_USE_DEEPSEEK_PRICING, pricingSha256: FREE_USE_DEEPSEEK_PRICING_SHA256 });
    expect(freeUseMissionPricing(FREE_USE_RELIABILITY_MISSION).pricingSha256).toBe(FREE_USE_PRICING_SHA256);
    const journal = join(dir(), 'deepseek-mission.jsonl'), body = outbound();
    expect(() => new FreeUseBudget(journal, 'binding', 3, 8192, FREE_USE_PRICING_SHA256, FREE_USE_DEEPSEEK_MISSION)).toThrow('FREE_USE_BUDGET_CONFIG');
    const budget = new FreeUseBudget(journal, 'binding', 3, 8192, FREE_USE_DEEPSEEK_PRICING_SHA256, FREE_USE_DEEPSEEK_MISSION);
    expect(() => budget.reserve('case', 1, 'https://api.openai.com/v1/responses', wire())).toThrow('FREE_USE_WIRE_REQUEST');
    expect(() => budget.reserve('case', 1, OPENROUTER_CHAT_URL, wire(JSON.stringify(chat())))).toThrow();
    expect(() => budget.reserve('case', 1, OPENROUTER_CHAT_URL, wire(), { agent: true })).toThrow('FREE_USE_WIRE_REQUEST');
    expect(existsSync(journal)).toBe(false);
    expect(budget.reserve('case', 1, OPENROUTER_CHAT_URL, wire(body)).reservedMicroUsd).toBe(Math.ceil((Buffer.byteLength(body) + 8192) * 0.45 + 8192 * 2.40));
    expect(JSON.parse(readFileSync(journal, 'utf8').trim())).toMatchObject({ mission: FREE_USE_DEEPSEEK_MISSION, model: MODEL, maxOutputTokens: 8192, pricingSha256: FREE_USE_DEEPSEEK_PRICING_SHA256 });
    expect(budget.requests).toBe(1);
  });
});
