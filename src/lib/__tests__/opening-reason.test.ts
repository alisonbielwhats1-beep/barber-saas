import { describe, expect, it } from "vitest";
import { NO_OPENING_REASON, openingReasonOrNull, storedOpeningReason } from "../opening-reason";

describe("motivo opcional da abertura extra", () => {
  it("o marcador respeita o CHECK do banco (3 a 200 caracteres)", () => {
    expect(NO_OPENING_REASON.trim().length).toBeGreaterThanOrEqual(3);
    expect(NO_OPENING_REASON.trim().length).toBeLessThanOrEqual(200);
  });

  it("grava o texto digitado ou o marcador quando vazio", () => {
    expect(storedOpeningReason("  Sábado especial ")).toBe("Sábado especial");
    expect(storedOpeningReason("")).toBe(NO_OPENING_REASON);
    expect(storedOpeningReason("   ")).toBe(NO_OPENING_REASON);
    expect(storedOpeningReason(undefined)).toBe(NO_OPENING_REASON);
    expect(storedOpeningReason(null)).toBe(NO_OPENING_REASON);
  });

  it("devolve o motivo real ou nulo, para tela e auditoria", () => {
    expect(openingReasonOrNull("Sábado especial")).toBe("Sábado especial");
    expect(openingReasonOrNull(NO_OPENING_REASON)).toBeNull();
    expect(openingReasonOrNull("")).toBeNull();
    expect(openingReasonOrNull(null)).toBeNull();
  });
});
