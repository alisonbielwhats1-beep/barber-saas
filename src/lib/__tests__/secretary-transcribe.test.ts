import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROGRAM_REAL_CAP_MICRO_USD, PROGRAM_SPEND_BASENAME, PROGRAM_SPEND_LEDGER, TRANSCRIBE_PRICING, TRANSCRIBE_URL as EVALUATION_URL, guardPaidFetch, programSpendEstimator, programSpendTotals,
  readProgramLedger, transcriptionsEstimator, type PaidEstimator } from "../../../packages/salon-secretary/evaluation/program-spend";
import { digest } from "../../../packages/salon-secretary/evaluation/free-use-budget";
import { secretaryGuardedFetch } from "../../../packages/salon-secretary/src/openai-cost-guard";
import { assertTranscriptionWire, reserveTranscriptionBudget, transcribeSecretaryAudio, transcriptionGuardedFetch, transcriptionPrompt, TRANSCRIBE_AUDIT_ENTITY,
  TRANSCRIBE_DEFAULT_MODEL, TRANSCRIBE_LIMITS, TRANSCRIBE_MAX_RESERVATION_MICRO_USD, TRANSCRIBE_MODELS, TRANSCRIBE_SERVER, TRANSCRIBE_URL, TRANSCRIBE_WORST_CASE_MICRO_USD,
  transcribeConfig, transcriptionWorstCaseMicroUsd, settleTranscriptionUsage, transcriptionUsageMicroUsd, TRANSCRIBE_STYLE } from "../secretary-transcribe";
import { SPEND_ROW_LIMIT } from "../secretary-spend";

/** C3, GPT transcription READY BUT OFF: mocked fetch only (a stub that throws guards the real network). */
const dirs: string[] = [];
const ledgerIn = () => { const dir = mkdtempSync(join(tmpdir(), "c3-transcribe-")); dirs.push(dir); return join(dir, PROGRAM_SPEND_BASENAME); };
const env = (extra: Record<string, string> = {}) => ({ SALON_SECRETARY_TRANSCRIBE_ENABLED: "true", SALON_SECRETARY_ALLOW_PAID_CALLS: "true",
  SALON_SECRETARY_OPENAI_API_KEY: "unit-test-placeholder", SALON_SECRETARY_OPENAI_PROJECT: "unit-test-project", SALON_SECRETARY_TRANSCRIBE_BUDGET_USD: "0.1", SALON_SECRETARY_TRANSCRIBE_SALONS: "ours", ...extra });
