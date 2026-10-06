import { randomUUID } from "node:crypto";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";

/** C3 voice, GPT transcription: off by default (owner decision 28/09/2026); on in the local demo since the owner's decision
 * of 03/10/2026 (US$ 2 per listed salon and UTC month; scripts/dev-agenda-test.cjs).
 * The recorder's audio goes to the audio transcription endpoint only when SALON_SECRETARY_TRANSCRIBE_ENABLED=true AND
 * paid calls are allowed AND a transcription budget is set. Its own guard: one allowlisted URL, fixed multipart fields,
 * allowlisted models, size and duration caps. Its own budget: every call is reserved at its worst case in the salon's
 * append-only AuditLog before the network (per salon and UTC month). Evaluation runners compose the same guarded fetch
 * with the program real-spend ledger (source 'transcribe', sealed estimator 'transcriptions'); runtime code never imports
 * evaluation code. The Luna cost guard (openai-cost-guard.ts) is neither used nor widened. The vocabulary prompt carries
 * professional and service names; customers' names only with SALON_SECRETARY_TRANSCRIBE_CUSTOMER_NAMES (owner decision 05/10,
 * secretary-voice-customers.ts: names only, appointments around today). The text is returned to the input box: never sent. */
type Env = Record<string, string | undefined>;
export const TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
export const TRANSCRIBE_MODELS = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"] as const;
export const TRANSCRIBE_DEFAULT_MODEL = "gpt-4o-mini-transcribe";
/** Same bounds as the sealed evaluation estimator (TRANSCRIBE_PRICING); a test keeps them equal. */
export const TRANSCRIBE_LIMITS = { maxAudioSeconds: 60, maxAudioBytes: 1_500_000, upperUsdPerMinute: 0.02 } as const;
export const TRANSCRIBE_WORST_CASE_MICRO_USD = Math.ceil(TRANSCRIBE_LIMITS.maxAudioSeconds / 60 * TRANSCRIBE_LIMITS.upperUsdPerMinute * 1e6);
/** Runtime bounds (phase 3a review). The provider bills the REAL length, which the client-declared seconds do not
 * bound: the billable length is bounded from the file size at the lowest bitrate of the admitted codecs (6 kbit/s =
 * 750 B/s, Opus), and every call reserves the larger of that and the declared seconds. The recorder encodes at
 * 24 kbit/s (a minute is ~180 KB) and the server admits at most `maxAudioBytes`, well under the server-action body
 * limit (Next default 1 MB), so the largest reservation of one call is TRANSCRIBE_MAX_RESERVATION_MICRO_USD. Program
 * cap: only the salons listed in SALON_SECRETARY_TRANSCRIBE_SALONS may transcribe, and their number times the per-salon
 * budget must fit `programCapUsd` (the monthly spend of the whole program, without reading other tenants). */
export const TRANSCRIBE_SERVER = { maxAudioBytes: 480_000, minBytesPerSecond: 750, programCapUsd: 25 } as const;
export const TRANSCRIBE_RECORDER_BITS_PER_SECOND = 24_000;
export function transcriptionWorstCaseMicroUsd(bytes: number, seconds: number) {
  const billable = Math.max(seconds, Math.ceil(bytes / TRANSCRIBE_SERVER.minBytesPerSecond));
  return Math.ceil(billable / 60 * TRANSCRIBE_LIMITS.upperUsdPerMinute * 1e6);
}
export const TRANSCRIBE_MAX_RESERVATION_MICRO_USD = transcriptionWorstCaseMicroUsd(TRANSCRIBE_SERVER.maxAudioBytes, TRANSCRIBE_LIMITS.maxAudioSeconds);
export const TRANSCRIBE_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"] as const;
export const TRANSCRIBE_PROMPT_MAX = 800;
export const TRANSCRIBE_FETCH_TIMEOUT_MS = 15_000;
export const TRANSCRIBE_AUDIT_ENTITY = "SECRETARY_TRANSCRIBE";
const FIELDS = ["file", "model", "language", "response_format", "prompt"];
const model = (value: unknown): value is (typeof TRANSCRIBE_MODELS)[number] => (TRANSCRIBE_MODELS as readonly unknown[]).includes(value);

