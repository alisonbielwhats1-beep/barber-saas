// @vitest-environment jsdom
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
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
  it("inclui a entrada do cliente no HTML inicial, antes de executar efeitos", () => {
    navigation.path = "/book/studio-a/welcome";
    const html = renderToString(<BrandIntro />);
    expect(html).toContain('data-audience="client"');
    expect(html).toContain('ef-intro-logo');
  });
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
  it("shows the client entrance even after the admin entrance and keeps it once within the salon", () => {
    const view = render(<BrandIntro />);
    act(() => vi.advanceTimersByTime(1400));
    navigation.path = "/book/studio-flair";
    view.rerender(<BrandIntro />);
    expect(view.container.querySelector('.ef-intro[data-audience="client"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1100));
    navigation.path = "/book/studio-flair/agendar";
    view.rerender(<BrandIntro />);
    act(() => vi.advanceTimersByTime(1100));
    expect(view.container.querySelector(".ef-intro")).toBeNull();
    navigation.path = "/book/studio-flair/minhas";
    view.rerender(<BrandIntro />);
    expect(view.container.querySelector(".ef-intro")).toBeNull();
    view.unmount();
    // A new app opening is independent of the old tab session.
    expect(render(<BrandIntro />).container.querySelector(".ef-intro")).not.toBeNull();
  });
  it("does not share the client's introduction with another establishment", () => {
    navigation.path = "/book/studio-a";
    const view = render(<BrandIntro />);
    act(() => vi.advanceTimersByTime(2200));
    navigation.path = "/book/studio-b";
    view.rerender(<BrandIntro />);
    expect(view.container.querySelector('.ef-intro[data-audience="client"]')).not.toBeNull();
  });
  it("finishes the client entrance under StrictMode without replaying on internal navigation", () => {
    navigation.path = "/book/studio-flair";
    const view = render(<StrictMode><BrandIntro /></StrictMode>);
    expect(view.container.querySelector(".ef-intro-orbit")).not.toBeNull();
    act(() => vi.advanceTimersByTime(2200));
    expect(view.container.querySelector(".ef-intro")).toBeNull();
    navigation.path = "/book/studio-flair/agendar";
    view.rerender(<StrictMode><BrandIntro /></StrictMode>);
    expect(view.container.querySelector(".ef-intro")).toBeNull();
  });
  it("leaves the app usable when session storage is unavailable", () => {
    const storage = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage disabled"); });
    expect(render(<BrandIntro />).container.querySelector(".ef-intro")).toBeNull();
    storage.mockRestore();
  });
});
