import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

// Animações do motion terminam na hora: testes verificam estado, não tempo.
MotionGlobalConfig.skipAnimations = true;
vi.mock("server-only", () => ({}));

if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
