import { describe, expect, it } from "vitest";
import {
  PRIVACY_CONTACT_EMAIL,
  SERVICE_URL,
  hasPendingLegalIdentity,
  isPlaceholder,
} from "../legal";

describe("isPlaceholder", () => {
  // Testa a regra, não o valor atual das constantes: um teste que afirmasse
  // "existe pendência" passaria a quebrar exatamente quando alguém fizesse a
  // coisa certa e preenchesse os dados.
  it("reconhece campo ainda não preenchido", () => {
    expect(isPlaceholder("PREENCHER: nome civil completo")).toBe(true);
    expect(isPlaceholder("  PREENCHER: cidade/UF")).toBe(true);
  });

  it("aceita valor real preenchido", () => {
    expect(isPlaceholder("Maria de Souza")).toBe(false);
    expect(isPlaceholder("São Paulo/SP")).toBe(false);
  });

  it("não confunde a palavra no meio do texto com marcador", () => {
    expect(isPlaceholder("Empresa PREENCHER Ltda")).toBe(false);
  });
});

describe("hasPendingLegalIdentity", () => {
  it("responde sempre um booleano, qualquer que seja o estado", () => {
    expect(typeof hasPendingLegalIdentity()).toBe("boolean");
  });
});

describe("dados de contato dos documentos legais", () => {
  it("expõe um e-mail válido — a LGPD exige canal real de atendimento", () => {
    expect(PRIVACY_CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
    expect(PRIVACY_CONTACT_EMAIL).not.toMatch(/PREENCHER|example\.com/i);
  });

  it("aponta para o endereço de produção, não para preview da Vercel", () => {
    // Preview da Vercel fica atrás do SSO: um cliente sem conta na Vercel
    // bate numa tela de login ao abrir. Endereço legal precisa ser o público.
    expect(SERVICE_URL).toBe("https://salon-saas-ruby.vercel.app");
    expect(SERVICE_URL).toMatch(/^https:\/\//);
  });
});