const directory = { professionals: ["Tatiana Rocha", "Ricardo Alves"], services: ["Corte Feminino", "Escova Progressiva"] };
const audio = (bytes = 2048, type = "audio/webm;codecs=opus") => new Blob([new Uint8Array(bytes)], { type });
const ok = (body: unknown = { text: "  bloqueia  a Tatiana amanhã \n" }) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
const lines = (file: string) => readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
const WORST = TRANSCRIBE_WORST_CASE_MICRO_USD;
const free = () => vi.fn(async () => undefined);

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("request shape and vocabulary", () => {
  it("reserves the worst case, then sends one multipart request with the default mini model, pt, json and a names-only prompt", async () => {
    const fetchFn = ok(), reserve = free(), recording = audio();
    expect(await transcribeSecretaryAudio({ audio: recording, seconds: 4.2, directory, env: env(), fetchFn, reserve })).toEqual({ text: "bloqueia a Tatiana amanhã" });
    // Phase 3a review: the reservation is bounded from the declared seconds AND the file size (4.2 s here).
    expect(reserve).toHaveBeenCalledExactlyOnceWith({ worstCaseMicroUsd: transcriptionWorstCaseMicroUsd(recording.size, 4.2), budgetMicroUsd: 100_000, model: "gpt-4o-mini-transcribe", bytes: recording.size, salons: ["ours"] });
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(fetchFn.mock.invocationCallOrder[0]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions"); expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer unit-test-placeholder", "OpenAI-Project": "unit-test-project" });
    const body = init.body as FormData;
    expect([...body.keys()]).toEqual(["file", "model", "language", "response_format", "prompt"]);
    expect(body.get("model")).toBe(TRANSCRIBE_DEFAULT_MODEL); expect(TRANSCRIBE_DEFAULT_MODEL).toBe("gpt-4o-mini-transcribe");
    expect(body.get("language")).toBe("pt"); expect(body.get("response_format")).toBe("json");
    expect((body.get("file") as File).size).toBe(recording.size); expect((body.get("file") as File).name).toBe("audio.webm");
    // Owner, 03/10 (contract migration, backup in .demo/agenda-core/contract-migration): the style line comes first.
    expect(body.get("prompt")).toBe(`${TRANSCRIBE_STYLE} Agenda de salão de beleza. Profissionais e serviços: Tatiana Rocha, Ricardo Alves, Corte Feminino, Escova Progressiva.`);
  });
  it("the prompt is built only from professional and service names, deduplicated and bounded", () => {
    const prompt = transcriptionPrompt({ professionals: ["Tatiana  Rocha", "Tatiana Rocha", ...Array.from({ length: 60 }, (_, i) => `Profissional Número ${i}`)], services: ["Corte"] });
    expect(prompt.match(/Tatiana Rocha/g)).toHaveLength(1); expect(prompt.length).toBeLessThanOrEqual(800); expect(prompt.endsWith(".")).toBe(true);
    // Customers are not an input of the prompt at all: its only parameter is the directory of professionals and services.
    expect(transcriptionPrompt({ professionals: [], services: [] })).toBe(`${TRANSCRIBE_STYLE} Agenda de salão de beleza. Profissionais e serviços:`);
    expect(TRANSCRIBE_STYLE).toMatch(/ortografia/); expect(TRANSCRIBE_STYLE).toMatch(/sem mudar o sentido/);
  });
  it("a configured model must be allowlisted", async () => {
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 2, directory, env: env({ SALON_SECRETARY_TRANSCRIBE_MODEL: "whisper-1" }), fetchFn: ok(), reserve: free() }))
      .rejects.toThrow("TRANSCRIBE_CONFIGURATION_REQUIRED");
    const fetchFn = ok();
    await transcribeSecretaryAudio({ audio: audio(), seconds: 2, directory, env: env({ SALON_SECRETARY_TRANSCRIBE_MODEL: "gpt-4o-transcribe" }), fetchFn, reserve: free() });
    expect(((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).get("model")).toBe("gpt-4o-transcribe");
  });
});

