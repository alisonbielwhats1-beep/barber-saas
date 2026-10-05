import { describe, expect, it } from "vitest";
import { canGrantException, collectExceptionCauses, exceptionHash, exceptionQuestion, exceptionReply, scheduleExceptionsEnabled, type ExceptionSkips } from "../schedule-exception-policy";

/** A fake domain inspector: returns the first cause not yet skipped, like availabilityViolation does. */
const domain = (layers: { violation: string; skippedBy?: keyof ExceptionSkips }[], conflicts: { kind: "APPOINTMENT" | "RESOURCE" | "WAITLIST" }[] = []) =>
  async (skips: ExceptionSkips) => {
    const open = layers.find(layer => !(layer.skippedBy && skips[layer.skippedBy]) && !(skips.skipSchedule && ["OUTSIDE_WORKING_HOURS", "PROFESSIONAL_UNAVAILABLE", "WORKING_HOURS_BREAK", "AFTER_WORKING_HOURS"].includes(layer.violation)));
    return { violation: open?.violation ?? null, conflicts: open?.violation === "SLOT_TAKEN" ? conflicts : [] };
  };

describe("schedule exception policy", () => {
  it("needs its own flag and the overlap review machinery", () => {
    expect(scheduleExceptionsEnabled({ SALON_SECRETARY_SCHEDULE_EXCEPTIONS: "true" })).toBe(process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED === "true");
    expect(scheduleExceptionsEnabled({})).toBe(false);
  });

  it("collects every cause of one slot, probing a block hidden by the schedule override", async () => {
    const result = await collectExceptionCauses(domain([{ violation: "OUTSIDE_WORKING_HOURS" }, { violation: "SLOT_TAKEN" }], [{ kind: "APPOINTMENT" }]), async () => true);
    expect(result.causes).toEqual(["OUTSIDE_WORKING_HOURS", "PROFESSIONAL_UNAVAILABLE", "SLOT_TAKEN"]);
    expect(result.hard).toEqual([]);
    expect(result.final?.violation).toBe("SLOT_TAKEN");
  });

  it("walks block, break and after-hours with their own skips", async () => {
    const result = await collectExceptionCauses(domain([
      { violation: "PROFESSIONAL_UNAVAILABLE", skippedBy: "skipTimeOff" }, { violation: "WORKING_HOURS_BREAK", skippedBy: "skipWorkingHoursBreak" },
    ]), async () => false);
    expect(result.causes).toEqual(["PROFESSIONAL_UNAVAILABLE", "WORKING_HOURS_BREAK"]);
    expect(result.final?.violation).toBeNull();
  });

  it("keeps closures, resources, waitlist offers and a cause that survives its skip as hard blocks", async () => {
    expect((await collectExceptionCauses(domain([{ violation: "SALON_CLOSED" }]), async () => false)).hard).toEqual(["SALON_CLOSED"]);
    expect((await collectExceptionCauses(domain([{ violation: "SLOT_TAKEN" }], [{ kind: "RESOURCE" }]), async () => false)).hard).toEqual(["RESOURCE"]);
    expect((await collectExceptionCauses(domain([{ violation: "TOO_SOON" }]), async () => false)).hard).toEqual(["TOO_SOON"]);
    // Crossing midnight: the domain answers OUTSIDE even with the schedule skipped.
    const stuck = await collectExceptionCauses(async () => ({ violation: "OUTSIDE_WORKING_HOURS", conflicts: [] }), async () => false);
    expect(stuck.hard).toEqual(["OUTSIDE_WORKING_HOURS"]);
  });

  it("grants the same roles as the agenda", () => {
    expect(canGrantException("PROFESSIONAL", ["OUTSIDE_WORKING_HOURS", "WORKING_HOURS_BREAK"])).toBe(true);
    expect(canGrantException("PROFESSIONAL", ["OUTSIDE_WORKING_HOURS", "PROFESSIONAL_UNAVAILABLE"])).toBe(false);
    expect(canGrantException("MANAGER", ["PROFESSIONAL_UNAVAILABLE", "AFTER_WORKING_HOURS", "SLOT_TAKEN"])).toBe(true);
    expect(canGrantException("RECEPTIONIST", ["OUTSIDE_WORKING_HOURS"])).toBe(false);
    expect(canGrantException("OWNER", [])).toBe(false);
    expect(canGrantException("OWNER", ["SALON_CLOSED"])).toBe(false);
  });

  it("asks one question naming every cause and the free times", () => {
    expect(exceptionQuestion("appointment.create", ["OUTSIDE_WORKING_HOURS"], "Otávio Lins", "2026-10-12T21:30", [], ["2026-10-12T10:00", "2026-10-12T10:30"]))
      .toBe("Esse horário fica fora do expediente de Otávio Lins. Quer agendar mesmo assim ou escolher outro horário? Livres: 10h, 10h30.");
    expect(exceptionQuestion("appointment.change", ["PROFESSIONAL_UNAVAILABLE", "SLOT_TAKEN"], "Otávio Lins", "2026-10-12T15:00", ["2026-10-12T14:30"], []))
      .toBe("Esse horário está bloqueado na agenda de Otávio Lins (folga ou bloqueio) e tem outro atendimento às 14h30. Quer remarcar mesmo assim ou escolher outro horário?");
  });

  it("binds a consent to the slot and its causes", () => {
    const base = { causes: ["OUTSIDE_WORKING_HOURS"], startLocal: "2026-10-12T21:00", endLocal: "2026-10-12T21:30", conflicts: [] };
    expect(exceptionHash(base)).toBe(exceptionHash({ ...base }));
    expect(exceptionHash(base)).not.toBe(exceptionHash({ ...base, startLocal: "2026-10-12T21:15" }));
    expect(exceptionHash(base)).not.toBe(exceptionHash({ ...base, causes: ["OUTSIDE_WORKING_HOURS", "SLOT_TAKEN"] }));
  });

  it("reads a consent deterministically, never from a negation or a new time", () => {
    expect(exceptionReply("Pode agendar mesmo assim")).toEqual({ decision: "CONSENT" });
    expect(exceptionReply("pode remarcar, porque ela só pode à noite")).toEqual({ decision: "CONSENT", reason: "ela só pode à noite" });
    expect(exceptionReply("Mesmo assim. Motivo: cliente VIP")).toEqual({ decision: "CONSENT", reason: "cliente VIP" });
    expect(exceptionReply("sim")).toBeUndefined();
    expect(exceptionReply("sim", { bareAllowed: true })).toEqual({ decision: "CONSENT" });
    expect(exceptionReply("não")).toEqual({ decision: "REFUSAL" });
    expect(exceptionReply("não pode agendar mesmo assim")).toBeUndefined();
    expect(exceptionReply("pode agendar mesmo assim às 10h")).toBeUndefined();
    expect(exceptionReply("então marca amanhã")).toBeUndefined();
    expect(exceptionReply("quem é o Otávio?")).toBeUndefined();
  });
});

describe("owner 05/10: 'quero marcar mesmo nesse horário'", () => {
  it.each(["Quero marcar mesmo nesse horário", "esse horário mesmo", "pode marcar nesse horário", "mesmo nesse horário", "neste horário mesmo"])("%s consents", text =>
    expect(exceptionReply(text)).toEqual({ decision: "CONSENT" }));
  it.each(["não, esse horário não", "nesse horário não dá", "quero outro horário"])("%s never consents", text =>
    expect(exceptionReply(text)?.decision).not.toBe("CONSENT"));
});
