import { describe, expect, it } from "vitest";
import { hexToHslTriple, readableForeground } from "../color";

describe("hexToHslTriple", () => {
  it("converte o verde da marca para a tripla dos tokens", () => {
    // Conferido à mão: R=46 G=204 B=139 → h=155,3° s=63% l=49%.
    // O globals.css comenta esse hex como "152 65% 48%", mas é aproximação
    // do token escrito à mão — o valor exato do #2ECC8B é o de baixo.
    expect(hexToHslTriple("#2ECC8B")).toBe("155 63% 49%");
  });

  it("aceita com e sem #", () => {
    expect(hexToHslTriple("2ECC8B")).toBe(hexToHslTriple("#2ECC8B"));
  });

  it("é insensível a maiúsculas e a espaços", () => {
    expect(hexToHslTriple("  #2ecc8b ")).toBe(hexToHslTriple("#2ECC8B"));
  });

  it("resolve tons neutros sem saturação", () => {
    expect(hexToHslTriple("#000000")).toBe("0 0% 0%");
    expect(hexToHslTriple("#FFFFFF")).toBe("0 0% 100%");
  });

  it("devolve null para entrada inválida em vez de cor quebrada", () => {
    // Sem isto, um valor ruim viraria uma CSS variable inválida e o tema
    // inteiro da vitrine perderia a cor primária.
    expect(hexToHslTriple("#12345")).toBeNull();
    expect(hexToHslTriple("vermelho")).toBeNull();
    expect(hexToHslTriple("")).toBeNull();
    expect(hexToHslTriple(null)).toBeNull();
    expect(hexToHslTriple(undefined)).toBeNull();
  });
});

describe("readableForeground", () => {
  it("pede texto escuro sobre cor clara", () => {
    expect(readableForeground("#FFFFFF")).toBe("0 0% 10%");
    expect(readableForeground("#FDE68A")).toBe("0 0% 10%");
    expect(readableForeground("#777777")).toBe("0 0% 10%");
  });

  it("pede texto claro sobre cor escura", () => {
    expect(readableForeground("#000000")).toBe("0 0% 100%");
    expect(readableForeground("#1E3A8A")).toBe("0 0% 100%");
  });

  it("devolve null para hex inválido", () => {
    expect(readableForeground("nope")).toBeNull();
  });
});
