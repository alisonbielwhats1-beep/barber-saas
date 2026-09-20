// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ createClient: vi.fn(), updateClient: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn(), sellPackage: vi.fn(), cancelSubscription: vi.fn() }));
vi.mock("./clientes/actions", () => actions);
vi.mock("./produtos/actions", () => actions);
vi.mock("./pacotes/actions", () => ({ ...actions, createPackage: vi.fn(), updatePackage: vi.fn(), createPlan: vi.fn(), updatePlan: vi.fn(), togglePackageActive: vi.fn(), deletePackage: vi.fn(), usePackageSession: vi.fn(), setPurchaseStatus: vi.fn(), renewPurchase: vi.fn(), togglePlanActive: vi.fn(), deletePlan: vi.fn(), subscribeClient: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/ui/image-upload", () => ({ ImageUpload: () => null }));
import { ClientForm } from "./clientes/client-form";
import { ProductForm } from "./produtos/product-form";
import { PacotesView } from "./pacotes/pacotes-view";

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); actions.createClient.mockResolvedValue(undefined); actions.createProduct.mockResolvedValue(undefined); actions.sellPackage.mockResolvedValue(undefined); });

it("saves essential client data directly, retaining optional fields without requiring a step", async () => {
  render(<ClientForm />);
  fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
  expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar cliente" }));
  await waitFor(() => expect(actions.createClient).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "Ana", consentGiven: false, notes: null })));
});

it("protects X and Escape, preserves the draft when continuing and discards only explicitly", async () => {
  render(<ClientForm />);
  fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Rascunho" } });
  fireEvent.click(screen.getByRole("button", { name: "Fechar janela" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar editando" }));
  expect(screen.getByLabelText("Nome")).toHaveValue("Rascunho");
  fireEvent.keyDown(document, { key: "Escape" });
  await screen.findByRole("heading", { name: "Descartar alterações?" });
  fireEvent.click(screen.getByRole("button", { name: "Descartar alterações" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(actions.createClient).not.toHaveBeenCalled();
});

it("keeps processing locked through the awaited action and preserves values after failure", async () => {
  let reject!: (error: Error) => void;
  actions.createClient.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  render(<ClientForm />);
  fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  const form = screen.getByLabelText("Nome").closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(actions.createClient).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Fechar janela" }));
  expect(screen.getByLabelText("Nome")).toHaveValue("Ana");
  await act(async () => reject(new Error("Falha de teste")));
  expect(screen.getByRole("alert")).toHaveTextContent("Falha de teste");
  expect(screen.getByLabelText("Nome")).toHaveValue("Ana");
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar cliente" }));
  await waitFor(() => expect(actions.createClient).toHaveBeenCalledTimes(2));
});

it("requires explicit initial stock and never fills ten units", async () => {
  render(<ProductForm />);
  fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
  expect(screen.getByLabelText("Estoque")).toHaveValue(null);
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Shampoo" } });
  fireEvent.change(screen.getByLabelText("Preço venda (R$)"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto" }));
  expect(actions.createProduct).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Estoque"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto" }));
  await waitFor(() => expect(actions.createProduct).toHaveBeenCalledWith(expect.objectContaining({ stock: 0 })));
});

it("selecting a client does not sell; explicit confirmation executes once", async () => {
  render(<PacotesView packages={[{ id: "p", name: "Cortes", description: null, serviceId: null, serviceName: null, sessions: 5, priceCents: 10000, validityDays: 30, active: true, soldCount: 0 }]} purchases={[]} plans={[]} subscriptions={[]} clients={[{ id: "c", name: "Ana" }]} services={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Vender" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Ana" }));
  expect(actions.sellPackage).not.toHaveBeenCalled();
  expect(dialog).toHaveTextContent("5 sessões");
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar operação" }));
  await waitFor(() => expect(actions.sellPackage).toHaveBeenCalledExactlyOnceWith("p", "c"));
});
