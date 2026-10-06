/* eslint-disable @typescript-eslint/no-require-imports -- Native Node preload runs as CommonJS before application initialization. */
/** Extra guard for the single-process staging smoke. No prompts/credentials logged. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { observationQueue, observeConsumedResponse } = require('./secretary-passive-observer.cjs');
const MAX_ATTEMPTS = 20;
const MAX_INPUT_TOKENS_UPPER = 64000;
const PROTOCOL_OVERHEAD_TOKENS = 8192;
const MAX_BODY_BYTES = MAX_INPUT_TOKENS_UPPER - PROTOCOL_OVERHEAD_TOKENS;
const MAX_OUTPUT_TOKENS = 8192;
const RESERVED_MICRO_USD = 35000;
// Verified official standard tariff 2026-09-26, USD per million tokens.
// Whole text-only JSON UTF8 bytes + framing bound input; no media/server state.
const rates = Object.freeze({ input: .10, cached: .01, cacheWrite: .125, output: .50 });
function safeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const valid = n => Number.isSafeInteger(n) && n >= 0;
  if (!valid(usage.input_tokens) || !valid(usage.output_tokens)) return null;
  // Conservative estimate: charge all input at the highest input/cache-write rate.
  return { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
    estimated_usd_upper: (usage.input_tokens * rates.cacheWrite + usage.output_tokens * rates.output) / 1e6 };
}
function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_ATTEMPTS) throw Error('STAGING_BUDGET_CONFIG');
}
function journalState(journal, limit) {
  validateLimit(limit);
  // Missing/truncated/unrecognized journals never become a fresh session.
  const bytes = fs.readFileSync(journal), raw = bytes.toString('utf8');
  if (raw && !raw.endsWith('\n')) throw Error('STAGING_BUDGET_JOURNAL');
  let records;
  try { records = raw.split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch { throw Error('STAGING_BUDGET_JOURNAL'); }
  const starts = new Set();
  for (const row of records) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id ||
        !['STARTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(row.status)) throw Error('STAGING_BUDGET_JOURNAL');
    if (row.status === 'STARTED') {
      if (starts.has(row.id) || row.reserved_estimated_usd_upper !== RESERVED_MICRO_USD / 1e6) throw Error('STAGING_BUDGET_JOURNAL');
      starts.add(row.id);
    } else if (!starts.has(row.id)) throw Error('STAGING_BUDGET_JOURNAL');
  }
  const used = starts.size, remaining = Math.max(0, limit - used);
  return { scope: 'this_journal_only', project_remaining_usd: null, limit, used, remaining,
    reserved_estimated_usd_upper: used * RESERVED_MICRO_USD / 1e6,
    remaining_reservation_usd_upper: remaining * RESERVED_MICRO_USD / 1e6,
    output_cap: MAX_OUTPUT_TOKENS, input_tokens_upper_cap: MAX_INPUT_TOKENS_UPPER,
    body_bytes_cap: MAX_BODY_BYTES, journal_sha256: crypto.createHash('sha256').update(bytes).digest('hex'), journal_bytes: bytes.length };
}
function budgetSnapshot(journal, options = {}) { return journalState(journal, options.limit ?? MAX_ATTEMPTS); }
function textOnly(payload) {
  const allowed = ['model','instructions','input','tools','tool_choice','parallel_tool_calls','max_output_tokens','store','stream','include'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !allowed.includes(key))) return false;
  if (payload.instructions !== undefined && typeof payload.instructions !== 'string' ||
      payload.parallel_tool_calls !== undefined && payload.parallel_tool_calls !== false ||
      payload.include !== undefined && (!Array.isArray(payload.include) || payload.include.length)) return false;
  const input = payload.input;
  if (typeof input === 'string') return true;
  if (!Array.isArray(input)) return false;
  return input.every(item => item && typeof item === 'object' && !Array.isArray(item) &&
    (item.type === undefined || item.type === 'message') && ['user','system'].includes(item.role) &&
    Object.keys(item).every(key => ['type','role','content'].includes(key)) &&
    (typeof item.content === 'string' || Array.isArray(item.content) && item.content.every(part =>
      part && typeof part === 'object' && part.type === 'input_text' && typeof part.text === 'string' &&
      Object.keys(part).every(key => ['type','text'].includes(key)))));
}
function guardedFetch(original, journal, options = {}) {
  const limit = options.limit ?? MAX_ATTEMPTS;
  validateLimit(limit);
  const append = value => fs.appendFileSync(journal, JSON.stringify(value) + '\n', { mode: 0o600 });
  const observations = observationQueue();
  const guarded = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    let provider;try { provider = new URL(url).hostname === 'api.openai.com'; } catch { provider = false; }
    if (!provider) return original(input, init);
    // Admission inspects the already serialized SDK body. Never clone/consume a Request stream.
    const body = init?.body;
    if (url !== 'https://api.openai.com/v1/responses' || typeof body !== 'string' ||
      (init?.method ?? (input instanceof Request ? input.method : '')).toUpperCase() !== 'POST' ||
      Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw Error('STAGING_BUDGET_REQUEST');
    let payload;
    try { payload = JSON.parse(body); } catch { throw Error('STAGING_BUDGET_REQUEST'); }
    if (!textOnly(payload) || payload.model !== 'gpt-6-luna' || payload.store !== false || payload.stream !== false ||
      !Number.isInteger(payload.max_output_tokens) || payload.max_output_tokens < 1 || payload.max_output_tokens > MAX_OUTPUT_TOKENS ||
      !Array.isArray(payload.tools) || payload.tools.length !== 1 || !payload.tools[0] || typeof payload.tools[0] !== 'object' || payload.tools[0].type !== 'function' ||
      !['select_capabilities', 'upsert_action_draft'].includes(payload.tools[0].name) ||
      Object.keys(payload.tools[0]).some(key => !['type','name','description','parameters','strict'].includes(key)) ||
      payload.tool_choice !== undefined && (!payload.tool_choice || payload.tool_choice.type !== 'function' || payload.tool_choice.name !== payload.tools[0].name ||
        Object.keys(payload.tool_choice).some(key => !['type','name'].includes(key)))) throw Error('STAGING_BUDGET_REQUEST');
    const lock = journal + '.lock';
    let handle;
    const id = crypto.randomUUID(), started = Date.now();
    try {
      handle = fs.openSync(lock, 'wx', 0o600);
      const state = journalState(journal, limit);
      if (!state.remaining) throw Error('STAGING_BUDGET_EXHAUSTED');
      const body_bytes = Buffer.byteLength(body, 'utf8'), input_tokens_upper = body_bytes + PROTOCOL_OVERHEAD_TOKENS;
      const request_estimated_usd_upper = (input_tokens_upper * rates.cacheWrite + payload.max_output_tokens * rates.output) / 1e6;
      if (input_tokens_upper > MAX_INPUT_TOKENS_UPPER || request_estimated_usd_upper > RESERVED_MICRO_USD / 1e6) throw Error('STAGING_BUDGET_REQUEST');
      // O_APPEND without O_CREAT prevents a missing/deleted journal from resetting admission.
      const fd = fs.openSync(journal, fs.constants.O_WRONLY | fs.constants.O_APPEND);
      try {
        const reservation = Buffer.from(JSON.stringify({ id, status: 'STARTED', timestamp: new Date(started).toISOString(), model: payload.model,
          body_bytes, input_tokens_upper, max_output_tokens: payload.max_output_tokens, request_estimated_usd_upper,
          reserved_estimated_usd_upper: RESERVED_MICRO_USD / 1e6 }) + '\n');
        for(let offset=0;offset<reservation.length;){
          const written=fs.writeSync(fd,reservation,offset,reservation.length-offset);
          if(written<=0)throw Error('STAGING_BUDGET_WRITE');
          offset+=written;
        }
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
    } finally {
      if (handle !== undefined) { fs.closeSync(handle); fs.unlinkSync(lock); }
    }
    // A failed/unknown request still consumes its reservation. No automatic retry.
    try {
      const response = await original(input, init);
      // Reservation above is mandatory/fail-closed. Usage capture after transport
      // is passive: a slow stream or disk failure cannot fail a successful call.
      const latency_ms = Date.now() - started;
      try {
        observeConsumedResponse(response, data => {
          append({ id, status: response.ok ? 'SUCCEEDED' : 'FAILED', timestamp: new Date().toISOString(),
            latency_ms, http_status: response.status, usage: safeUsage(data?.usage) });
        }, observations);
      } catch { /* STARTED remains reserved/unknown for reconciliation. */ }
      return response;
    } catch {
      try { append({ id, status: 'UNKNOWN', timestamp: new Date().toISOString(), latency_ms: Date.now() - started }); } catch { /* Keep original failure and reservation. */ }
      throw Error('STAGING_PROVIDER_REQUEST_FAILED');
    }
  };
  guarded.flushObservations = () => observations.flush();
  guarded.budgetSnapshot = () => budgetSnapshot(journal, { limit });
  return guarded;
}
module.exports = { guardedFetch, budgetSnapshot, MAX_ATTEMPTS, MAX_BODY_BYTES, MAX_OUTPUT_TOKENS, MAX_INPUT_TOKENS_UPPER, PROTOCOL_OVERHEAD_TOKENS, RESERVED_MICRO_USD, rates };
if (process.env.SECRETARY_STAGING_BUDGET_JOURNAL) {
  const prefix = '/workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z/';
  if (process.env.CODESPACE_NAME !== 'glorious-enigma-jjv6v4rvrv49f544r' ||
    process.env.APP_ENV !== 'staging' || process.env.VERCEL_ENV === 'production' ||
    process.env.SECRETARY_STAGING_BUDGET_JOURNAL !== prefix + 'api-budget.jsonl') throw Error('STAGING_BUDGET_TARGET');
  globalThis.fetch = guardedFetch(globalThis.fetch, process.env.SECRETARY_STAGING_BUDGET_JOURNAL);
}