describe("guards (every refusal happens before the reservation and the network)", () => {
  it("off by default: flag unset, flag false, or paid calls not allowed", async () => {
    const fetchFn = ok(), reserve = free();
    for (const extra of [{ SALON_SECRETARY_TRANSCRIBE_ENABLED: "" }, { SALON_SECRETARY_TRANSCRIBE_ENABLED: "false" }])
      await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 2, directory, env: env(extra), fetchFn, reserve })).rejects.toThrow("TRANSCRIBE_DISABLED");
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 2, directory, env: env({ SALON_SECRETARY_ALLOW_PAID_CALLS: "false" }), fetchFn, reserve })).rejects.toThrow("PAID_CALLS_DISABLED");
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 2, directory, env: {}, fetchFn, reserve })).rejects.toThrow("TRANSCRIBE_DISABLED");
    expect(fetchFn).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
  });
  it("the transport guard re-reads the flag per call and admits only the transcription wire", async () => {
    const fetchFn = ok(), form = new FormData();
    form.set("file", audio(), "audio.webm"); form.set("model", TRANSCRIBE_DEFAULT_MODEL); form.set("language", "pt"); form.set("response_format", "json");
    await expect(transcriptionGuardedFetch(fetchFn, TRANSCRIBE_DEFAULT_MODEL, {})(TRANSCRIBE_URL, { method: "POST", body: form })).rejects.toThrow("TRANSCRIBE_DISABLED");
    const guarded = transcriptionGuardedFetch(fetchFn, TRANSCRIBE_DEFAULT_MODEL, env());
    await expect(guarded("https://api.openai.com/v1/responses", { method: "POST", body: form })).rejects.toThrow("TRANSCRIBE_GUARD");
    await expect(guarded(TRANSCRIBE_URL, { method: "GET" })).rejects.toThrow("TRANSCRIBE_GUARD");
    const extra = new FormData(); for (const [key, value] of form.entries()) extra.append(key, value); extra.set("tools", "web_search");
    await expect(guarded(TRANSCRIBE_URL, { method: "POST", body: extra })).rejects.toThrow("TRANSCRIBE_GUARD");
    const other = new FormData(); for (const [key, value] of form.entries()) other.append(key, value); other.set("model", "gpt-6-luna");
    await expect(guarded(TRANSCRIBE_URL, { method: "POST", body: other })).rejects.toThrow("TRANSCRIBE_GUARD");
    expect(fetchFn).not.toHaveBeenCalled();
    await guarded(TRANSCRIBE_URL, { method: "POST", body: form }); expect(fetchFn).toHaveBeenCalledOnce();
    expect(() => assertTranscriptionWire(TRANSCRIBE_URL, { method: "POST", body: form }, "gpt-4o-transcribe")).toThrow("TRANSCRIBE_GUARD");
  });
  it("size, duration and type caps", async () => {
    const fetchFn = ok(), reserve = free(), call = (recording: Blob, seconds: unknown) => transcribeSecretaryAudio({ audio: recording, seconds, directory, env: env(), fetchFn, reserve });
    await expect(call(audio(TRANSCRIBE_LIMITS.maxAudioBytes + 1), 10)).rejects.toThrow("TRANSCRIBE_AUDIO_TOO_LARGE");
    await expect(call(audio(), TRANSCRIBE_LIMITS.maxAudioSeconds + 1)).rejects.toThrow("TRANSCRIBE_AUDIO_TOO_LONG");
    await expect(call(audio(), 0)).rejects.toThrow("TRANSCRIBE_AUDIO_INVALID");
    await expect(call(audio(0), 2)).rejects.toThrow("TRANSCRIBE_AUDIO_INVALID");
    await expect(call(audio(10, "video/mp4"), 2)).rejects.toThrow("TRANSCRIBE_AUDIO_INVALID");
    await expect(call("not audio" as unknown as Blob, 2)).rejects.toThrow("TRANSCRIBE_AUDIO_INVALID");
    expect(fetchFn).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
  });
  it("the Luna cost guard is not widened: it still refuses the transcription wire", async () => {
    const form = new FormData(); form.set("file", audio(), "audio.webm"); form.set("model", TRANSCRIBE_DEFAULT_MODEL);
    await expect(secretaryGuardedFetch("gpt-6-luna")(TRANSCRIBE_URL, { method: "POST", body: form })).rejects.toThrow("SECRETARY_OPENAI_COST_GUARD");
  });
});

