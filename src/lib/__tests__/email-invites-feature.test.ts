import { describe, expect, it } from "vitest";
import {
  assertEmailInvitesEnabled,
  EMAIL_INVITES_DISABLED_MESSAGE,
  emailInvitesEnabled,
} from "@/lib/email-invites-feature";

describe("contingência dos convites por e-mail", () => {
  it("permanece desativada por padrão", () => {
    expect(emailInvitesEnabled({})).toBe(false);
  });

  it("não aceita valores aproximados nem configuração incompleta", () => {
    expect(
      emailInvitesEnabled({
        EMAIL_INVITES_ENABLED: "TRUE",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "SalonSaaS <convites@example.com>",
      }),
    ).toBe(false);
    expect(
      emailInvitesEnabled({
        EMAIL_INVITES_ENABLED: "true",
        RESEND_API_KEY: "re_test",
      }),
    ).toBe(false);
  });

  it("só ativa com flag explícita e as duas configurações de e-mail", () => {
    expect(
      emailInvitesEnabled({
        EMAIL_INVITES_ENABLED: "true",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "SalonSaaS <convites@example.com>",
      }),
    ).toBe(true);
  });

  it("falha fechado com mensagem operacional segura", () => {
    expect(() => assertEmailInvitesEnabled({})).toThrow(
      EMAIL_INVITES_DISABLED_MESSAGE,
    );
  });
});
