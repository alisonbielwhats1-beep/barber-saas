import { afterEach, describe, expect, it, vi } from "vitest";

/** C5 agent (docs/c5-spike/11-especificacao-agente.md §6.2, §8.1 "Sessão"; objection 18): the persisted conversation carries the agent's open
 * operation question (`agentPending`) and the plan it built (`agentPlan`) in the strict stored shape, whatever SALON_SECRETARY_AGENT says when it
 * is loaded (an invalid stored state would remove the conversation). The message's refs never become state: the binding refuses to be
 * serialized and the stored shape has no place for it. Synthetic values only. */
vi.mock("../prisma-tenant", () => ({ withTenant: vi.fn() }));
import { parseStoredAggregate, storedSession, STORED_AGGREGATE_SCHEMA } from "../secretary-session-state";
import { decodeConversationState, encodeConversationState } from "../secretary-session-store";
import { createAgentBinding } from "../../../packages/salon-secretary/src/agent-context";

afterEach(() => { vi.unstubAllEnvs(); });
const ROOT = "3f6d2c1e-8a4b-4c5d-9e7f-102938475601", PLAN = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const root = (extra: Record<string, unknown> = {}) => ({ id: ROOT, skill: "auto", expires: 1_900_000_000_000, turns: 1, cancelled: false, ...extra });
const aggregate = (session: Record<string, unknown>) => ({ schema: STORED_AGGREGATE_SCHEMA, root: ROOT, sessions: [session] });
const roundTrip = (session: Record<string, unknown>) => parseStoredAggregate(decodeConversationState(encodeConversationState(aggregate(session))));
const PENDING = { question: "Pergunta sintética de operação?", thread: ["primeira mensagem sintética"], turns: 1 };

describe("stored agent state", () => {
  it("saves and loads the open operation question and the agent plan's ref", () => {
    vi.stubEnv("SALON_SECRETARY_AGENT", "true");
    const loaded = roundTrip(root({ agentPending: PENDING, agentPlan: PLAN }));
    expect(loaded.sessions[0]).toMatchObject({ agentPending: PENDING, agentPlan: PLAN });
  });
  it("a conversation saved with the flag on loads with it off (the stored shape never reads the flag)", () => {
    vi.stubEnv("SALON_SECRETARY_AGENT", "true");
    const text = encodeConversationState(aggregate(root({ agentPending: { ...PENDING, thread: ["um", "dois"], turns: 2 }, agentPlan: PLAN })));
    vi.stubEnv("SALON_SECRETARY_AGENT", "false");
    expect(() => parseStoredAggregate(decodeConversationState(text))).not.toThrow();
    vi.unstubAllEnvs();
    expect(() => parseStoredAggregate(decodeConversationState(text))).not.toThrow();
  });
  it("an old conversation without the agent keys still loads", () => {
    expect(roundTrip(root()).sessions[0]).not.toHaveProperty("agentPending");
  });
  it("refuses a malformed agent state (the conversation fails closed, never half-loaded)", () => {
    const bad: Record<string, unknown>[] = [
      { agentPending: { ...PENDING, thread: ["a", "b", "c"] } },
      { agentPending: { ...PENDING, turns: 3 } },
      { agentPending: { ...PENDING, question: "x".repeat(201) } },
      { agentPending: { ...PENDING, thread: ["y".repeat(2001)] } },
      { agentPending: { ...PENDING, extra: true } },
      { agentPending: { question: PENDING.question, thread: PENDING.thread } },
      { agentPlan: true },
      { agentPlan: "nao-e-um-uuid" },
    ];
    for (const extra of bad) expect(() => roundTrip(root(extra)), JSON.stringify(Object.keys(extra))).toThrow("SESSION_STATE_INVALID");
  });
});

describe("the message's refs are never state", () => {
  it("a binding cannot be encoded into a conversation, and the strict shape has no field for it", () => {
    const binding = createAgentBinding();
    binding.bind("p", "prof-sintetico", { name: "Pessoa Sintética" });
    expect(() => JSON.stringify(binding)).toThrow("AGENT_BINDING_NOT_SERIALIZABLE");
    expect(() => encodeConversationState(aggregate(root({ binding })))).toThrow();
    expect(storedSession.safeParse(root({ binding: { p1: "prof-sintetico" } })).success).toBe(false);
    expect(storedSession.safeParse(root({ agentBinding: [] })).success).toBe(false);
  });
});
