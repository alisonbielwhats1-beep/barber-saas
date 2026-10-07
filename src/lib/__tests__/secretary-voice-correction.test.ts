import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** C3 voice correction: directory-name suggestions for a dictated text (pure), and the server action behind its flag. */
const mocks = vi.hoisted(() => ({ context: vi.fn(), directory: vi.fn(), transcribe: vi.fn(), tenant: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../tenant", () => ({ getTenantContext: mocks.context, assertRole: (ctx: { role: string }, roles: string[]) => { if (!roles.includes(ctx.role)) throw new Error("FORBIDDEN"); } }));
vi.mock("../salon-secretary", () => ({ SalonSecretary: class {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (actor: unknown, work: (tx: object) => unknown) => { mocks.tenant(actor); return work(new Proxy({}, { get: (_target, key) => { throw Error(`TX_${String(key)}_FORBIDDEN`); } })); } }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), secretaryDirectory: mocks.directory }));
vi.mock("../secretary-transcribe", async original => ({ ...await original<object>(), transcribeSecretaryAudio: mocks.transcribe }));
import { dictationSuggestions } from "../secretary-voice-correction";
import { acceptDictationSuggestion } from "../secretary-ui";
import { suggestSecretaryDictation, transcribeSecretaryVoice } from "../../app/(admin)/servicos/secretaria/actions";

const directory = ["Rodrigo Alves", "Tatiana Rocha", "Marcia Lopes", "Corte Feminino", "Escova Progressiva", "Sobrancelha"];
const at = (text: string, word: string) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length, from: word });

describe("dictation suggestions (pure)", () => {
  it("offers the owner's example as a correction: 'rodrigues' → 'Rodrigo'", () => {
    const text = "bloqueia a agenda do rodrigues amanhã das 10 às 11";
    expect(dictationSuggestions(text, directory)).toEqual([{ ...at(text, "rodrigues"), to: "Rodrigo" }]);
  });
  it("corrects long or mid-sentence capitalized words by bounded edits, and a misheard name ending by its shared start", () => {
    const text = "marca a Tatiane pra escova progresiva";
    expect(dictationSuggestions(text, directory)).toEqual([{ ...at(text, "Tatiane"), to: "Tatiana" }, { ...at(text, "progresiva"), to: "Progressiva" }]);
    expect(dictationSuggestions("marca com a Marcya", directory)).toEqual([{ ...at("marca com a Marcya", "Marcya"), to: "Marcia" }]);
  });
  it("never touches correct names, dates, times, number words, short common words or inflections", () => {
    expect(dictationSuggestions("marca o Rodrigo Alves pro corte feminino segunda que vem às dezoito", directory)).toEqual([]);
    expect(dictationSuggestions("marca amanhã e desmarca a outra", ["Amanda Reis", ...directory])).toEqual([]);
    expect(dictationSuggestions("marca a cliente", directory)).toEqual([]);
    expect(dictationSuggestions("dois cortes e uma sobrancelha", directory)).toEqual([]);
    expect(dictationSuggestions("Marcya chegou", directory)).toEqual([]);
  });
  it("a word equally close to two names gets no suggestion (the owner is not asked to pick among guesses)", () => {
    expect(dictationSuggestions("com a Marcele", ["Marcela Dias", "Marcelo Reis"])).toEqual([]);
  });
  it("is bounded and deterministic", () => {
    const text = "Tatiane e Tatiane e Tatiane e Tatiane";
    expect(dictationSuggestions(text, directory)).toHaveLength(3);
    expect(dictationSuggestions(text, directory)).toEqual(dictationSuggestions(text, [...directory].reverse()));
  });
  it("accepting one correction edits the text and shifts the others; a changed text drops them", () => {
    const text = "Tatiane e Rodirgo amanhã";
    const items = [{ ...at(text, "Tatiane"), to: "Tatiana" }, { ...at(text, "Rodirgo"), to: "Rodrigo" }];
    const first = acceptDictationSuggestion(text, items, items[0])!;
    expect(first.text).toBe("Tatiana e Rodirgo amanhã");
    const second = acceptDictationSuggestion(first.text, first.items, first.items[0])!;
    expect(second).toEqual({ text: "Tatiana e Rodrigo amanhã", items: [] });
    expect(acceptDictationSuggestion("outro texto", items, items[0])).toBeUndefined();
  });
});

