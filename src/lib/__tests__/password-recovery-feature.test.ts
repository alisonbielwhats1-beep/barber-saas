import { describe, expect, it } from "vitest";
import { passwordRecoveryEmailEnabled } from "@/lib/password-recovery-feature";

describe("recuperação de senha por e-mail", () => {
  it("só fica disponível com provedor e remetente configurados", () => {
    expect(passwordRecoveryEmailEnabled({})).toBe(false);
    expect(passwordRecoveryEmailEnabled({ RESEND_API_KEY: "re_test" })).toBe(false);
    expect(passwordRecoveryEmailEnabled({ EMAIL_FROM: "Salon <noreply@example.com>" })).toBe(false);
    expect(passwordRecoveryEmailEnabled({
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "Salon <noreply@example.com>",
    })).toBe(true);
  });
});
