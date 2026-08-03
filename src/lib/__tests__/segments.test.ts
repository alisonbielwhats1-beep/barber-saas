import { describe, expect, it } from "vitest";
import { SEGMENTS, getSegment, isSegmentId, DEFAULT_SEGMENT_ID } from "../segments";

describe("isSegmentId", () => {
  it("aceita todo id real da lista", () => {
    for (const s of SEGMENTS) expect(isSegmentId(s.id)).toBe(true);
  });

  it("rejeita valor inválido vindo do banco", () => {
    // Salon.segment é texto livre, não enum — precisa aguentar lixo sem
    // quebrar a página. Cenário real: campo editado à mão, ou versão antiga
    // do formulário que salvou outro valor.
    expect(isSegmentId("cassino")).toBe(false);
    expect(isSegmentId("")).toBe(false);
    expect(isSegmentId(null)).toBe(false);
    expect(isSegmentId(undefined)).toBe(false);
  });
});

describe("getSegment", () => {
  it("resolve cada id para o segmento certo", () => {
    for (const s of SEGMENTS) expect(getSegment(s.id).id).toBe(s.id);
  });

  it("cai no default se o id não existir — nunca deve lançar", () => {
    // @ts-expect-error — testando entrada fora do tipo de propósito
    expect(getSegment("inexistente").id).toBe(DEFAULT_SEGMENT_ID);
  });
});
