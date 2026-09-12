import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { openConversation, sealConversation } from "./orchestrator-conversation";
import type { OrchestratorConversation } from "@everflare/agents/orchestrator";
const secret = "synthetic-secret-for-tests-at-least-thirty-two";
const state: OrchestratorConversation = { mode: "customer", triage: { target_agent: "SALES", event_type: "NEW_LEAD", priority: "LOW", requires_human_approval: false }, triageOutput: "raw", pendingApproval: false, history: [{ message: "Olá", agent: "SALES", output: "Oi" }] };
afterEach(() => vi.useRealTimers());
it("round-trips opaque state without exposing conversation text", () => {
  const token = sealConversation(state, "admin", "registry", secret);
  expect(openConversation(token, "admin", "registry", secret)).toEqual(state);
  expect(Buffer.from(token, "base64url").toString()).not.toContain("NEW_LEAD");
});
it.each(["actor", "registry", "key", "content"])("rejects changed %s", field => {
  const token = sealConversation(state, "admin", "registry", secret);
  expect(() => openConversation(field === "content" ? `Z${token.slice(1, -5)}changed` : token, field === "actor" ? "other" : "admin", field === "registry" ? "other" : "registry", field === "key" ? secret + "other" : secret)).toThrow();
});
it("expires after two hours", () => {
  vi.useFakeTimers(); const token = sealConversation(state, "admin", "registry", secret);
  vi.advanceTimersByTime(7200001); expect(() => openConversation(token, "admin", "registry", secret)).toThrow();
});
it("refuses oversized or malformed tokens and absent secret", () => {
  for (const token of ["!", "short", "x".repeat(800001)]) expect(() => openConversation(token, "admin", "registry", secret)).toThrow();
  expect(() => sealConversation(state, "admin", "registry", "")).toThrow();
});
