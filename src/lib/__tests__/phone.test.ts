import { describe, it, expect } from "vitest";
import { normalizePhone, formatPhoneBR, isValidPhoneBR } from "../phone";

describe("normalizePhone", () => {
  it("remove tudo que não é dígito", () => {
    expect(normalizePhone("(11) 91234-5678")).toBe("11912345678");
    expect(normalizePhone("+55 11 91234 5678")).toBe("55119123456");
  });
  it("trunca em 11 dígitos", () => {
    expect(normalizePhone("119123456789999")).toBe("11912345678");
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
  it("formata progressivamente enquanto digita", () => {
    expect(formatPhoneBR("1")).toBe("(1");
    expect(formatPhoneBR("11")).toBe("(11");
    expect(formatPhoneBR("119")).toBe("(11) 9");
    expect(formatPhoneBR("119123")).toBe("(11) 9123");
  });
  it("reformatar o próprio output é estável", () => {
    expect(formatPhoneBR("(11) 91234-5678")).toBe("(11) 91234-5678");
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
    expect(isValidPhoneBR("")).toBe(false);
  });
});
