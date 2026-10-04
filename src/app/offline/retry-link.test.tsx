// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryLink } from "./retry-link";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("página offline", () => {
  it("'Tentar novamente' recarrega a página atual em vez de ir para a landing", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<RetryLink />);

    const link = screen.getByText("Tentar novamente");
    expect(link.tagName).toBe("A");
    // Sem JavaScript, o href vazio já aponta para a própria página, nunca para "/".
    expect(link.getAttribute("href")).toBe("");

    const notPrevented = fireEvent.click(link);
    expect(reload).toHaveBeenCalledOnce();
    expect(notPrevented).toBe(false);
  });
});