export function transcribeEnabled(env: Env = process.env) { return env.SALON_SECRETARY_TRANSCRIBE_ENABLED === "true"; }
/** Budget per salon and UTC month (USD); unset = 0, so enabling needs an explicit budget too. */
export function transcribeConfig(env: Env = process.env) {
  if (!transcribeEnabled(env)) throw Error("TRANSCRIBE_DISABLED");
  if (env.SALON_SECRETARY_ALLOW_PAID_CALLS !== "true") throw Error("PAID_CALLS_DISABLED");
  const chosen = env.SALON_SECRETARY_TRANSCRIBE_MODEL?.trim() || TRANSCRIBE_DEFAULT_MODEL, budget = Number(env.SALON_SECRETARY_TRANSCRIBE_BUDGET_USD || "0");
  if (!model(chosen) || !Number.isFinite(budget) || budget < 0 || budget > 5) throw Error("TRANSCRIBE_CONFIGURATION_REQUIRED");
  const salons = [...new Set((env.SALON_SECRETARY_TRANSCRIBE_SALONS ?? "").split(",").map(salon => salon.trim()).filter(Boolean))];
  if (!salons.length || salons.length * budget > TRANSCRIBE_SERVER.programCapUsd) throw Error("TRANSCRIBE_CONFIGURATION_REQUIRED");
  const apiKey = env.SALON_SECRETARY_OPENAI_API_KEY, project = env.SALON_SECRETARY_OPENAI_PROJECT;
  if (!apiKey || !project) throw Error("SECRETARY_CONFIGURATION_REQUIRED");
  return { model: chosen, apiKey, project, budgetMicroUsd: Math.floor(budget * 1e6), salons };
}
/** Owner, 03/10: the transcript comes out already in correct Portuguese (spelling, accents and punctuation), so a spoken
 * message can be sent as is. The meaning, names, numbers, days and times are never changed. */
export const TRANSCRIBE_STYLE = "Português do Brasil, com ortografia, acentuação e pontuação corretas, sem mudar o sentido, nomes, números, dias e horários.";
/** Production pilot, 06/10/2026: on a short recording or a trailing silence the transcription model can repeat the vocabulary
 * prompt as if it had been said ("Cancela o horário da Carolina. Agenda de salão de beleza. Profissionais: …"). The text is cut
 * where the prompt starts; nothing left means nothing was recognized. Never a reason to execute anything. */
