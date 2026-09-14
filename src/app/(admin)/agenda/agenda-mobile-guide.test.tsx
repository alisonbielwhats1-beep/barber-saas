// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgendaMobileGuide } from "./agenda-mobile-guide";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
it("abre no primeiro acesso mobile, permite pular, não repete e oferece replay", () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  const first = render(<AgendaMobileGuide scope="salon:user" />);
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Pular tutorial" }));
  first.unmount();
  render(<AgendaMobileGuide scope="salon:user" />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Como usar a agenda" }));
  fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
  expect(screen.getByRole("heading")).toHaveTextContent("Do horário à reserva");
  fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
  expect(screen.getByRole("heading")).toHaveTextContent(
    "Toque para conferir e editar",
  );
  fireEvent.click(screen.getByRole("button", { name: "Começar a usar" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("não interrompe um link direto para reserva e não ensina arraste mobile inexistente", () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  render(
    <AgendaMobileGuide
      scope="salon:user"
      autoStart={false}
      canCreate={false}
    />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Como usar a agenda" }));
  fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
  expect(screen.getByRole("heading")).toHaveTextContent(
    "Toque para conferir e editar",
  );
  expect(screen.queryByText(/Arraste e solte/)).toBeNull();
});
