import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInviteEmail, inviteUrl } from "@/lib/invite-email";
import {
  MailerConfigurationError,
  ResendMailer,
} from "@/lib/mailer";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("e-mail de convite", () => {
  it("inclui salão, pessoa, função, validade, botão, texto e aviso", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    const message = buildInviteEmail({
      salonName: "Barbearia Central",
      invitedName: "Ana",
      role: "PROFESSIONAL",
      token: "safe-token-value-1234567890",
    });
    expect(message.subject).toContain("Barbearia Central");
    expect(message.html).toContain("Aceitar convite");
    expect(message.html).toContain("expira em 24 horas");
    expect(message.text).toContain("Ana");
    expect(message.text).toContain("Profissional");
    expect(message.text).toContain("ignore esta mensagem");
    expect(message.text).toContain("/convite/safe-token-value-1234567890");
  });

  it("escapa conteúdo variável no HTML", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    const message = buildInviteEmail({
      salonName: "<script>alert(1)</script>",
      invitedName: "<b>Ana</b>",
      role: "MANAGER",
      token: "safe-token-value-1234567890",
    });
    expect(message.html).not.toContain("<script>");
    expect(message.html).not.toContain("<b>Ana</b>");
  });

  it("recusa URL sem HTTPS em produção", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "http://app.example.com");
    expect(() => inviteUrl("safe-token-value-1234567890")).toThrow("HTTPS");
  });

  it("mailer é simulável e não chama Resend sem configuração", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mailer = new ResendMailer(undefined, undefined);
    await expect(
      mailer.send({ to: "a@example.com", subject: "x", html: "x", text: "x" }),
    ).rejects.toBeInstanceOf(MailerConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converte falha HTTP em código sanitizado sem incluir segredo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    const mailer = new ResendMailer("secret-api-key", "noreply@example.com");
    const promise = mailer.send({
      to: "a@example.com",
      subject: "x",
      html: "x",
      text: "x",
    });
    await expect(promise).rejects.toMatchObject({
      code: "RESEND_HTTP_403",
      message: "O provedor de e-mail não confirmou o envio.",
    });
  });

  it("envia timeout e chave de idempotência ao Resend", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: "message-id" }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mailer = new ResendMailer(
      "secret-api-key",
      "noreply@example.com",
      2_000,
    );

    await mailer.send(
      {
        to: "a@example.com",
        subject: "x",
        html: "x",
        text: "x",
      },
      { idempotencyKey: "invite-1-attempt-2" },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "invite-1-attempt-2",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
