import { describe, it, expect } from "vitest";
import { normalizePhone, formatPhoneBR, isValidPhoneBR } from "../phone";

describe("normalizePhone", () => {
  it("remove tudo que não é dígito", () => {
    expect(normalizePhone("(11) 91234-5678")).toBe("11912345678");
  });
  it.each([
    ["11 91234-5678", "11912345678"],
    ["55 11 91234-5678", "11912345678"],
    ["+55 (11) 91234-5678", "11912345678"],
    ["11 3333-4444", "1133334444"],
    ["55 11 3333-4444", "1133334444"],
    ["+55 (11) 3333-4444", "1133334444"],
  ])("normaliza telefone BR nacional ou internacional %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
    expect(isValidPhoneBR(input)).toBe(true);
  });
  it("preserva excesso para que a validação o rejeite sem corrupção silenciosa", () => {
    expect(normalizePhone("119123456789999")).toBe("119123456789999");
    expect(normalizePhone("+55 11 91234-56789")).toBe("119123456789");
  });
  it("string vazia vira vazia", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("abc")).toBe("");
  });
});

describe("formatPhoneBR", () => {
  it("formata celular completo", () => {
    expect(formatPhoneBR("11912345678")).toBe("(11) 91234-5678");
  });
  it("formata fixo (10 dígitos)", () => {
    expect(formatPhoneBR("1133334444")).toBe("(11) 3333-4444");
  });
  it.each([
    ["+55 (11) 91234-5678", "(11) 91234-5678"],
    ["55 11 3333-4444", "(11) 3333-4444"],
  ])("formata DDI brasileiro antes de aplicar a máscara", (input, expected) => {
    expect(formatPhoneBR(input)).toBe(expected);
  });
  it("formata progressivamente enquanto digita", () => {
    expect(formatPhoneBR("1")).toBe("(1");
    expect(formatPhoneBR("11")).toBe("(11");
    expect(formatPhoneBR("119")).toBe("(11) 9");
    expect(formatPhoneBR("119123")).toBe("(11) 9123");
  });
  it("reformatar o próprio output é estável", () => {
    expect(formatPhoneBR("(11) 91234-5678")).toBe("(11) 91234-5678");
  });
  it("não esconde dígitos excedentes na máscara", () => {
    expect(formatPhoneBR("119123456789")).toBe("119123456789");
    expect(formatPhoneBR("+55 11 91234-56789")).toBe("119123456789");
  });
});

describe("isValidPhoneBR", () => {
  it("aceita celular com 9 e fixo", () => {
    expect(isValidPhoneBR("(11) 91234-5678")).toBe(true);
    expect(isValidPhoneBR("(11) 3333-4444")).toBe(true);
  });
  it("rejeita curto, DDD inválido e celular sem 9", () => {
    expect(isValidPhoneBR("9123")).toBe(false);
    expect(isValidPhoneBR("(01) 91234-5678")).toBe(false);
    expect(isValidPhoneBR("(11) 81234-5678" + "9")).toBe(false); // 11 dígitos sem 9 após DDD
    expect(isValidPhoneBR("119123456789")).toBe(false);
    expect(isValidPhoneBR("")).toBe(false);
  });
  it.each([
    "+1 (212) 555-0100",
    "abc (11) 91234-5678",
    "(11)\t91234-5678",
    "(20) 91234-5678",
    "(11) 9333-4444",
    "(11) 81234-5678",
    "+55 (11) 91234-56789",
  ])("rejeita DDI, caracteres, DDD, prefixo ou tamanho inválido: %s", (input) => {
    expect(isValidPhoneBR(input)).toBe(false);
  });
});