const PROMPT_ECHO = /\s*(?:Agenda de sal[aã]o de beleza|Portugu[eê]s do Brasil, com ortografia)\b/i;
export function withoutPromptEcho(text: string) {
  const at = text.search(PROMPT_ECHO);
  return (at < 0 ? text : text.slice(0, at)).trim();
}
/** The style line, then directory names only (the same bounded list Luna sees), deduplicated and cut at a whole name. */
export function transcriptionPrompt(directory: { professionals: readonly string[]; services: readonly string[]; customers?: readonly string[] }) {
  if (directory.customers?.length) return groupedTranscriptionPrompt(directory as Required<typeof directory>);
  const names = [...new Set([...directory.professionals, ...directory.services].map(name => name.replace(/\s+/g, " ").trim()).filter(Boolean))];
  let prompt = `${TRANSCRIBE_STYLE} Agenda de salão de beleza. Profissionais e serviços:`;
  for (const name of names) { if (prompt.length + name.length + 2 > TRANSCRIBE_PROMPT_MAX) break; prompt += ` ${name},`; }
  return prompt.replace(/,$/, ".");
}
/** Owner 05/10: with customers' names, professionals first, then customers (nearest appointment first), then services, each cut at a whole name. */
function groupedTranscriptionPrompt(directory: { professionals: readonly string[]; services: readonly string[]; customers: readonly string[] }) {
  const clean = (names: readonly string[]) => [...new Set(names.map(name => name.replace(/\s+/g, " ").trim()).filter(Boolean))];
  let prompt = `${TRANSCRIBE_STYLE} Agenda de salão de beleza.`;
  for (const [label, names] of [["Profissionais", directory.professionals], ["Clientes", directory.customers], ["Serviços", directory.services]] as const) {
    const list = clean(names); if (!list.length || prompt.length + label.length + list[0].length + 4 > TRANSCRIBE_PROMPT_MAX) continue;
    prompt += ` ${label}:`;
    for (const name of list) { if (prompt.length + name.length + 3 > TRANSCRIBE_PROMPT_MAX) break; prompt += ` ${name},`; }
    prompt = prompt.replace(/,$/, ".");
  }
  return prompt;
}
const baseType = (type: string) => type.split(";")[0].trim().toLowerCase();
/** Size, type and declared duration of one recording, before any budget or network work. */
export function assertTranscriptionAudio(audio: unknown, seconds: unknown): asserts audio is Blob {
  if (!(audio instanceof Blob) || audio.size < 1 || !(TRANSCRIBE_AUDIO_TYPES as readonly string[]).includes(baseType(audio.type))) throw Error("TRANSCRIBE_AUDIO_INVALID");
  if (audio.size > TRANSCRIBE_SERVER.maxAudioBytes) throw Error("TRANSCRIBE_AUDIO_TOO_LARGE");
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) throw Error("TRANSCRIBE_AUDIO_INVALID");
  if (seconds > TRANSCRIBE_LIMITS.maxAudioSeconds) throw Error("TRANSCRIBE_AUDIO_TOO_LONG");
}
export function transcriptionRequest(audio: Blob, chosen: string, prompt: string, auth: { apiKey: string; project: string }): [string, RequestInit] {
  const body = new FormData(), extension = baseType(audio.type).split("/")[1]?.replace(/^x-/, "") || "webm";
  body.set("file", audio, `audio.${extension}`); body.set("model", chosen); body.set("language", "pt"); body.set("response_format", "json");
  if (prompt) body.set("prompt", prompt);
  // A provider that never answers fails the call (the client also gives up after 20 s; a piece normally takes under 1 s); nothing is sent or confirmed.
  return [TRANSCRIBE_URL, { method: "POST", headers: { Authorization: `Bearer ${auth.apiKey}`, "OpenAI-Project": auth.project }, body, signal: AbortSignal.timeout(TRANSCRIBE_FETCH_TIMEOUT_MS) }];
}
/** The transcription wire, and nothing else: exact URL, POST, only the fixed multipart fields, allowlisted model, pt,
 * json, one bounded audio file and a bounded prompt. */
export function assertTranscriptionWire(input: Parameters<typeof fetch>[0], init: RequestInit | undefined, chosen: string) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url !== TRANSCRIBE_URL || init?.method !== "POST" || !(init.body instanceof FormData)) throw Error("TRANSCRIBE_GUARD");
  const body = init.body, keys = [...body.keys()];
  if (keys.some(key => !FIELDS.includes(key)) || new Set(keys).size !== keys.length) throw Error("TRANSCRIBE_GUARD");
  const file = body.get("file"), prompt = body.get("prompt");
  if (body.get("model") !== chosen || !model(chosen) || body.get("language") !== "pt" || body.get("response_format") !== "json") throw Error("TRANSCRIBE_GUARD");
  if (!(file instanceof Blob) || file.size < 1) throw Error("TRANSCRIBE_GUARD");
  if (file.size > TRANSCRIBE_LIMITS.maxAudioBytes) throw Error("TRANSCRIBE_AUDIO_TOO_LARGE");
  if (prompt !== null && (typeof prompt !== "string" || prompt.length > TRANSCRIBE_PROMPT_MAX)) throw Error("TRANSCRIBE_GUARD");
}
/** Guard at the transport: the flag is read again per call, then the wire is checked before the network. */
export function transcriptionGuardedFetch(fetchFn: typeof fetch, chosen: string, env: Env = process.env): typeof fetch {
  return async (input, init) => {
    if (!transcribeEnabled(env)) throw Error("TRANSCRIBE_DISABLED");
    assertTranscriptionWire(input, init, chosen);
    return fetchFn(input, init);
  };
}
export type TranscriptionReservation = { worstCaseMicroUsd: number; budgetMicroUsd: number; model: string; bytes: number; salons: readonly string[] };
const reservedOf = (metadata: unknown) => {
  const value = (metadata as { worst_case_micro_usd?: unknown } | null)?.worst_case_micro_usd;
  // An unreadable row still counts, at the largest reservation: the budget never reads as more headroom than it has.
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : TRANSCRIBE_MAX_RESERVATION_MICRO_USD;
};
/** Own budget: only a listed salon (the program cap); under a per-salon advisory lock, this UTC month's reservations plus
 * this call's worst case must fit the budget; the reservation row (codes and numbers only) is appended before the network
 * and is never refunded. */
