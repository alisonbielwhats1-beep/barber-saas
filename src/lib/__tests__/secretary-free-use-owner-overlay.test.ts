import { afterEach, describe, expect, it, vi } from "vitest";
import { goldenSuite, ownerDecisionOracle } from "../../../packages/salon-secretary/evaluation/free-use-golden";

/** Owner decision 06/10/2026: with the optional cancel reason on, GF18 expects the cancellation ready to confirm on the first
 * turn, the reason never invented. Off, the historical expectation (wait for the reason) is untouched. */
afterEach(() => vi.unstubAllEnvs());
const gf18 = () => goldenSuite().cases.find(c => c.id === "GF18")!;
describe("Golden owner-decision overlay", () => {
  it("flag off: GF18 still waits for the reason, exactly as before", () => {
    vi.stubEnv("SALON_SECRETARY_CANCEL_REASON_OPTIONAL", "false");
    expect(ownerDecisionOracle()).toEqual({});
    const [first] = gf18().turns;
    expect(first.expect).toMatchObject({ confirmable: false, actions: [{ operation: "appointment.cancel", proposal: false, missingAll: ["reason"], forbiddenEffective: ["reason"] }] });
  });
  it("flag on: GF18 is ready to confirm without a reason, and the reason is still never invented", () => {
    vi.stubEnv("SALON_SECRETARY_CANCEL_REASON_OPTIONAL", "true");
    const [first, second] = gf18().turns;
    expect(first.expect).toMatchObject({ confirmable: true, actions: [{ operation: "appointment.cancel", proposal: true, forbiddenEffective: ["reason"],
      effective: { appointment_ref: "$ref:appointment:celia_quarta", date: "2027-04-14", time: "15:00" } }] });
    expect(first.expect).not.toHaveProperty("actions.0.missingAll");
    // A reason said after the cancellation is ready is still used: same draft, copied from the message, never gated on a question.
    expect(second.when).toBeUndefined();
    expect(second.expect).toMatchObject({ confirmable: true, actions: [{ operation: "appointment.cancel", proposal: true, sameDraft: true, sourceBackedEffective: ["reason"] }] });
    // Every other case is the same suite.
    vi.stubEnv("SALON_SECRETARY_CANCEL_REASON_OPTIONAL", "false");
    const off = goldenSuite(); vi.stubEnv("SALON_SECRETARY_CANCEL_REASON_OPTIONAL", "true"); const on = goldenSuite();
    expect(on.cases.filter(c => c.id !== "GF18")).toEqual(off.cases.filter(c => c.id !== "GF18"));
  });
});
