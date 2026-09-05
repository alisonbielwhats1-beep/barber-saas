// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScenePlayback } from "./use-scene-playback";
import type { MarketingSegmentId } from "./segments";

describe("controle da narrativa automática", () => {
  let intersect: (visible: boolean) => void;
  let reduced = false;
  const scene = { current: document.createElement("div") };
  beforeEach(() => {
    vi.useFakeTimers(); reduced = false;
    vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { intersect = visible => callback([{ isIntersecting: visible }]); }
      observe() { intersect(true); }
      disconnect() {}
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  function setup() {
    const select = vi.fn();
    const hook = renderHook(({ id }: { id: MarketingSegmentId }) => useScenePlayback(id, select, true, scene), { initialProps: { id: "salao" as MarketingSegmentId } });
    return { ...hook, select };
  }
  it("avança depois de oito segundos e respeita a escolha manual por dezesseis", () => {
    const hook = setup();
    act(() => vi.advanceTimersByTime(7999)); expect(hook.select).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1)); expect(hook.select).toHaveBeenLastCalledWith("barbearia");
    act(() => hook.result.current.pick("manicure")); hook.rerender({ id: "manicure" }); hook.select.mockClear();
    act(() => vi.advanceTimersByTime(15999)); expect(hook.select).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1)); expect(hook.select).toHaveBeenLastCalledWith("estetica"); hook.unmount();
  });
  it("suspende a troca fora da tela, durante interação e após pausar", () => {
    const hook = setup();
    act(() => intersect(false)); act(() => vi.advanceTimersByTime(20000)); expect(hook.select).not.toHaveBeenCalled();
    act(() => intersect(true)); act(() => hook.result.current.setInteracting(true));
    act(() => vi.advanceTimersByTime(20000)); expect(hook.select).not.toHaveBeenCalled();
    act(() => hook.result.current.setInteracting(false)); act(() => hook.result.current.toggle());
    act(() => vi.advanceTimersByTime(20000)); expect(hook.select).not.toHaveBeenCalled();
    act(() => hook.result.current.toggle()); act(() => vi.advanceTimersByTime(8000)); expect(hook.select).toHaveBeenCalledOnce(); hook.unmount();
  });
  it("movimento reduzido exige ativação explícita para trocar automaticamente", () => {
    reduced = true; const hook = setup();
    expect(hook.result.current.enabled).toBe(false);
    act(() => vi.advanceTimersByTime(30000)); expect(hook.select).not.toHaveBeenCalled();
    act(() => hook.result.current.pick("barbearia")); expect(hook.select).toHaveBeenLastCalledWith("barbearia");
    hook.rerender({ id: "barbearia" }); hook.select.mockClear();
    act(() => hook.result.current.toggle()); act(() => vi.advanceTimersByTime(16000)); expect(hook.select).toHaveBeenLastCalledWith("manicure");
    act(() => hook.result.current.toggle()); expect(hook.result.current.enabled).toBe(false); hook.unmount();
  });
});
