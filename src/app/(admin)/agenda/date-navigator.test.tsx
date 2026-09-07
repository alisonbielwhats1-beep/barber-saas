// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateNavigator } from "./date-navigator";

afterEach(cleanup);

describe("navegação por datas civis", () => {
  it("permite consultar outro mês sem trocar a agenda até escolher uma data", () => {
    const select = vi.fn();
    render(<DateNavigator date="2028-01-31" today="2028-01-31" onSelect={select} />);
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês no calendário" }));
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "terça-feira, 29 de fevereiro de 2028" }));
    expect(select).toHaveBeenCalledWith("2028-02-29");
  });
  it("mantém o foco de teclado ao atravessar mês e ano", () => {
    render(<DateNavigator date="2026-12-31" today="2026-12-31" onSelect={vi.fn()} />);
    const selected = screen.getByRole("button", { name: "quinta-feira, 31 de dezembro de 2026" });
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "sexta-feira, 1 de janeiro de 2027" }));
  });
  it("pula semanas a partir da data selecionada e retorna ao hoje do estabelecimento", () => {
    const select = vi.fn();
    render(<DateNavigator date="2026-12-28" today="2026-12-02" onSelect={select} />);
    fireEvent.click(screen.getByRole("button", { name: "Avançar 1 semana" }));
    expect(select).toHaveBeenLastCalledWith("2027-01-04");
    fireEvent.click(screen.getByRole("button", { name: "Voltar para hoje" }));
    expect(select).toHaveBeenLastCalledWith("2026-12-02");
  });
});
