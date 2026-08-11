import { describe, expect, it } from "vitest";
import {
  CATEGORY_IMAGES,
  PRODUCT_IMAGES,
  imageForCategory,
  resolveProductImage,
} from "@/lib/images";

describe("curadoria de imagens da demonstração", () => {
  it.each([
    ["Barba", "/images/salon-hero-beard-v1-hq.png"],
    ["Corte masculino", "/images/salon-hero-male-haircut-v1-hq.png"],
    ["Corte feminino", "/images/salon-hero-stylist-v1-hq.png"],
    ["Escova", "/images/salon-hero-stylist-v2-hq.png"],
    ["Manicure", "/images/salon-hero-manicure-v1-hq.png"],
    ["Massagem relaxante", "/images/salon-hero-massage-v2-hq.png"],
    ["Limpeza de pele", "/images/salon-hero-aesthetics-v2-hq.png"],
  ])("associa %s a uma fotografia coerente", (category, expected) => {
    expect(imageForCategory(category)).toBe(expected);
  });

  it("não mantém os placeholders externos que retornavam tênis ou brinquedo", () => {
    expect(PRODUCT_IMAGES.join(" ")).not.toContain("photo-1585232004423-244e0e6904e3");
    expect(PRODUCT_IMAGES.join(" ")).not.toContain("photo-1594736797933-d0501ba2fe65");
  });

  it("substitui a imagem legada de tênis do óleo para barba", () => {
    expect(
      resolveProductImage({
        imageUrl:
          "https://images.unsplash.com/photo-1585232004423-244e0e6904e3?w=600&auto=format",
        name: "Óleo para barba",
        category: "Barba",
      }),
    ).toBe(CATEGORY_IMAGES.barba);
  });

  it("substitui o brinquedo legado por uma imagem de tratamento capilar", () => {
    expect(
      resolveProductImage({
        imageUrl:
          "https://images.unsplash.com/photo-1594736797933-d0501ba2fe65?w=600&auto=format",
        name: "Máscara de hidratação profunda",
        category: "Tratamento",
      }),
    ).toContain("photo-1608248543803-ba4f8c70ae0b");
  });

  it("preserva a imagem personalizada enviada pelo estabelecimento", () => {
    expect(
      resolveProductImage({
        imageUrl: "https://cdn.example.com/meu-produto.jpg",
        name: "Óleo para barba",
        category: "Barba",
      }),
    ).toBe("https://cdn.example.com/meu-produto.jpg");
  });
});
