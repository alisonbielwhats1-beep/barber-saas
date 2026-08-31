import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PasswordRecoveryLoginLink } from "@/components/password-recovery-login-link";

describe("atalho de recuperação de senha no login", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("não oferece uma ação indisponível sem provedor de e-mail", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");

    expect(renderToStaticMarkup(
      <PasswordRecoveryLoginLink href="/recuperar-senha" />,
    )).toBe("");
  });

  it("exibe o atalho quando provedor e remetente estão configurados", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Salon <noreply@example.com>");

    const markup = renderToStaticMarkup(
      <PasswordRecoveryLoginLink href="/recuperar-senha" />,
    );

    expect(markup).toContain('href="/recuperar-senha"');
    expect(markup).toContain("Recuperar por e-mail");
  });
});