/** Voice rows as the wallet reads them (secretary-spend.ts): RESERVE rows of this month. */
const voiceRows = (metadata: unknown[]) => metadata.map((item, i) => ({ entityId: `r${i}`, entityType: TRANSCRIBE_AUDIT_ENTITY, action: "RESERVE", metadata: item, createdAt: new Date() }));
function walletTx(metadata: unknown[]) {
  const created: { data: Record<string, unknown> }[] = [];
  const tx = { $executeRaw: vi.fn(async () => 0), salon: { findUniqueOrThrow: vi.fn(async () => ({ timezone: "America/Sao_Paulo" })) },
    auditLog: { findMany: vi.fn(async () => voiceRows(metadata)), count: vi.fn(async () => 0), create: vi.fn(async (input: { data: Record<string, unknown> }) => { created.push(input); return {}; }) } };
  return { tx, created };
}
describe("the salon's monthly wallet (owner 06/10: shared with the model, salon's time zone, append-only AuditLog)", () => {
  const actor = { salonId: "ours", userId: "owner" };
  const fakeTx = walletTx;
  it("unset budget is zero: refused before any reservation or network", async () => {
    const fetchFn = ok(), reserve = free();
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 2, directory, env: env({ SALON_SECRETARY_TRANSCRIBE_BUDGET_USD: "" }), fetchFn, reserve })).rejects.toThrow("TRANSCRIBE_BUDGET");
    expect(reserve).not.toHaveBeenCalled(); expect(fetchFn).not.toHaveBeenCalled();
  });
  it("admits while this month's spend plus the worst case fit, and appends a codes-and-numbers row", async () => {
    const { tx, created } = fakeTx([{ worst_case_micro_usd: WORST }]);
    const now = new Date("2027-06-14T12:00:00Z");
    expect(await reserveTranscriptionBudget(tx as never, actor, { worstCaseMicroUsd: WORST, budgetMicroUsd: 2 * WORST, model: "gpt-4o-mini-transcribe", bytes: 2048, salons: ["ours"] }, now)).toEqual({ spentMicroUsd: 2 * WORST, reservationId: expect.any(String) });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    // The month starts at midnight in the salon's time zone (São Paulo, UTC−3).
    expect(tx.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ salonId: "ours", createdAt: { gte: new Date("2027-06-01T03:00:00Z") } }) }));
    expect(created[0].data).toMatchObject({ salonId: "ours", userId: "owner", entityType: TRANSCRIBE_AUDIT_ENTITY, action: "RESERVE",
      metadata: { worst_case_micro_usd: WORST, model: "gpt-4o-mini-transcribe", audio_bytes: 2048 } });
  });
  it("refuses a call that does not fit; unreadable rows count at the worst case; an unbounded month fails closed", async () => {
    const input = { worstCaseMicroUsd: WORST, budgetMicroUsd: 2 * WORST, model: "gpt-4o-mini-transcribe", bytes: 1, salons: ["ours"] };
    for (const rows of [[{ worst_case_micro_usd: WORST }, { worst_case_micro_usd: 1 }], [null, "x"], Array.from({ length: SPEND_ROW_LIMIT + 1 }, () => ({ worst_case_micro_usd: 1 }))]) {
      const { tx, created } = fakeTx(rows);
      await expect(reserveTranscriptionBudget(tx as never, actor, { ...input, budgetMicroUsd: rows.length > 1000 ? 5_000_000 : input.budgetMicroUsd })).rejects.toThrow("TRANSCRIBE_BUDGET");
      expect(created).toHaveLength(0);
    }
  });
  it("an empty or unreadable transcript is refused, never an empty input", async () => {
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 1, directory, env: env(), fetchFn: ok({ text: "   " }), reserve: free() })).rejects.toThrow("TRANSCRIBE_EMPTY");
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 1, directory, env: env(), fetchFn: vi.fn(async () => new Response("x", { status: 200 })), reserve: free() })).rejects.toThrow("TRANSCRIBE_FAILED");
  });
  it("a refused reservation stops the call before the network", async () => {
    const fetchFn = ok(), reserve = vi.fn(async () => { throw Error("TRANSCRIBE_BUDGET"); });
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 2, directory, env: env(), fetchFn, reserve })).rejects.toThrow("TRANSCRIBE_BUDGET");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("phase 3a review: the billed length is bounded by the file, and the program has a cap", () => {
  it("a long low-bitrate file declared as short reserves by its size (6 kbit/s floor), never by the client's seconds", async () => {
    const reserve = free(), fetchFn = ok(), recording = audio(450_000, "audio/ogg");
    await transcribeSecretaryAudio({ audio: recording, seconds: 5, directory, env: env({ SALON_SECRETARY_TRANSCRIBE_BUDGET_USD: "1" }), fetchFn, reserve });
    // 450 000 bytes at 750 B/s = 600 s = 10 min at USD 0.02/min.
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ worstCaseMicroUsd: 200_000 }));
    expect(transcriptionWorstCaseMicroUsd(3000, 30)).toBe(10_000); expect(transcriptionWorstCaseMicroUsd(TRANSCRIBE_SERVER.maxAudioBytes, 60)).toBe(TRANSCRIBE_MAX_RESERVATION_MICRO_USD);
    // A call whose own bound exceeds the budget is refused before the reservation.
    const refused = free();
    await expect(transcribeSecretaryAudio({ audio: recording, seconds: 5, directory, env: env(), fetchFn, reserve: refused })).rejects.toThrow("TRANSCRIBE_BUDGET");
    expect(refused).not.toHaveBeenCalled();
  });
  it("the server admits at most TRANSCRIBE_SERVER.maxAudioBytes, under the 1 MB server-action body limit", async () => {
    expect(TRANSCRIBE_SERVER.maxAudioBytes).toBeLessThan(1_000_000); expect(TRANSCRIBE_SERVER.maxAudioBytes).toBeLessThanOrEqual(TRANSCRIBE_LIMITS.maxAudioBytes);
    await expect(transcribeSecretaryAudio({ audio: audio(TRANSCRIBE_SERVER.maxAudioBytes + 1), seconds: 10, directory, env: env(), fetchFn: ok(), reserve: free() })).rejects.toThrow("TRANSCRIBE_AUDIO_TOO_LARGE");
  });
  it("program cap: only listed salons, and their number times the budget fits the program cap", async () => {
    expect(() => transcribeConfig(env({ SALON_SECRETARY_TRANSCRIBE_SALONS: "" }))).toThrow("TRANSCRIBE_CONFIGURATION_REQUIRED");
    expect(() => transcribeConfig(env({ SALON_SECRETARY_TRANSCRIBE_BUDGET_USD: "5", SALON_SECRETARY_TRANSCRIBE_SALONS: Array.from({ length: 6 }, (_, i) => `s${i}`).join(",") }))).toThrow("TRANSCRIBE_CONFIGURATION_REQUIRED");
    expect(transcribeConfig(env({ SALON_SECRETARY_TRANSCRIBE_BUDGET_USD: "5", SALON_SECRETARY_TRANSCRIBE_SALONS: "a, b, a,c,d,e" })).salons).toEqual(["a", "b", "c", "d", "e"]);
    const created: unknown[] = [], tx = { $executeRaw: vi.fn(async () => 0), auditLog: { findMany: vi.fn(async () => []), create: vi.fn(async (input: unknown) => { created.push(input); return {}; }) } };
    await expect(reserveTranscriptionBudget(tx as never, { salonId: "other", userId: "owner" }, { worstCaseMicroUsd: WORST, budgetMicroUsd: 10 * WORST, model: "gpt-4o-mini-transcribe", bytes: 1, salons: ["ours"] }))
      .rejects.toThrow("TRANSCRIBE_DISABLED");
    expect(tx.$executeRaw).not.toHaveBeenCalled(); expect(created).toHaveLength(0);
  });
});

