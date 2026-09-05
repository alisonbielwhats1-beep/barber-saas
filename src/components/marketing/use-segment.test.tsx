// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMarketingSegment } from "./use-segment";
import { resolveMarketingSegment, SEGMENT_STORAGE_KEY, SIGNUP_SEGMENTS, signupHref } from "./segments";

describe("preferência de segmento da apresentação", () => {
  beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

  it("mantém o segmento vindo do CTA acima de uma preferência antiga", () => {
    sessionStorage.setItem(SEGMENT_STORAGE_KEY, "salao");
    const hook = renderHook(() => useMarketingSegment("espaco-misto"));
    expect(hook.result.current.segment.id).toBe("espaco-misto");
    expect(sessionStorage.getItem(SEGMENT_STORAGE_KEY)).toBe("espaco-misto");
    expect(signupHref("espaco-misto")).toBe("/signup?segment=espaco-misto");
    expect(SIGNUP_SEGMENTS["espaco-misto"]).toBe("espaco-misto");
    expect(SIGNUP_SEGMENTS["bem-estar"]).toBe("estetica-bemestar");
    hook.unmount();
  });

  it("começa clara e mantém a escolha ao navegar para outra tela", () => {
    const first = renderHook(useMarketingSegment);
    expect(first.result.current.segment.id).toBe("salao");
    act(() => first.result.current.selectSegment("barbearia"));
    expect(first.result.current.segment.id).toBe("barbearia");
    first.unmount();
    const next = renderHook(useMarketingSegment);
    expect(next.result.current.segment.id).toBe("barbearia");
    next.unmount();
  });

  it("ignora dados inválidos sem transformá-los em configuração de conta", () => {
    sessionStorage.setItem(SEGMENT_STORAGE_KEY, "https://example.com/admin");
    const hook = renderHook(useMarketingSegment);
    expect(hook.result.current.segment.id).toBe("salao");
    expect(resolveMarketingSegment(null).id).toBe("salao");
    hook.unmount();
  });

  it("funciona quando o navegador bloqueia armazenamento", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked"); });
    const hook = renderHook(useMarketingSegment);
    act(() => hook.result.current.selectSegment("barbearia"));
    expect(hook.result.current.segment.id).toBe("barbearia");
    act(() => hook.result.current.selectSegment("bem-estar"));
    expect(hook.result.current.segment.id).toBe("bem-estar");
    hook.unmount();
  });
});
