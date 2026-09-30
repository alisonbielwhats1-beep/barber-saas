import { randomUUID } from "node:crypto";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";

/** C3 voice, GPT transcription: READY BUT OFF (owner decision 28/09/2026, zero cost until enabled).
 * The recorder's audio goes to the audio transcription endpoint only when SALON_SECRETARY_TRANSCRIBE_ENABLED=true AND
 * paid calls are allowed AND a transcription budget is set. Its own guard: one allowlisted URL, fixed multipart fields,
 * allowlisted models, size and duration caps. Its own budget: every call is reserved at its worst case in the salon's
 * append-only AuditLog before the network (per salon and UTC month). Evaluation runners compose the same guarded fetch
 * with the program real-spend ledger (source 'transcribe', sealed estimator 'transcriptions'); runtime code never imports
 * evaluation code. The Luna cost guard (openai-cost-guard.ts) is neither used nor widened. The vocabulary prompt carries
 * professional and service names only, never customers. The text is returned to the input box: never sent. */
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
/** Directory names only (the same bounded list Luna sees), deduplicated and cut at a whole name. */
export function transcriptionPrompt(directory: { professionals: readonly string[]; services: readonly string[] }) {
  const names = [...new Set([...directory.professionals, ...directory.services].map(name => name.replace(/\s+/g, " ").trim()).filter(Boolean))];
  let prompt = "Agenda de salão de beleza. Profissionais e serviços:";
  for (const name of names) { if (prompt.length + name.length + 2 > TRANSCRIBE_PROMPT_MAX) break; prompt += ` ${name},`; }
  return prompt.replace(/,$/, ".");
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
  return [TRANSCRIBE_URL, { method: "POST", headers: { Authorization: `Bearer ${auth.apiKey}`, "OpenAI-Project": auth.project }, body }];
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
/** One recording → text for the input box. Every refusal happens before the reservation or the network call. */
export async function transcribeSecretaryAudio(input: { audio: unknown; seconds: unknown; directory: { professionals: readonly string[]; services: readonly string[] };
  reserve: (reservation: TranscriptionReservation) => Promise<unknown>; env?: Env; fetchFn?: typeof fetch }): Promise<{ text: string }> {
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
  const text = typeof (json as { text?: unknown })?.text === "string" ? (json as { text: string }).text.replace(/\s+/g, " ").trim().slice(0, 1000) : "";
  if (!text) throw Error("TRANSCRIBE_EMPTY");
  return { text };
}
