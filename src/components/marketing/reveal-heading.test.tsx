// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RevealHeading } from "./reveal-heading";

let reduced = false;
let enter: () => void;
let preferenceChange: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  reduced = false;
  disconnect.mockClear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 1500 } as DOMRect);
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener: (_: string, callback: () => void) => { preferenceChange = callback; }, removeEventListener: vi.fn() }));
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { enter = () => callback([{ isIntersecting: true }]); } observe() {} disconnect = disconnect; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("expõe o título completo aos leitores de tela e revela uma única vez", () => {
  render(<RevealHeading lines={["Agenda organizada.", "Equipe conectada."]} />);
  const heading = screen.getByRole("heading", { name: "Agenda organizada. Equipe conectada." });
  expect(heading).toHaveAttribute("data-reveal", "pending");
  enter();
  expect(heading).toHaveAttribute("data-reveal", "visible");
  expect(disconnect).toHaveBeenCalledOnce();
});

it("apresenta imediatamente conteúdo pendente quando movimento reduzido é ativado", () => {
  render(<RevealHeading lines={["Agenda organizada."]} />);
  reduced = true;
  preferenceChange();
  expect(screen.getByRole("heading")).toHaveAttribute("data-reveal", "visible");
});

it("não oculta títulos já visíveis ao carregar por uma âncora", () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ top: 100 } as DOMRect);
  render(<RevealHeading lines={["Agenda organizada."]} />);
  expect(screen.getByRole("heading")).not.toHaveAttribute("data-reveal");
});
