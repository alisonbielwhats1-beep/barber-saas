// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ inspectEmptySalon: vi.fn(), deleteEmptySalon: vi.fn(), archiveSalon: vi.fn() }));
vi.mock("../actions", () => actions);
import { DeleteSalonControl } from "./delete-controls";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const renderControl = () => render(<DeleteSalonControl salonId="target" salonName="Cadastro sintético" />);
it("does not offer deletion when the server finds customer data", async () => {
  actions.inspectEmptySalon.mockResolvedValue({ salon: { slug: "demo" }, blockers: [{ table: "ClientProfile", count: 1 }], eligible: false });
  renderControl(); fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro vazio" }));
  expect(await screen.findByText(/Exclusão bloqueada/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
  expect(actions.deleteEmptySalon).not.toHaveBeenCalled();
});
it("requires an exact confirmation and permits leaving without a write", async () => {
  actions.inspectEmptySalon.mockResolvedValue({ salon: { slug: "empty-demo" }, blockers: [], eligible: true });
  renderControl(); fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro vazio" }));
  const confirm = await screen.findByRole("button", { name: "Excluir definitivamente" });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "other" } }); expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "empty-demo" } }); expect(confirm).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Voltar sem excluir" }));
  expect(actions.deleteEmptySalon).not.toHaveBeenCalled();
});
it("archives only after confirmation and never invokes permanent removal", async () => {
  actions.archiveSalon.mockResolvedValue(undefined);
  renderControl(); fireEvent.click(screen.getByRole("button", { name: "Mover para histórico" }));
  expect(actions.archiveSalon).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveTextContent("Clientes, atendimentos e dados serão preservados");
  fireEvent.click(screen.getByRole("button", { name: "Confirmar envio para histórico" }));
  await waitFor(() => expect(actions.archiveSalon).toHaveBeenCalledWith("target", true));
  expect(actions.deleteEmptySalon).not.toHaveBeenCalled();
});
