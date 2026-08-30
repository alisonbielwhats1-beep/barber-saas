import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPasswordResetEmail, passwordResetUrl } from "@/lib/password-reset-email";

describe("e-mail de recuperação de senha", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("gera links HTTPS separados para equipe e cliente", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com/base?ignored=1");

    expect(passwordResetUrl({ token: "abc_DEF-123" })).toBe(
      "https://app.example.com/redefinir-senha/abc_DEF-123",
    );
    expect(passwordResetUrl({ token: "abc_DEF-123", salonSlug: "studio-a" })).toBe(
      "https://app.example.com/book/studio-a/redefinir-senha/abc_DEF-123",
    );
  });

  it("escapa conteúdo variável e informa uso único e expiração", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    const email = buildPasswordResetEmail({
      recipientName: "<Maria>",
      salonName: "Studio & Cia",
      salonSlug: "studio-a",
      token: "token-seguro",
    });

    expect(email.html).toContain("&lt;Maria&gt;");
    expect(email.html).toContain("Studio &amp; Cia");
    expect(email.text).toContain("funciona uma única vez e expira em 1 hora");
  });
});
