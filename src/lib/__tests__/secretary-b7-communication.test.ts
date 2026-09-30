import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyCommunicationInterpretation, communicationState, reconcileMessageContent } from "../secretary-communication";
import { suggestedTextLabel } from "../secretary-display";
import { actionDetails } from "../secretary-ui";
import type { SecretaryView } from "../salon-secretary";

/** B7 (rec 4): Luna's message_mode is trusted without a verb list. EXACT still needs the owner's own quoted text; a
 * GENERATED text is Luna's draft, shown as a suggestion to review, and only a separate explicit confirmation could send
 * it (fake provider). C08: "Pode sugerir um texto educado." no longer loops. Tenant ports are fixtures (no DB). */
const ports = vi.hoisted(() => ({ draft: vi.fn(), propose: vi.fn(), confirm: vi.fn(), search: vi.fn() }));
vi.mock("../prisma-tenant", () => ({ withTenant: async (_actor: unknown, fn: (tx: object) => unknown) => fn({}) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), searchSalonCustomer: ports.search }));
vi.mock("../communication-actions", async original => ({ ...await original<object>(), getCustomerMessageContext: async () => ({ channel_eligible: true }),
  upsertMessageDraft: ports.draft, proposeCustomerMessage: ports.propose, confirmCustomerMessage: ports.confirm }));
const actor = { salonId: "tenant-a", userId: "owner-a" };
type DraftInput = { patch: Record<string, unknown> };
let fields: Record<string, unknown> = {};
beforeEach(() => {
  vi.clearAllMocks(); fields = {};
  ports.search.mockResolvedValue([{ id: "client-joao", name: "João Pedro", phone: "(11) *****-0001" }]);
  ports.draft.mockImplementation(async (_tx: unknown, _actor: unknown, input: DraftInput) => {
    fields = { ...fields, ...Object.fromEntries(Object.entries(input.patch).filter(([, value]) => value !== undefined)) };
    const missing = ["channel", "message_mode", "content"].filter(key => fields[key] === undefined);
    return { draft_ref: "message-draft", draft_revision: 1, recipient: { name: "João Pedro" }, fields: { ...fields }, status: missing.length ? "NEEDS_INPUT" : "READY", missing_fields: missing };
  });
  ports.propose.mockImplementation(async () => ({ proposal_ref: "proposal", draft_revision: 1, fields: { ...fields }, recipient: { name: "João Pedro" },
    preview: `MENSAGEM — SIMULAÇÃO LOCAL\nPara: João Pedro ((11) *****-0001)\nCanal: WhatsApp (fake, sem envio externo)\nMensagem:\n${String(fields.content)}` }));
});

describe("GENERATED is Luna's suggestion; EXACT is the owner's quote", () => {
  it("C08: 'Pode sugerir um texto educado.' becomes a reviewed suggestion, not a repeated question; nothing is confirmed", async () => {
    const state = communicationState(); state.query = "João"; state.fields = { channel: "WHATSAPP" };
    const suggestion = "Olá, João! Precisamos cancelar seu horário de amanhã. Pedimos desculpas e ficamos à disposição para remarcar.";
    await applyCommunicationInterpretation(actor, state, { message_mode: "GENERATED", content: suggestion }, "Pode sugerir um texto educado.");
    expect(state.fields).toEqual({ channel: "WHATSAPP", message_mode: "GENERATED", content: suggestion });
    expect(state.proposal).toBeDefined();
    expect(state.message.split("\n")[0]).toBe(suggestedTextLabel);
    expect(state.message).toContain(suggestion);
    expect(ports.confirm).not.toHaveBeenCalled();
    // The card shows the same label above the exact suggested text.
    const details = actionDetails({ sessionId: "s", cancelled: false, message: state.message, communication: state } as unknown as SecretaryView);
    expect(details.startsWith(`${suggestedTextLabel}\nMENSAGEM — SIMULAÇÃO LOCAL`)).toBe(true);
  });
  it("an EXACT text is never labeled a suggestion; an unquoted EXACT is still refused; a quote always wins as EXACT", async () => {
    const state = communicationState(); state.query = "João"; state.fields = { channel: "WHATSAPP" };
    await applyCommunicationInterpretation(actor, state, { message_mode: "EXACT", content: "Até amanhã." }, "Mande para o João: “Até amanhã.”");
    expect(state.fields).toMatchObject({ message_mode: "EXACT", content: "Até amanhã." });
    expect(state.message).not.toContain(suggestedTextLabel);
    expect(() => reconcileMessageContent({}, { message_mode: "EXACT", content: "Até amanhã." }, "Mande para o João que é até amanhã")).toThrow("MESSAGE_CONTENT_REVIEW_REQUIRED");
    expect(reconcileMessageContent({}, { message_mode: "GENERATED", content: "Outro texto" }, "Mande para o João: “Até amanhã.”")).toEqual({ message_mode: "EXACT", content: "Até amanhã." });
    expect(() => reconcileMessageContent({}, { content: "Sem modo" }, "Mande algo")).toThrow("MESSAGE_CONTENT_REVIEW_REQUIRED");
  });
  it("a blank GENERATED text is no content: the text is still asked, never sent empty", () => {
    expect(reconcileMessageContent({ channel: "WHATSAPP" }, { message_mode: "GENERATED", content: "   " }, "pode sugerir")).toEqual({ channel: "WHATSAPP", message_mode: "GENERATED" });
    expect(reconcileMessageContent({ content: "  texto  ", message_mode: "EXACT" }, { channel: "WHATSAPP" }, "WhatsApp")).toMatchObject({ content: "  texto  ", message_mode: "EXACT" });
  });
});
