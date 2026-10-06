import { afterEach, describe, expect, it, vi } from "vitest";
import { closestByLetters, phoneticPrefixes, phoneticToken, rankNameSuggestions, samePhoneticName } from "../name-search";
import { suggestSalonCustomers } from "../entity-suggestions";
import { transcriptionPrompt, TRANSCRIBE_PROMPT_MAX } from "../secretary-transcribe";
import type { Tx } from "../prisma-tenant";
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), assertCustomerAccess: async () => undefined }));

/** Owner 05/10: "quando eu falo Walter, às vezes o nome da cliente é com V; Isabela com dois L" must not be a roadblock. */
afterEach(() => vi.unstubAllEnvs());

describe("names as they sound", () => {
  it.each([["Walter", "Valter"], ["Isabella", "Isabela"], ["Luiza", "Luisa"], ["Thiago", "Tiago"], ["Raphael", "Rafael"], ["Kauan", "Cauan"],
    ["Helena", "Elena"], ["Gessica", "Jéssica"], ["Thaynara", "Tainara"], ["Souza", "Sousa"], ["Raquel", "Rakel"], ["Cecília", "Secília"], ["Michelle", "Michele"]])(
    "%s sounds like %s", (a, b) => expect(phoneticToken(a)).toBe(phoneticToken(b)));

  it.each([["Walter", "Vanessa"], ["Ana", "Ane"], ["Maria", "Mario"], ["Carla", "Clara"], ["Lucas", "Lucia"], ["Bruna", "Bruno"]])(
    "%s never sounds like %s", (a, b) => expect(phoneticToken(a)).not.toBe(phoneticToken(b)));

  it("matches every said word with its own word of the registered name", () => {
    expect(samePhoneticName("walter", "Valter Souza")).toBe(true);
    expect(samePhoneticName("a isabella", "Isabela Mattos")).toBe(true);
    expect(samePhoneticName("walter souza", "Valter Sousa")).toBe(true);
    expect(samePhoneticName("walter silva", "Valter Souza")).toBe(false);
    expect(samePhoneticName("isa", "Isabela Mattos")).toBe(false);
  });

  it("reaches the other starts of the same sound", () => {
    expect(phoneticPrefixes("walter")).toEqual(expect.arrayContaining(["wa", "va"]));
    expect(phoneticPrefixes("helena")).toEqual(expect.arrayContaining(["he", "el"]));
    expect(phoneticPrefixes("thiago")).toEqual(expect.arrayContaining(["th", "ti"]));
    expect(phoneticPrefixes("tiago")).toEqual(expect.arrayContaining(["ti", "th"]));
    expect(phoneticPrefixes("kauan")).toEqual(expect.arrayContaining(["ka", "ca"]));
  });

  it("ranks the sound-alike first only with the flag", () => {
    const rows = [{ id: "v", name: "Valter Souza" }, { id: "m", name: "Walmir Costa" }, { id: "x", name: "Vanessa Lima" }];
    vi.stubEnv("SALON_SECRETARY_PHONETIC_NAMES", "true");
    const on = rankNameSuggestions("Walter", rows);
    expect(on.status === "SUGGEST" && on.rows[0].id).toBe("v");
  });
});

describe("customer suggestions reach the other spelling (prefilter)", () => {
  const tx = (seen: unknown[]) => ({
    $queryRaw: vi.fn(async (_parts: TemplateStringsArray, ...values: unknown[]) => { seen.push(...values); return [{ id: "v", name: "Valter Souza", phone: null }]; }),
    membership: { findFirst: vi.fn(async () => ({ role: "OWNER" })) },
    $queryRawUnsafe: vi.fn(), salon: { findUnique: vi.fn(async () => ({ accessStatus: "APPROVED" })) },
  }) as unknown as Tx;
  it("asks the database for the 'va' start too when the flag is on", async () => {
    vi.stubEnv("SALON_SECRETARY_PHONETIC_NAMES", "true");
    const seen: unknown[] = [];
    const found = await suggestSalonCustomers(tx(seen), { salonId: "s", userId: "u" }, "Walter").catch(error => ({ error }));
    const pattern = seen.find(value => typeof value === "string" && value.includes("[^a-z0-9]")) as string | undefined;
    expect(found).toMatchObject({ status: "SUGGEST" });
    expect(pattern).toBeDefined();
    expect(pattern!.split(/[(|)?:]/)).toContain("va");
  });
});

describe("transcription vocabulary", () => {
  const directory = { professionals: ["Otávio Lins", "Juliana Takeda"], services: ["Corte masculino", "Pedicure"] };
  it("is unchanged without customers' names", () => {
    expect(transcriptionPrompt(directory)).toContain("Profissionais e serviços: Otávio Lins, Juliana Takeda, Corte masculino, Pedicure.");
  });
  it("names professionals, customers and services, within the limit", () => {
    const prompt = transcriptionPrompt({ ...directory, customers: ["Valter Souza", "Isabela Mattos"] });
    expect(prompt).toContain("Profissionais: Otávio Lins, Juliana Takeda. Clientes: Valter Souza, Isabela Mattos. Serviços: Corte masculino, Pedicure.");
    const many = transcriptionPrompt({ ...directory, customers: Array.from({ length: 200 }, (_, i) => `Cliente Número ${i}`) });
    expect(many.length).toBeLessThanOrEqual(TRANSCRIBE_PROMPT_MAX);
    expect(many).toMatch(/Clientes: Cliente Número 0, /);
  });
});

describe("a service the voice heard as other words", () => {
  const services = ["Pedicure", "Manicure", "Manicure + Pedicure", "Hidratação capilar", "Corte masculino", "Barba", "Escova progressiva", "Sobrancelha"]
    .map((name, i) => ({ id: String(i), name }));
  it.each([["pedido curto", "Pedicure"], ["mani cure", "Manicure"], ["idrata são capilar", "Hidratação capilar"], ["escova progreciva", "Escova progressiva"]])(
    "%s → %s first", (said, service) => {
      const found = closestByLetters(said, services);
      expect(found.status === "SUGGEST" && found.rows[0].name).toBe(service);
    });
  it("offers nothing far away", () => expect(closestByLetters("massagem relaxante", services).status).toBe("NONE"));
});
