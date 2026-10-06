import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTranscriptionWire, transcribeConfig, transcribeSecretaryAudio, transcriptionKeywords, transcriptionUsageMicroUsd, TRANSCRIBE_KEYWORDS,
  TRANSCRIBE_STYLE, TRANSCRIBE_URL } from "../secretary-transcribe";

/** Owner 06/10/2026 (production pilot): gpt-transcribe (languages[], keywords[], per-second billing) and the voice's own
 * OpenAI project. Mocked fetch only: a stub that throws guards the real network. */
const env = (extra: Record<string, string> = {}) => ({ SALON_SECRETARY_TRANSCRIBE_ENABLED: "true", SALON_SECRETARY_ALLOW_PAID_CALLS: "true",
  SALON_SECRETARY_OPENAI_API_KEY: "secretary-key", SALON_SECRETARY_OPENAI_PROJECT: "secretary-project", SALON_SECRETARY_TRANSCRIBE_BUDGET_USD: "0.1",
  SALON_SECRETARY_TRANSCRIBE_SALONS: "ours", SALON_SECRETARY_TRANSCRIBE_MODEL: "gpt-transcribe", ...extra });
const directory = { professionals: ["Otávio Lins", "Raíssa Monteiro"], customers: ["Isabela Mattos", "Otávio Lins"], services: ["Corte masculino", "Pedicure"] };
const audio = () => new Blob([new Uint8Array(2048)], { type: "audio/webm;codecs=opus" });
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const free = () => vi.fn(async () => undefined);

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("gpt-transcribe wire", () => {
  it("sends languages[] and the directory names as keywords[], with only the style line as prompt", async () => {
    const fetchFn = reply({ text: "Remarca a Isabela Mattos", languages: [{ code: "pt" }], usage: { type: "duration", seconds: 7 } });
    expect(await transcribeSecretaryAudio({ audio: audio(), seconds: 3, directory, env: env(), fetchFn, reserve: free() })).toEqual({ text: "Remarca a Isabela Mattos" });
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect([...new Set(body.keys())]).toEqual(["file", "model", "languages[]", "response_format", "keywords[]", "prompt"]);
    expect(body.get("model")).toBe("gpt-transcribe"); expect(body.get("languages[]")).toBe("pt"); expect(body.has("language")).toBe(false);
    expect(body.get("prompt")).toBe(TRANSCRIBE_STYLE);
    // Professionals, then customers, then services; a repeated name goes once.
    expect(body.getAll("keywords[]")).toEqual(["Otávio Lins", "Raíssa Monteiro", "Isabela Mattos", "Corte masculino", "Pedicure"]);
  });

  it("keywords are whole, bounded names", () => {
    const many = Array.from({ length: 80 }, (_, i) => `Cliente ${i}`);
    const keywords = transcriptionKeywords({ professionals: ["  Ana   Lima ", "x".repeat(61)], services: [], customers: many });
    expect(keywords[0]).toBe("Ana Lima"); expect(keywords).toHaveLength(TRANSCRIBE_KEYWORDS.max);
    expect(keywords.every(keyword => keyword.length <= TRANSCRIBE_KEYWORDS.maxLength)).toBe(true);
  });

  it("the guard refuses language on gpt-transcribe, keywords on gpt-4o, a repeated single field and too many keywords", () => {
    const form = (fill: (body: FormData) => void) => { const body = new FormData(); body.set("file", audio(), "audio.webm"); fill(body); return { method: "POST", body }; };
    const valid = (body: FormData) => { body.set("model", "gpt-transcribe"); body.append("languages[]", "pt"); body.set("response_format", "json"); };
    expect(() => assertTranscriptionWire(TRANSCRIBE_URL, form(body => { valid(body); body.append("keywords[]", "Ana"); }), "gpt-transcribe")).not.toThrow();
    expect(() => assertTranscriptionWire(TRANSCRIBE_URL, form(body => { valid(body); body.set("language", "pt"); }), "gpt-transcribe")).toThrow("TRANSCRIBE_GUARD");
    expect(() => assertTranscriptionWire(TRANSCRIBE_URL, form(body => { valid(body); body.append("languages[]", "en"); }), "gpt-transcribe")).toThrow("TRANSCRIBE_GUARD");
    expect(() => assertTranscriptionWire(TRANSCRIBE_URL, form(body => { valid(body); for (let i = 0; i <= TRANSCRIBE_KEYWORDS.max; i++) body.append("keywords[]", `n${i}`); }), "gpt-transcribe"))
      .toThrow("TRANSCRIBE_GUARD");
    expect(() => assertTranscriptionWire(TRANSCRIBE_URL, form(body => { body.set("model", "gpt-4o-transcribe"); body.set("language", "pt"); body.set("response_format", "json");
      body.append("keywords[]", "Ana"); }), "gpt-4o-transcribe")).toThrow("TRANSCRIBE_GUARD");
  });

  it("prices the reported duration at US$ 0.0045 per minute (micro-USD, rounded up)", () => {
    expect(transcriptionUsageMicroUsd({ type: "duration", seconds: 7 }, "gpt-transcribe")).toBe(525);
    expect(transcriptionUsageMicroUsd({ type: "duration", seconds: 60 }, "gpt-transcribe")).toBe(4_500);
  });
});

describe("the voice's own OpenAI project", () => {
  it("uses its own key and project when both are set, and the Secretary's otherwise", () => {
    expect(transcribeConfig(env({ SALON_SECRETARY_TRANSCRIBE_OPENAI_API_KEY: "voice-key", SALON_SECRETARY_TRANSCRIBE_OPENAI_PROJECT: "voice-project" })))
      .toMatchObject({ apiKey: "voice-key", project: "voice-project", model: "gpt-transcribe" });
    expect(transcribeConfig(env())).toMatchObject({ apiKey: "secretary-key", project: "secretary-project" });
  });

  it("refuses half a configuration (a key without its project, or the reverse)", () => {
    expect(() => transcribeConfig(env({ SALON_SECRETARY_TRANSCRIBE_OPENAI_API_KEY: "voice-key" }))).toThrow("SECRETARY_CONFIGURATION_REQUIRED");
    expect(() => transcribeConfig(env({ SALON_SECRETARY_TRANSCRIBE_OPENAI_PROJECT: "voice-project" }))).toThrow("SECRETARY_CONFIGURATION_REQUIRED");
  });
});

describe("provider errors", () => {
  it("logs only the status, the provider's error code and the model, then fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchFn = reply({ error: { message: "That model does not exist", code: "model_not_found" } }, 404);
    await expect(transcribeSecretaryAudio({ audio: audio(), seconds: 3, directory, env: env(), fetchFn, reserve: free() })).rejects.toThrow("TRANSCRIBE_FAILED");
    expect(log).toHaveBeenCalledWith("SECRETARY_TRANSCRIBE_PROVIDER_ERROR", JSON.stringify({ status: 404, code: "model_not_found", model: "gpt-transcribe" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("does not exist");
  });
});