describe("server actions (flags default off)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SALON_SECRETARY_ENABLED", "true"); vi.stubEnv("APP_ENV", "test"); vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp");
    vi.stubEnv("DIRECT_URL", "postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp");
    mocks.context.mockResolvedValue({ salonId: "authenticated-salon", userId: "authenticated-user", role: "OWNER" });
    mocks.directory.mockResolvedValue({ professionals: ["Rodrigo Alves"], services: ["Corte Feminino"], today: { date: "2027-06-14", weekday: "segunda-feira", timezone: "America/Sao_Paulo" } });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("voice correction off: no suggestion, no authentication or directory work", async () => {
    expect(await suggestSecretaryDictation("bloqueia o rodrigues")).toEqual({ ok: true, suggestions: [] });
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.directory).not.toHaveBeenCalled();
  });
  it("voice correction on: authenticated actor, directory names only (never customers)", async () => {
    vi.stubEnv("SALON_SECRETARY_VOICE_CORRECTION", "true");
    expect(await suggestSecretaryDictation("bloqueia o rodrigues")).toEqual({ ok: true, suggestions: [{ start: 11, end: 20, from: "rodrigues", to: "Rodrigo" }] });
    expect(mocks.tenant).toHaveBeenCalledWith({ salonId: "authenticated-salon", userId: "authenticated-user" });
    expect(mocks.directory).toHaveBeenCalledOnce();
    mocks.context.mockResolvedValueOnce({ salonId: "s", userId: "u", role: "PROFESSIONAL" });
    expect(await suggestSecretaryDictation("bloqueia o rodrigues")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await suggestSecretaryDictation("x".repeat(1001))).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
  it("transcription off: refused before authentication, directory or provider work", async () => {
    const form = new FormData(); form.set("audio", new Blob(["x"], { type: "audio/webm" })); form.set("seconds", "2");
    expect(await transcribeSecretaryVoice(form)).toMatchObject({ ok: false, code: "TRANSCRIBE_DISABLED" });
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("transcription on: the provider module gets the recording and professional/service names only", async () => {
    vi.stubEnv("SALON_SECRETARY_TRANSCRIBE_ENABLED", "true");
    mocks.transcribe.mockResolvedValue({ text: "bloqueia o Rodrigo" });
    const audio = new Blob(["x"], { type: "audio/webm" }), form = new FormData(); form.set("audio", audio); form.set("seconds", "2.5");
    expect(await transcribeSecretaryVoice(form)).toEqual({ ok: true, text: "bloqueia o Rodrigo" });
    const call = mocks.transcribe.mock.calls[0][0];
    expect(call.directory).toEqual({ professionals: ["Rodrigo Alves"], services: ["Corte Feminino"] });
    expect(call.seconds).toBe(2.5); expect(call.audio).toBeInstanceOf(Blob);
    mocks.transcribe.mockRejectedValueOnce(Error("TRANSCRIBE_AUDIO_TOO_LARGE"));
    expect(await transcribeSecretaryVoice(form)).toMatchObject({ ok: false, code: "TRANSCRIBE_AUDIO_TOO_LARGE" });
    mocks.transcribe.mockRejectedValueOnce(Error("TRANSCRIBE_BUDGET"));
    expect(await transcribeSecretaryVoice(form)).toMatchObject({ ok: false, code: "TRANSCRIBE_BUDGET", error: "O limite de gasto da transcrição foi atingido. Você pode digitar." });
    // The reservation is the salon's own AuditLog budget, inside the tenant transaction of the authenticated actor.
    // Phase 3a review: the reservation carries the listed salons (program cap); an unlisted salon is refused before the tenant transaction.
    await expect(call.reserve({ worstCaseMicroUsd: 20_000, budgetMicroUsd: 100_000, model: "gpt-4o-mini-transcribe", bytes: 1, salons: ["authenticated-salon"] })).rejects.toThrow("TX_$executeRaw_FORBIDDEN");
    await expect(call.reserve({ worstCaseMicroUsd: 20_000, budgetMicroUsd: 100_000, model: "gpt-4o-mini-transcribe", bytes: 1, salons: ["other-salon"] })).rejects.toThrow("TRANSCRIBE_SALON_NOT_ENABLED");
    mocks.transcribe.mockRejectedValueOnce(Error("TRANSCRIBE_SALON_NOT_ENABLED"));
    expect(await transcribeSecretaryVoice(form)).toMatchObject({ ok: false, code: "TRANSCRIBE_SALON_NOT_ENABLED", error: "A voz da Secretária ainda não foi liberada para este salão. Você pode digitar." });
    expect(mocks.tenant).toHaveBeenLastCalledWith({ salonId: "authenticated-salon", userId: "authenticated-user" });
  });
  it("each transcription logs how long its steps took, in numbers only (never the audio or the text)", async () => {
    vi.stubEnv("SALON_SECRETARY_TRANSCRIBE_ENABLED", "true");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.transcribe.mockImplementation(async (input: { reserve: (r: object) => Promise<unknown> }) => {
      await input.reserve({ worstCaseMicroUsd: 1, budgetMicroUsd: 2, model: "gpt-4o-mini-transcribe", bytes: 3, salons: ["other-salon"] }).catch(() => undefined);
      return { text: "remarca a Joana Prado" };
    });
    const form = new FormData(); form.set("audio", new Blob(["abc"], { type: "audio/webm" })); form.set("seconds", "2.5");
    expect(await transcribeSecretaryVoice(form)).toEqual({ ok: true, text: "remarca a Joana Prado" });
    mocks.transcribe.mockRejectedValueOnce(Error("TRANSCRIBE_EMPTY"));
    expect(await transcribeSecretaryVoice(form)).toMatchObject({ ok: false, code: "TRANSCRIBE_EMPTY" });
    const logs = info.mock.calls.filter(call => call[0] === "SECRETARY_TRANSCRIBE_TIMING").map(call => JSON.parse(String(call[1])));
    expect(logs).toHaveLength(2);
    expect(Object.keys(logs[0]).sort()).toEqual(["audio_bytes", "auth_ms", "pipeline_ms", "provider_ms", "reserve_ms", "seconds", "total_ms", "vocabulary_ms"]);
    for (const log of logs) expect(Object.values(log).every(value => typeof value === "number")).toBe(true);
    expect(logs[0]).toMatchObject({ audio_bytes: 3, seconds: 2.5 });
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/Joana|Rodrigo|Corte/);
    info.mockRestore();
  });
});
