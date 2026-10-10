// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adjustStock: vi.fn(),
  toggleProductActive: vi.fn(),
  deleteProduct: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("./actions", () => ({
  adjustStock: mocks.adjustStock,
  toggleProductActive: mocks.toggleProductActive,
  deleteProduct: mocks.deleteProduct,
}));
vi.mock("./product-form", () => ({ ProductForm: () => null }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));
import { ProductsCatalog, type ProductCard } from "./products-catalog";

const product: ProductCard = {
  id: "product-1", name: "Pomada modeladora", description: null, brand: "Barba Forte", category: "Cabelo",
  supplier: null, barcode: null, priceCents: 4990, costCents: 2000, stock: 5, minStock: 2, expiresAt: null,
  imageUrl: null, active: true, sold: 0, topSeller: false, index: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.adjustStock.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("movimentar estoque: motivo opcional na tela", () => {
  it("rotula o motivo como opcional e permite salvar sem preenchê-lo", async () => {
    render(<ProductsCatalog products={[product]} movements={[]} />);
    // Tocar no produto abre a ficha, onde fica "Movimentar estoque".
    fireEvent.click(screen.getByRole("button", { name: "Pomada modeladora" }));
    fireEvent.click(await screen.findByRole("button", { name: /Movimentar estoque/ }));

    expect(await screen.findByText("Motivo (opcional)")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: /Salvar movimentação/ });
    expect(save).toBeEnabled();

    fireEvent.click(save);
    await waitFor(() => expect(mocks.adjustStock).toHaveBeenCalledOnce());
    expect(mocks.adjustStock).toHaveBeenCalledWith("product-1", 1, { reason: "", kind: "PURCHASE" });
  });

  it("com motivo digitado, continua enviando o texto", async () => {
    render(<ProductsCatalog products={[product]} movements={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Pomada modeladora" }));
    fireEvent.click(await screen.findByRole("button", { name: /Movimentar estoque/ }));
    fireEvent.change(await screen.findByLabelText("Motivo (opcional)"), { target: { value: "Nota 123" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar movimentação/ }));

    await waitFor(() => expect(mocks.adjustStock).toHaveBeenCalledWith("product-1", 1, { reason: "Nota 123", kind: "PURCHASE" }));
  });

  it("o histórico mostra 'Sem motivo' quando a movimentação não tem motivo", async () => {
    render(
      <ProductsCatalog
        products={[product]}
        movements={[{ id: "m1", actorName: "Alison", reason: null, createdAt: "2026-10-03T12:00:00.000Z", metadata: { delta: 2, productName: "Pomada modeladora" } }]}
      />,
    );
    // O histórico fica abaixo da lista (no celular, recolhido atrás do próprio título).
    fireEvent.click(screen.getByRole("button", { name: /Histórico de movimentações/ }));
    expect(await screen.findByText(/Sem motivo · Alison/)).toBeInTheDocument();
  });
});
