import { describe, expect, it } from "vitest";
import {
  filterServiceOptions,
  getServiceCategories,
  normalizeServiceSearch,
} from "@/lib/service-discovery";

const services = [
  { id: "1", name: "Corte clássico", description: "Tesoura e máquina", category: "Cabelo" },
  { id: "2", name: "Barba premium", description: "Toalha quente", category: "Barba" },
  { id: "3", name: "Manutenção", description: null, category: null },
];

describe("descoberta de serviços", () => {
  it("ignora acentos e maiúsculas na busca", () => {
    expect(normalizeServiceSearch("  CLÁSSICO ")).toBe("classico");
    expect(filterServiceOptions(services, "classico", null).map((service) => service.id)).toEqual(["1"]);
  });

  it("busca também na descrição e categoria", () => {
    expect(filterServiceOptions(services, "toalha", null).map((service) => service.id)).toEqual(["2"]);
    expect(filterServiceOptions(services, "cabelo", null).map((service) => service.id)).toEqual(["1"]);
  });

  it("filtra categorias e preserva a categoria Outros", () => {
    expect(getServiceCategories(services)).toEqual(["Barba", "Cabelo", "Outros"]);
    expect(filterServiceOptions(services, "", "Outros").map((service) => service.id)).toEqual(["3"]);
  });
});