export async function reserveTranscriptionBudget(tx: Tx, actor: ServiceActor, input: TranscriptionReservation, now = new Date()) {
  if (!input.salons?.includes(actor.salonId)) throw Error("TRANSCRIBE_DISABLED");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${TRANSCRIBE_AUDIT_ENTITY}:${actor.salonId}`}, 0))`;
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await tx.auditLog.findMany({ where: { salonId: actor.salonId, entityType: TRANSCRIBE_AUDIT_ENTITY, action: "RESERVE", createdAt: { gte: since } },
    select: { metadata: true }, take: 1001 });
  const spent = rows.reduce((total, row) => total + reservedOf(row.metadata), 0);
  if (rows.length > 1000 || spent + input.worstCaseMicroUsd > input.budgetMicroUsd) throw Error("TRANSCRIBE_BUDGET");
  await tx.auditLog.create({ data: { salonId: actor.salonId, userId: actor.userId, actorName: "Secretária — transcrição", entityType: TRANSCRIBE_AUDIT_ENTITY,
    entityId: randomUUID(), action: "RESERVE", metadata: { worst_case_micro_usd: input.worstCaseMicroUsd, model: input.model, audio_bytes: input.bytes } } });
  return { spentMicroUsd: spent + input.worstCaseMicroUsd };
}
/** Upper-bound list prices (USD per 1M tokens) of the admitted models, for the usage the provider reports with each
 * transcription; a duration usage is priced at the per-minute ceiling. */
export const TRANSCRIBE_TOKEN_PRICES: Readonly<Record<(typeof TRANSCRIBE_MODELS)[number], { audio: number; text: number; output: number }>> = {
  "gpt-4o-mini-transcribe": { audio: 3, text: 1.25, output: 5 }, "gpt-4o-transcribe": { audio: 6, text: 2.5, output: 10 } };
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
/** The provider-reported cost of one call, in micro-USD (rounded up); undefined when no usage came back. */
export function transcriptionUsageMicroUsd(usage: unknown, chosen: string): number | undefined {
  const u = usage as { type?: unknown; input_tokens?: unknown; output_tokens?: unknown; seconds?: unknown; input_token_details?: { audio_tokens?: unknown; text_tokens?: unknown } } | null;
  if (!u || typeof u !== "object") return undefined;
  if (u.type === "duration") return Math.ceil(count(u.seconds) / 60 * TRANSCRIBE_LIMITS.upperUsdPerMinute * 1e6);
  const prices = model(chosen) ? TRANSCRIBE_TOKEN_PRICES[chosen] : TRANSCRIBE_TOKEN_PRICES["gpt-4o-transcribe"];
  const audio = count(u.input_token_details?.audio_tokens), text = count(u.input_token_details?.text_tokens), input = count(u.input_tokens), output = count(u.output_tokens);
  if (!input && !output) return undefined;
  // Input tokens without a split are priced as audio (the dearer kind).
  return Math.ceil(((audio || text ? audio : input) * prices.audio + (audio || text ? text : 0) * prices.text + output * prices.output));
}
export type TranscriptionSettlement = { reservedMicroUsd: number; actualMicroUsd: number | null; seconds: number; bytes: number; model: string };
/** After the call: one USAGE row (numbers and codes only) with the reported cost, the declared seconds and the file size;
 * when the reported cost passes the reservation, the difference is appended as one more RESERVE (kind OVERRUN), so the
 * month's budget counts the real length of the audio (the open risk of a file longer than its size bound). Never refunds. */
