import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyCompact } from "../utils";

// O Intl separa "R$" do número com espaço não separável (U+00A0).
const plain = (text: string) => text.replace(/ /g, " ");

describe("valores em reais no padrão pt-BR", () => {
  it("formatMoney usa vírgula decimal e ponto de milhar", () => {
    expect(plain(formatMoney(123456))).toBe("R$ 1.234,56");
  });

  it("formatMoneyCompact abrevia para o eixo dos gráficos, mantendo a unidade", () => {
    expect(plain(formatMoneyCompact(0))).toBe("R$ 0");
    expect(plain(formatMoneyCompact(45000))).toBe("R$ 450");
    expect(plain(formatMoneyCompact(100000))).toBe("R$ 1 mil");
    expect(plain(formatMoneyCompact(150000))).toBe("R$ 1,5 mil");
    expect(plain(formatMoneyCompact(15000000))).toBe("R$ 150 mil");
    expect(plain(formatMoneyCompact(123456700))).toBe("R$ 1,2 mi");
  });
});
