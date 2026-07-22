import { describe, it, expect } from "vitest";
import { friendlyError, ERROR_PT } from "../booking-errors";

describe("friendlyError", () => {
  it("mapeia códigos conhecidos para PT", () => {
    expect(friendlyError("SLOT_TAKEN")).toBe(ERROR_PT.SLOT_TAKEN);
    expect(friendlyError("SERVICE_INVALID")).toBe(ERROR_PT.SERVICE_INVALID);
  });
  it("nunca mostra código cru desconhecido", () => {
    const msg = friendlyError("SOME_NEW_CODE");
    expect(msg).not.toContain("SOME_NEW_CODE");
    expect(msg.length).toBeGreaterThan(10);
  });
  it("mensagens já em PT passam direto", () => {
    expect(friendlyError("Estoque insuficiente: Pomada")).toBe(
      "Estoque insuficiente: Pomada",
    );
  });
  it("payloads estranhos viram mensagem genérica", () => {
    expect(friendlyError(undefined)).toMatch(/Tente novamente/);
    expect(friendlyError({ weird: true })).toMatch(/Tente novamente/);
    expect(friendlyError("")).toMatch(/Tente novamente/);
  });
});
