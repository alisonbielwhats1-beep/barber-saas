import { describe, expect, it } from "vitest";
import * as api from "@everflair/salon-secretary";
import { discoveryInstructions, discoveryInstructionsV2, replacedInstruction, skillRegistry, turnDiscoveryInstructions } from "../../../packages/salon-secretary/src/skill-registry";

const unused: api.Model = { async getResponse() { throw Error("SHAPE_ONLY"); }, async *getStreamedResponse() { throw Error("NO_STREAM"); } };
/** Exactly what a decision-mode (V2) Luna call receives as instructions. */
const decisionInstructions = () => api.createServicesAgent(unused, () => {}, "discovery", true).instructions as string;

describe("chained instruction edits fail closed", () => {
  it("replaces a present target (string or pattern) and throws on an absent one", () => {
    expect(replacedInstruction("a b c", "b", "x")).toBe("a x c");
    expect(replacedInstruction("linha um.\nfim", /linha [^\n]+/, "nova")).toBe("nova\nfim");
    expect(() => replacedInstruction("a b c", "z", "x")).toThrow("INSTRUCTION_REPLACE_TARGET_MISSING");
    expect(() => replacedInstruction("a b c", /z+/g, "x")).toThrow("INSTRUCTION_REPLACE_TARGET_MISSING");
  });
  it("V1-only rules never reach the decision-mode instructions", () => {
    const text = decisionInstructions();
    expect(text).toContain(turnDiscoveryInstructions);
    for (const phrase of ["Até quatro operações", "retorne operations=[]", "disposition=", "conversation_response", "independent=true"]) expect(text).not.toContain(phrase);
    // The V1 discovery contract itself is unchanged: the replaced rules still exist there.
    expect(discoveryInstructions).toContain("Até quatro operações INDEPENDENTES.");
    expect(discoveryInstructionsV2).not.toContain("Até quatro operações");
  });
});

describe("agenda vocabulary and per-action clauses in the published instructions", () => {
  it("closing a professional's agenda is schedule.block; closing the salon is salon_hours (out of catalog)", () => {
    const text = decisionInstructions();
    expect(text).toContain("Fechar, travar, trancar ou bloquear a agenda (ou os horários) de um profissional, das X às Y ou o dia todo, também é schedule.block");
    expect(text).toContain("dia dito depois do intervalo (\"das 10 às 11 do dia 28\") é o date do bloqueio");
    expect(text).toContain("Fechar ou abrir o salão, o expediente ou o horário de funcionamento (sem um profissional) é salon_hours, fora do catálogo.");
  });
  it("each operation of a compound request quotes its own clause in source_scope", () => {
    expect(decisionInstructions()).toContain("Com 2+ operações, source_scope de CADA uma é a cópia exata e contígua da oração que a descreve");
  });
  it("the audited registry (operations/version/enabled) is untouched", () => {
    expect(skillRegistry.find(entry => entry.skill_id === "scheduling")).toMatchObject({ version: "1.2.0", enabled: true,
      operations: ["appointment.create", "appointment.list", "appointment.read", "availability.get", "appointment.change", "appointment.cancel", "schedule.block"] });
  });
});
