// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductList } from "./product-list";

vi.mock("next/image", () => ({
  default: () => <span data-testid="next-image" />,
}));

const product = {
  id: "product-pomada",
  name: "Pomada",
  description: "Fixação forte",
  brand: "Marca",
  category: "Finalização",
  priceCents: 1_500,
  stock: 3,
  imageUrl: "/pomada.jpg",
};

describe("ProductList", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("não permite adicionar item esgotado", async () => {
    const user = userEvent.setup();
    render(
      <ProductList
        salonSlug="studio-a"
        currency="BRL"
        products={[{ ...product, id: "sold-out", stock: 0, name: "Produto esgotado" }]}
      />,
    );

    const card = screen.getByRole("article");
    expect(within(card).getByText("Esgotado")).toBeInTheDocument();
    const add = within(card).getByRole("button", { name: "Adicionar ao carrinho" });
    expect(add).toBeDisabled();

    await user.click(add);
    expect(localStorage.getItem("salon-cart:studio-a")).toBeNull();
  });

  it("adiciona produto disponível e preserva a quantidade existente", async () => {
    const savedItem = {
      productId: product.id,
      name: product.name,
      priceCents: product.priceCents,
      imageUrl: product.imageUrl,
      quantity: 1,
    };
    localStorage.setItem(
      "salon-cart:studio-a",
      JSON.stringify({ items: [savedItem] }),
    );
    const user = userEvent.setup();
    render(<ProductList salonSlug="studio-a" currency="BRL" products={[product]} />);

    const add = screen.getByRole("button", { name: "Adicionar ao carrinho" });
    await user.click(add);

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("salon-cart:studio-a") ?? "{}")).toEqual({
        items: [{ ...savedItem, quantity: 2 }],
      });
    });
  });

  it("continua renderizável quando o carrinho salvo está corrompido", () => {
    localStorage.setItem("salon-cart:studio-a", "not-json");

    render(<ProductList salonSlug="studio-a" currency="BRL" products={[product]} />);

    expect(screen.getByText("Pomada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar ao carrinho" })).toBeEnabled();
  });
});
