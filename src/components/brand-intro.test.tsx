// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ path: "/login" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.path }));
import { BrandIntro } from "./brand-intro";

beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear(); navigation.path = "/login";
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("Everflair entrance", () => {
  it("finishes under StrictMode and only appears once per session", () => {
    const first = render(<StrictMode><BrandIntro /></StrictMode>);
    expect(first.container.querySelector(".ef-intro")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1400));
    expect(first.container.querySelector(".ef-intro")).toBeNull();
    first.unmount();
    expect(render(<BrandIntro />).container.querySelector(".ef-intro")).toBeNull();
  });
  it("does not display motion when reduced motion is requested", () => {
    vi.mocked(matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    expect(render(<BrandIntro />).container.querySelector(".ef-intro")).toBeNull();
  });
  it("dismisses immediately on keyboard interaction", () => {
    const result = render(<BrandIntro />);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })));
    expect(result.container.querySelector(".ef-intro")).toBeNull();
  });
  it("keeps the landing page unobstructed", () => {
    navigation.path = "/";
    expect(render(<BrandIntro />).container.querySelector(".ef-intro")).toBeNull();
  });
});