describe("evaluation composition: program real-spend ledger, source 'transcribe' (sealed estimator 'transcriptions')", () => {
  const evaluationFetch = (network: typeof fetch, ledger: string) => guardPaidFetch("transcribe", network, { ledger, run: "transcribe:evaluation", item: "recording", estimator: transcriptionsEstimator });
  it("runtime bounds and the sealed estimator agree", () => {
    expect(EVALUATION_URL).toBe(TRANSCRIBE_URL); // Owner 06/10/2026: gpt-transcribe is runtime only; the sealed estimator (and its digest) keeps the two gpt-4o models.
    expect([...TRANSCRIBE_MODELS].filter(m => m !== "gpt-transcribe")).toEqual([...TRANSCRIBE_PRICING.models]);
    expect({ maxAudioSeconds: TRANSCRIBE_PRICING.maxAudioSeconds, maxAudioBytes: TRANSCRIBE_PRICING.maxAudioBytes, upperUsdPerMinute: TRANSCRIBE_PRICING.upperUsdPerMinute }).toEqual(TRANSCRIBE_LIMITS);
    expect(programSpendEstimator("transcriptions")).toMatchObject({ name: "transcriptions", models: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"], minWorstCaseMicroUsd: WORST });
    expect(programSpendEstimator("whisper")).toBeNull();
  });
  it("charges the worst case even when the provider reports usage", async () => {
    const ledger = ledgerIn(), network = ok({ text: "oi", usage: { type: "duration", seconds: 1 } });
    await transcribeSecretaryAudio({ audio: audio(), seconds: 1, directory, env: env(), fetchFn: evaluationFetch(network, ledger), reserve: free() });
    const [reserve, settle] = lines(ledger);
    expect(reserve).toMatchObject({ kind: "RESERVE", source: "transcribe", run: "transcribe:evaluation", estimator: "transcriptions", model: TRANSCRIBE_DEFAULT_MODEL,
      maxOutputTokens: TRANSCRIBE_PRICING.maxAudioSeconds, worstCaseMicroUsd: WORST });
    expect(settle).toMatchObject({ kind: "SETTLE", outcome: "NO_USAGE", usage: null, chargedMicroUsd: WORST });
    expect(programSpendTotals(ledger).bySource.transcribe).toMatchObject({ calls: 1, spentMicroUsd: WORST });
  });
  it("a usage settlement of a transcription row never validates (it cannot lower the charge)", async () => {
    const ledger = ledgerIn();
    await transcribeSecretaryAudio({ audio: audio(), seconds: 1, directory, env: env(), fetchFn: evaluationFetch(ok(), ledger), reserve: free() });
    const [reserve, settle] = lines(ledger), { rowHash: _drop, ...body } = { ...settle, outcome: "USAGE", usage: { seconds: 1 }, chargedMicroUsd: 0 } as Record<string, unknown>;
    void _drop;
    writeFileSync(ledger, [reserve, { ...body, rowHash: digest(JSON.stringify(body)) }].map(row => JSON.stringify(row)).join("\n") + "\n");
    rmSync(join(ledger, "..", `${PROGRAM_SPEND_LEDGER}.anchor.json`), { force: true });
    expect(() => readProgramLedger(ledger)).toThrow("PROGRAM_SPEND_JOURNAL");
  });
  it("the program cap refuses before the network, and a provider failure is charged at the worst case", async () => {
    const ledger = ledgerIn(), network = ok();
    const fixed: PaidEstimator = { name: "test-fixed", actual: () => null, worstCase: () => ({ estimator: "test-fixed", model: "synthetic", bodyBytes: 1, maxOutputTokens: 1, worstCaseMicroUsd: PROGRAM_REAL_CAP_MICRO_USD - 10_000, pricingSha256: "synthetic" }) };
    await guardPaidFetch("practice", async () => new Response("unavailable", { status: 503 }), { ledger, run: "practice:unit", estimator: fixed })("https://example.invalid/synthetic", { method: "POST", body: "x" });
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 2, directory, env: env(), fetchFn: evaluationFetch(network, ledger), reserve: free() })).rejects.toThrow("PROGRAM_SPEND_CAP");
    expect(network).not.toHaveBeenCalled();
    const second = ledgerIn();
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 1, directory, env: env(), fetchFn: evaluationFetch(vi.fn(async () => new Response("busy", { status: 503 })), second), reserve: free() }))
      .rejects.toThrow("TRANSCRIBE_FAILED");
    expect(lines(second)[1]).toMatchObject({ outcome: "FAILED", httpStatus: 503, chargedMicroUsd: WORST });
    expect(existsSync(second)).toBe(true);
  });
});

