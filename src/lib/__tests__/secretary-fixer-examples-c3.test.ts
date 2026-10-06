import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { composeExamples, availableExampleFeatures, type ExamplesState } from "../../../packages/salon-secretary/src/examples/select";
import { secretaryContractParts } from "@everflair/salon-secretary";

/** Fixer (adversarial review B, finding 1): with the Candidate 3 flag set (SAME_AS, TEMPORAL_POLARITY, components, JIT, structured
 * context, EXAMPLES=selected) and every Candidate 4 flag off, the examples block Luna reads is the Candidate 3 one. The digests were
 * computed from the Candidate 3 tree (commit 4a50fb0 + the before-c4 snapshot, bank sha 852b7498) over the same messages and states,
 * once: 48 blocks per wire. The historical same_as/polarity entries are served only with SALON_SECRETARY_EXAMPLES_V2. */
const C3 = { SALON_SECRETARY_TEMPORAL_COMPONENTS: "true", SALON_SECRETARY_TEMPORAL_POLARITY: "true", SALON_SECRETARY_SAME_AS: "true", SALON_SECRETARY_JIT_INSTRUCTIONS: "true",
  SALON_SECRETARY_STRUCTURED_CONTEXT: "true", SALON_SECRETARY_NAME_SUGGESTIONS: "true", SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD: "true", SALON_SECRETARY_PERSISTED_STATE: "true",
  SALON_SECRETARY_EXAMPLES: "selected", SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: "true" };
const CANDIDATE3_DIGEST = { components: "6400f4792f36cc8ecabfaf08997be1a871037e8e61eac5deb9a370a0d21a5182", legacy: "68eeec5c958ab6d9246043256c58a9552bb4f88ee9468cfeaffa6604a0766ece" };
const messages = ["cancela a Lia de amanhã e coloca o Téo no mesmo horário", "marca a Bia amanhã, menos às 10", "marca a Nina na sexta, mas não às 9", "desmarca a Olga de quinta e põe a Iara no lugar dela",
  "marca corte pro Davi amanhã às 15 e barba no mesmo dia às 16", "bloqueia a agenda da Nara amanhã das 12 às 13", "remarca a Bia pra sexta no mesmo horário", "qualquer horário menos de manhã",
  "marca a Lia e a Bia amanhã, a Lia às 9 e a Bia logo depois", "tem horário pra escova quinta que não seja às 10?", "oi, tudo bem?", "marca a Jade amanhã às 10 pra gel com a Nara",
  "passa o Téo pra quinta toda semana", "vê a agenda da Nara e passa o último cliente dela pra sexta", "a Ana tá marcada pra quando?", "troca a barba por pezinho do Kevin"];
const all = new Set(["NEW", "ADD", "PATCH", "DISCARD", "CONVERSATION", "UNSUPPORTED", "AMBIGUOUS"]);
const states: ExamplesState[] = [
  { kind: "NEW", pending: 0, operations: [], fields: [], modes: new Set(["NEW", "CONVERSATION", "UNSUPPORTED", "AMBIGUOUS"]) },
  { kind: "ANSWER", pending: 1, operations: ["appointment.create"], fields: ["time"], modes: all },
  { kind: "PLAN", pending: 0, operations: ["appointment.cancel"], fields: [], modes: all },
];
const digest = () => createHash("sha256").update(states.flatMap(state => messages.map(message => { const block = composeExamples("selected", message, state, 20000); return `${block.ids.join(",")}|${block.text}`; })).join("\n")).digest("hex");
afterEach(() => vi.unstubAllEnvs());

describe("review B: the Candidate 3 flag set serves the Candidate 3 examples", () => {
  it.each([["components", "true"], ["legacy", "false"]] as const)("%s wire: byte-identical to Candidate 3 (48 blocks)", (wire, components) => {
    for (const [key, value] of Object.entries(C3)) vi.stubEnv(key, value);
    vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", components);
    expect(digest()).toBe(CANDIDATE3_DIGEST[wire]);
    // Sensitive: the same flag set with EXAMPLES_V2 serves the historical same_as/polarity entries, so the block changes.
    vi.stubEnv("SALON_SECRETARY_EXAMPLES_V2", "true");
    expect(digest()).not.toBe(CANDIDATE3_DIGEST[wire]);
  });
  it("same_as/polarity need EXAMPLES_V2; the contract names it only when on (and only with examples on)", () => {
    expect([...availableExampleFeatures({ ...C3 })].sort()).toEqual(["components", "discard"].filter(feature => feature !== "components" || process.env.SALON_SECRETARY_TEMPORAL_COMPONENTS === "true").sort());
    expect([...availableExampleFeatures({ ...C3, SALON_SECRETARY_EXAMPLES_V2: "true" })]).toEqual(expect.arrayContaining(["same_as", "polarity"]));
    for (const [key, value] of Object.entries(C3)) vi.stubEnv(key, value);
    expect(secretaryContractParts().flags).not.toHaveProperty("examplesV2");
    vi.stubEnv("SALON_SECRETARY_EXAMPLES_V2", "true");
    expect(secretaryContractParts().flags).toHaveProperty("examplesV2", true);
    vi.stubEnv("SALON_SECRETARY_EXAMPLES", "off");
    expect(secretaryContractParts().flags).not.toHaveProperty("examplesV2");
  });
});
