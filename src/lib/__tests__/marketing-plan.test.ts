import { describe, expect, it } from "vitest";
import { firstAccessHref, resolvePlanIntent } from "../marketing-plan";

describe("intenção de plano sem concessão de acesso", () => {
  it.each([undefined, null, ["pro"], "PRO", "unknown", "https://evil.test", "pro&role=OWNER"])("ignora intenção inválida %s", value => {
    expect(resolvePlanIntent(value)).toBeUndefined();
    expect(firstAccessHref(value)).toBe("/dashboard?welcome=1");
  });
  it("preserva o plano de interesse no caminho interno do primeiro acesso", () => {
    expect(resolvePlanIntent("pro")?.price).toBe("R$ 79,90");
    expect(firstAccessHref("pro")).toBe("/dashboard?welcome=1&plan=pro");
    expect(resolvePlanIntent("equipe")?.professionals).toBe("Até 10 agendas");
  });
});