describe("usage settlement (owner decision 03/10/2026: transcription on in the local demo)", () => {
  const usage = (extra: Record<string, unknown> = {}) => ({ type: "tokens", input_tokens: 120, input_token_details: { audio_tokens: 100, text_tokens: 20 }, output_tokens: 30, total_tokens: 150, ...extra });
  const actor = { salonId: "ours", userId: "owner" };
  it("prices the reported tokens of the admitted models (micro-USD, rounded up) and a duration at the per-minute ceiling", () => {
    expect(transcriptionUsageMicroUsd(usage(), "gpt-4o-mini-transcribe")).toBe(100 * 3 + 20 * 1.25 + 30 * 5);
    expect(transcriptionUsageMicroUsd(usage(), "gpt-4o-transcribe")).toBe(100 * 6 + 20 * 2.5 + 30 * 10);
    expect(transcriptionUsageMicroUsd({ type: "tokens", input_tokens: 50, output_tokens: 10 }, "gpt-4o-mini-transcribe")).toBe(50 * 3 + 10 * 5);
    expect(transcriptionUsageMicroUsd({ type: "duration", seconds: 30 }, "gpt-4o-mini-transcribe")).toBe(10_000);
    expect(transcriptionUsageMicroUsd(undefined, "gpt-4o-mini-transcribe")).toBeUndefined();
    expect(transcriptionUsageMicroUsd({ type: "tokens" }, "gpt-4o-mini-transcribe")).toBeUndefined();
  });
  it("settles after the call with the reservation and the reported cost; the text still comes back", async () => {
    const settle = vi.fn(async () => undefined), recording = audio();
    expect(await transcribeSecretaryAudio({ audio: recording, seconds: 4.2, directory, env: env(), fetchFn: ok({ text: "remarca a Noemi", usage: usage() }), reserve: free(), settle }))
      .toEqual({ text: "remarca a Noemi" });
    expect(settle).toHaveBeenCalledExactlyOnceWith({ reservedMicroUsd: transcriptionWorstCaseMicroUsd(recording.size, 4.2), actualMicroUsd: 475, seconds: 4.2, bytes: recording.size,
      model: "gpt-4o-mini-transcribe" });
  });
  it("the settlement names the reservation it settles (owner 06/10: the wallet counts the reported cost)", async () => {
    const settle = vi.fn(async () => undefined), reserve = vi.fn(async () => ({ spentMicroUsd: 1, reservationId: "res-1" }));
    await transcribeSecretaryAudio({ audio: audio(), seconds: 2, directory, env: env(), fetchFn: ok({ text: "oi", usage: usage() }), reserve, settle });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ reservationId: "res-1" }));
    const created: { data: Record<string, unknown> }[] = [], tx = { auditLog: { create: vi.fn(async (input: { data: Record<string, unknown> }) => { created.push(input); return {}; }) } };
    await settleTranscriptionUsage(tx as never, actor, { reservedMicroUsd: 1_000, actualMicroUsd: 2_500, seconds: 60, bytes: 400_000, model: "gpt-4o-mini-transcribe", reservationId: "res-1" });
    expect(created.map(row => (row.data.metadata as Record<string, unknown>).reservation_id)).toEqual(["res-1", "res-1"]);
  });
  it("an empty transcript is settled (the call was billed) before it is refused; a failed settlement never loses the text", async () => {
    const settle = vi.fn(async () => undefined);
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 1, directory, env: env(), fetchFn: ok({ text: " ", usage: usage() }), reserve: free(), settle })).rejects.toThrow("TRANSCRIBE_EMPTY");
    expect(settle).toHaveBeenCalledOnce();
    const failing = vi.fn(async () => { throw Error("DB_DOWN"); }), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await transcribeSecretaryAudio({ audio: audio(), seconds: 1, directory, env: env(), fetchFn: ok({ text: "cancela o Otávio" }), reserve: free(), settle: failing }))
      .toEqual({ text: "cancela o Otávio" });
    expect(failing).toHaveBeenCalledWith(expect.objectContaining({ actualMicroUsd: null })); expect(log).toHaveBeenCalledWith("SECRETARY_TRANSCRIBE_SETTLE_FAILED");
    log.mockRestore();
  });
  it("appends a USAGE row always, and a RESERVE overrun row only when the reported cost passes the reservation", async () => {
    const created: { data: Record<string, unknown> }[] = [], tx = { auditLog: { create: vi.fn(async (input: { data: Record<string, unknown> }) => { created.push(input); return {}; }) } };
    await settleTranscriptionUsage(tx as never, actor, { reservedMicroUsd: 13_334, actualMicroUsd: 475, seconds: 4.24, bytes: 30_000, model: "gpt-4o-mini-transcribe" });
    expect(created.map(row => row.data.action)).toEqual(["USAGE"]);
    expect(created[0].data).toMatchObject({ salonId: "ours", userId: "owner", entityType: TRANSCRIBE_AUDIT_ENTITY,
      metadata: { reserved_micro_usd: 13_334, actual_micro_usd: 475, audio_seconds: 4.2, audio_bytes: 30_000, model: "gpt-4o-mini-transcribe" } });
    created.length = 0;
    await settleTranscriptionUsage(tx as never, actor, { reservedMicroUsd: 1_000, actualMicroUsd: 2_500, seconds: 60, bytes: 400_000, model: "gpt-4o-mini-transcribe" });
    expect(created.map(row => row.data.action)).toEqual(["USAGE", "RESERVE"]);
    expect(created[1].data.metadata).toEqual({ worst_case_micro_usd: 1_500, model: "gpt-4o-mini-transcribe", audio_bytes: 400_000, kind: "OVERRUN" });
    created.length = 0;
    await settleTranscriptionUsage(tx as never, actor, { reservedMicroUsd: 1_000, actualMicroUsd: null, seconds: 2, bytes: 9_000, model: "gpt-4o-mini-transcribe" });
    expect(created.map(row => row.data.action)).toEqual(["USAGE"]);
  });
  it("an overrun row counts in the month's budget like any reservation", async () => {
    const { tx } = walletTx([{ worst_case_micro_usd: 50_000 }, { worst_case_micro_usd: 40_000, kind: "OVERRUN" }]);
    await expect(reserveTranscriptionBudget(tx as never, actor, { worstCaseMicroUsd: 20_000, budgetMicroUsd: 100_000, model: "gpt-4o-mini-transcribe", bytes: 1, salons: ["ours"] }))
      .rejects.toThrow("TRANSCRIBE_BUDGET");
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
