import { describe, expect, it } from "vitest";
import {
  CATEGORY_IMAGES,
  PORTFOLIO_POOL,
  PRODUCT_IMAGES,
  imageForCategory,
  normalizeImageUrl,
  resolvePortfolioImage,
  resolveProductImage,
} from "@/lib/images";

describe("curadoria de imagens da demonstração", () => {
  it.each([
    ["Barba", "/images/salon-hero-beard-v1.webp"],
    ["Corte masculino", "/images/salon-hero-male-haircut-v1.webp"],
    ["Corte feminino", "/images/salon-hero-stylist-v1.webp"],
    ["Escova", "/images/salon-hero-stylist-v2.webp"],
    ["Manicure", "/images/salon-hero-manicure-v1.webp"],
    ["Massagem relaxante", "/images/salon-hero-massage-v2.webp"],
    ["Limpeza de pele", "/images/salon-hero-aesthetics-v2.webp"],
  ])("associa %s a uma fotografia coerente", (category, expected) => {
    expect(imageForCategory(category)).toBe(expected);
  });

  it("mantém o catálogo demonstrativo independente de imagens externas", () => {
    expect(PRODUCT_IMAGES.join(" ")).not.toContain("photo-1585232004423-244e0e6904e3");
    expect(PRODUCT_IMAGES.join(" ")).not.toContain("photo-1594736797933-d0501ba2fe65");
    expect(PRODUCT_IMAGES.every((image) => image.startsWith("/images/"))).toBe(true);
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
    ).toBe(PRODUCT_IMAGES[2]);
  });

  it("converte caminhos antigos de imagem local sem tocar em uploads externos", () => {
    expect(normalizeImageUrl("/images/salon-hero-beard-v1-hq.png")).toBe(
      "/images/salon-hero-beard-v1.webp",
    );
    expect(normalizeImageUrl("/images/salon-hero-beard-v1-hq.png?v=1")).toBe(
      "/images/salon-hero-beard-v1.webp?v=1",
    );
    expect(normalizeImageUrl("https://cdn.example.com/meu-produto.jpg")).toBe(
      "https://cdn.example.com/meu-produto.jpg",
    );
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

  it("troca somente fotos demo antigas do portfolio por assets locais", () => {
    expect(
      resolvePortfolioImage("https://images.unsplash.com/photo-1622287162716-f311baa1a2b8?w=800"),
    ).toBe(PORTFOLIO_POOL[0]);
    expect(resolvePortfolioImage("https://cdn.example.com/portfolio.jpg")).toBe(
      "https://cdn.example.com/portfolio.jpg",
    );
  });
});