export async function settleTranscriptionUsage(tx: Tx, actor: ServiceActor, input: TranscriptionSettlement) {
  const row = { salonId: actor.salonId, userId: actor.userId, actorName: "Secretária — transcrição", entityType: TRANSCRIBE_AUDIT_ENTITY };
  await tx.auditLog.create({ data: { ...row, entityId: randomUUID(), action: "USAGE", metadata: { reserved_micro_usd: input.reservedMicroUsd,
    actual_micro_usd: input.actualMicroUsd, audio_seconds: Math.round(input.seconds * 10) / 10, audio_bytes: input.bytes, model: input.model } } });
  const over = input.actualMicroUsd === null ? 0 : input.actualMicroUsd - input.reservedMicroUsd;
  if (over > 0) await tx.auditLog.create({ data: { ...row, entityId: randomUUID(), action: "RESERVE",
    metadata: { worst_case_micro_usd: over, model: input.model, audio_bytes: input.bytes, kind: "OVERRUN" } } });
}
/** One recording → text for the input box. Every refusal happens before the reservation or the network call. `settle`
 * (optional) records the provider-reported usage after the call; its failure never loses the transcript. */
export async function transcribeSecretaryAudio(input: { audio: unknown; seconds: unknown; directory: { professionals: readonly string[]; services: readonly string[]; customers?: readonly string[] };
  reserve: (reservation: TranscriptionReservation) => Promise<unknown>; settle?: (settlement: TranscriptionSettlement) => Promise<unknown>; env?: Env; fetchFn?: typeof fetch }): Promise<{ text: string }> {
  const env = input.env ?? process.env, config = transcribeConfig(env);
  assertTranscriptionAudio(input.audio, input.seconds);
  const [url, init] = transcriptionRequest(input.audio, config.model, transcriptionPrompt(input.directory), config);
  assertTranscriptionWire(url, init, config.model);
  const worstCaseMicroUsd = transcriptionWorstCaseMicroUsd(input.audio.size, input.seconds as number);
  if (worstCaseMicroUsd > config.budgetMicroUsd) throw Error("TRANSCRIBE_BUDGET");
  await input.reserve({ worstCaseMicroUsd, budgetMicroUsd: config.budgetMicroUsd, model: config.model, bytes: input.audio.size, salons: config.salons });
  const response = await transcriptionGuardedFetch(input.fetchFn ?? globalThis.fetch, config.model, env)(url, init);
  if (!response.ok) throw Error("TRANSCRIBE_FAILED");
  let json: unknown; try { json = await response.json(); } catch { throw Error("TRANSCRIBE_FAILED"); }
  // The call was billed whatever its text: the usage is recorded first.
  if (input.settle) {
    const settlement = { reservedMicroUsd: worstCaseMicroUsd, actualMicroUsd: transcriptionUsageMicroUsd((json as { usage?: unknown })?.usage, config.model) ?? null,
      seconds: input.seconds as number, bytes: input.audio.size, model: config.model };
    try { await input.settle(settlement); } catch { console.error("SECRETARY_TRANSCRIBE_SETTLE_FAILED"); }
  }
  const raw = typeof (json as { text?: unknown })?.text === "string" ? (json as { text: string }).text.replace(/\s+/g, " ").trim().slice(0, 1000) : "";
  const text = withoutPromptEcho(raw);
  if (raw !== text) console.info("SECRETARY_TRANSCRIBE_PROMPT_ECHO", JSON.stringify({ kept_chars: text.length, dropped_chars: raw.length - text.length }));
  if (!text) throw Error("TRANSCRIBE_EMPTY");
  return { text };
}
