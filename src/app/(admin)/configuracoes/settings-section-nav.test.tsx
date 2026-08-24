// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSectionNav } from "./settings-section-nav";

afterEach(cleanup);

describe("SettingsSectionNav", () => {
  it("oferece navegação nomeada por domínio e alvos de toque amplos", () => {
    render(<SettingsSectionNav />);

    expect(screen.getByRole("navigation", { name: "Seções de configurações" })).toBeInTheDocument();
    for (const section of ["perfil", "aparencia", "agenda", "notificacoes", "seguranca", "plano"]) {
      const link = screen.getByRole("link", { name: new RegExp(section === "aparencia" ? "Aparência" : section === "notificacoes" ? "Notificações" : section === "seguranca" ? "Segurança" : section[0].toUpperCase() + section.slice(1), "i") });
      expect(link).toHaveAttribute("href", `#${section}`);
      expect(link.className).toContain("min-h-11");
    }
  });

  it("centraliza a seção escolhida em vez de deixar o alvo preso no rodapé", () => {
    const target = document.createElement("section");
    target.id = "agenda";
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    document.body.appendChild(target);

    render(<SettingsSectionNav />);
    const link = screen.getByRole("link", { name: "Agenda" });
    fireEvent.click(link);

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    expect(link).toHaveAttribute("aria-current", "location");

    target.remove();
    window.history.replaceState(null, "", "/configuracoes");
  });
});
