import { describe, expect, it } from "vitest";
import { RouterTrace } from "../secretary-router";
import { turnBaseline, turnOutcome } from "../secretary-turn-outcome";
import { recordNameCheck, recordNameResolution, withNameObserver } from "../entity-suggestions";

/** C3 telemetry: booleans and closed codes only, bounded, absent when nothing was checked. */
describe("C3 name telemetry", () => {
  const session = { id: "session", skill: "auto", capability_status: "CONVERSATION" };
  const outcome = (trace: RouterTrace) => turnOutcome(session, turnBaseline(session, () => undefined), trace, { view: { message: "Oi" } as never }, { salt: () => "salt", previous: [] }).outcome;
  it("joins the message's outcome through the per-message observer and is sanitized in the router row", async () => {
    const trace = new RouterTrace();
    await withNameObserver(entry => trace.names(entry), async () => {
      recordNameCheck({ role: "customer", in_message: false, option_echo: false });
      await Promise.resolve();
      recordNameResolution("customer", "CONFIRM", 1);
      recordNameResolution("professional", "SUGGEST", 2);
    });
    // Outside the observer nothing is recorded (selections, other messages).
    recordNameResolution("service", "MATCH", 1);
    const result = outcome(trace);
    expect(result.name_checks).toEqual([{ role: "customer", in_message: false, option_echo: false }]);
    expect(result.name_resolution).toEqual([{ kind: "customer", outcome: "CONFIRM", n: 1 }, { kind: "professional", outcome: "SUGGEST", n: 2 }]);
    trace.outcome = { ...result, name_checks: [{ role: "Tatiana" as never, in_message: true, option_echo: false }, { role: "professional", in_message: "yes" as never, option_echo: false }],
      name_resolution: [{ kind: "customer", outcome: "Tatiana Rocha" as never, n: 1 }, { kind: "service", outcome: "NO_MATCH", n: -4 }] };
    expect(trace.snapshot().outcome).toMatchObject({ name_checks: [{ role: "professional", in_message: false, option_echo: false }], name_resolution: [{ kind: "service", outcome: "NO_MATCH", n: 0 }] });
    expect(JSON.stringify(trace.snapshot())).not.toContain("Tatiana");
  });
  it("is absent when no name was checked, and bounded per message", () => {
    expect(outcome(new RouterTrace())).not.toHaveProperty("name_checks");
    expect(outcome(new RouterTrace())).not.toHaveProperty("name_resolution");
    const trace = new RouterTrace();
    for (let i = 0; i < 40; i++) trace.names({ check: { role: "customer", in_message: true, option_echo: false }, resolution: { kind: "service", outcome: "MATCH", n: 1 } });
    expect(trace.nameChecks).toHaveLength(16); expect(trace.nameResolutions).toHaveLength(16);
  });
});
