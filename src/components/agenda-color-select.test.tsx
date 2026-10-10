// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaColorSelect } from "./agenda-color-select";

afterEach(cleanup);

describe("AgendaColorSelect", () => {
  it("na agenda (sem compactOnPhone) mantém o rótulo e o seletor visíveis, como em produção", () => {
    render(<AgendaColorSelect value="service" onChange={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Colorir agenda por" });
    expect(select.className).toBe("min-h-11 max-w-36 rounded-lg border border-border bg-card px-2 text-sm");
    const label = select.closest("label")!;
    expect(label.className).toBe("flex min-h-11 items-center gap-2 text-xs");
    expect(screen.getByText("Cores")).not.toHaveAttribute("class");
    expect(label.querySelector("svg")).toBeNull();
  });

  it("com compactOnPhone vira um botão de paleta abaixo de 768 px e continua um select acessível", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgendaColorSelect compactOnPhone value="service" onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Colorir agenda por" });
    const label = select.closest("label")!;
    expect(label.className.split(/\s+/)).toEqual(expect.arrayContaining(["max-md:relative", "max-md:w-11", "max-md:justify-center"]));
    expect(select.className.split(/\s+/)).toEqual(expect.arrayContaining(["max-md:absolute", "max-md:inset-0", "max-md:opacity-0"]));
    // A paleta só existe no celular; o texto "Cores" só no computador.
    expect(label.querySelector("svg")?.getAttribute("class")).toContain("md:hidden");
    expect(screen.getByText("Cores").className).toBe("max-md:hidden");

    await user.selectOptions(select, "category");
    expect(onChange).toHaveBeenCalledWith("category");
  });
});
