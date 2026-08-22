// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCart, type CartItem } from "@/lib/cart";

const product: Omit<CartItem, "quantity"> = {
  productId: "product-pomada",
  name: "Pomada",
  priceCents: 1_500,
  imageUrl: "/pomada.jpg",
};

function CartHarness({ slug }: { slug: string }) {
  const cart = useCart(slug);

  return (
    <div>
      <output data-testid="count">{cart.count}</output>
      <output data-testid="total">{cart.totalCents}</output>
      <button type="button" onClick={() => cart.add(product)}>
        Adicionar
      </button>
      <button type="button" onClick={() => cart.setQuantity(product.productId, 0)}>
        Zerar
      </button>
    </div>
  );
}

describe("carrinho público por salão", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("trata JSON corrompido como carrinho vazio", () => {
    localStorage.setItem("salon-cart:studio-a", "{");

    render(<CartHarness slug="studio-a" />);

    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(screen.getByTestId("total")).toHaveTextContent("0");
  });

  it("isola salões e acumula adições do mesmo produto", async () => {
    const user = userEvent.setup();
    const view = render(<CartHarness slug="studio-a" />);

    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    await user.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByTestId("total")).toHaveTextContent("3000");

    view.unmount();
    render(<CartHarness slug="studio-b" />);

    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(localStorage.getItem("salon-cart:studio-b")).toBeNull();
  });

  it("remove o produto quando a quantidade chega a zero", async () => {
    const user = userEvent.setup();
    render(<CartHarness slug="studio-a" />);

    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    await user.click(screen.getByRole("button", { name: "Zerar" }));

    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(JSON.parse(localStorage.getItem("salon-cart:studio-a") ?? "{}")).toEqual({
      items: [],
    });
  });

  it("reage a alterações do mesmo carrinho vindas de outra aba", async () => {
    render(<CartHarness slug="studio-a" />);

    act(() => {
      localStorage.setItem(
        "salon-cart:studio-a",
        JSON.stringify({ items: [{ ...product, quantity: 3 }] }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "salon-cart:studio-a",
          newValue: localStorage.getItem("salon-cart:studio-a"),
        }),
      );
    });

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("3"));
    expect(screen.getByTestId("total")).toHaveTextContent("4500");
  });
});
