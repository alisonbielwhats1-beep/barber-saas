// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { SearchPicker } from "./search-picker";
afterEach(cleanup);
function Fixture() {
  const [value, setValue] = useState("");
  return (
    <SearchPicker
      label="Serviço"
      value={value}
      onChange={setValue}
      options={[
        { value: "ped", label: "Pé e Mão", description: "150 min" },
        ...Array.from({ length: 100 }, (_, i) => ({
          value: String(i),
          label: `Corte ${i}`,
        })),
      ]}
    />
  );
}
it("filtra sem acentos, seleciona e preserva a seleção ao reabrir", async () => {
  render(<Fixture />);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Serviço" });
  await user.click(trigger);
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "pe e mao" },
  });
  expect(screen.getByRole("dialog", { name: "Serviço" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("1 opção");
  await user.click(screen.getByRole("button", { name: /Pé e Mão/ }));
  expect(trigger).toHaveTextContent("Pé e Mão");
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(screen.getByRole("button", { name: /Pé e Mão/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
});
it("explica busca sem resultado e fecha por teclado sem perder seleção", async () => {
  render(<Fixture />);
  await userEvent.click(screen.getByRole("button", { name: "Serviço" }));
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "inexistente" },
  });
  expect(screen.getByText(/Tente parte do nome/)).toBeVisible();
});
