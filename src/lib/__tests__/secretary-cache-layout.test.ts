import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheLayoutEnabled, turnMessages } from "@everflair/salon-secretary";
import { contractProfileDigest } from "../../../packages/salon-secretary/evaluation/contract-version-profiles";

/** Cost (owner, 06/10/2026): flag SALON_SECRETARY_CACHE_LAYOUT=dynamic-last moves the per-turn data from the system role to the
 * start of the user turn, so the request opens with the byte-stable instructions and tool schema (the provider's prompt cache).
 * Off, nothing changes (the certified contract stays valid); on, the contract changes and needs its own certification. */
afterEach(() => vi.unstubAllEnvs());
const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: "true" };

describe("cache-friendly layout", () => {
  it("off (default): the historical messages, system data first", () => {
    expect(cacheLayoutEnabled()).toBe(false);
    expect(turnMessages("Contexto da conversa: {}", "Campos atuais do rascunho: {}", "remarca a Carla")).toEqual([
      { role: "system", content: "Contexto da conversa: {}" }, { role: "user", content: "Campos atuais do rascunho: {}" }, { role: "user", content: "remarca a Carla" }]);
  });
  it("on: no per-turn system message; the same text, in the same order, opens the user turn and the owner's message stays last", () => {
    vi.stubEnv("SALON_SECRETARY_CACHE_LAYOUT", "dynamic-last");
    const messages = turnMessages("Contexto da conversa: {}", "Campos atuais do rascunho: {}", "remarca a Carla");
    expect(messages).toEqual([{ role: "user", content: "Contexto da conversa: {}\n\nCampos atuais do rascunho: {}" }, { role: "user", content: "remarca a Carla" }]);
    expect(messages.some(m => m.role === "system")).toBe(false);
  });
  it("only the exact value turns it on", () => {
    for (const value of ["true", "1", "DYNAMIC-LAST", ""]) { vi.stubEnv("SALON_SECRETARY_CACHE_LAYOUT", value); expect(cacheLayoutEnabled()).toBe(false); }
  });
  it("the contract: unchanged while off, a new version while on (it must be certified before Production uses it)", () => {
    const base = contractProfileDigest(v2), off = contractProfileDigest({ ...v2, SALON_SECRETARY_CACHE_LAYOUT: "off" }), on = contractProfileDigest({ ...v2, SALON_SECRETARY_CACHE_LAYOUT: "dynamic-last" });
    expect(off.version).toBe(base.version);
    expect(on.version).not.toBe(base.version);
    expect(on.parts.runtime).not.toBe(base.parts.runtime);
    expect(on.parts.templates).toBe(base.parts.templates);
  });
});
