import { describe, expect, it } from "vitest";
import { platformSignupEmailEnabled } from "@/lib/platform-signup-notification";

describe("aviso de novo estabelecimento", () => {
  it("falha fechado quando a ativação ou alguma credencial está ausente", () => {
    expect(platformSignupEmailEnabled({})).toBe(false);
    expect(
      platformSignupEmailEnabled({
        PLATFORM_SIGNUP_NOTIFICATIONS_ENABLED: "true",
        PLATFORM_ADMIN_NOTIFICATION_EMAIL: "admin@example.com",
        RESEND_API_KEY: "re_test",
      }),
    ).toBe(false);
  });

  it("usa somente o canal de e-mail já configurado no projeto", () => {
    expect(
      platformSignupEmailEnabled({
        PLATFORM_SIGNUP_NOTIFICATIONS_ENABLED: "true",
        PLATFORM_ADMIN_NOTIFICATION_EMAIL: "admin@example.com",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "SalonSaaS <noreply@example.com>",
        NEXTAUTH_URL: "https://app.example.com",
      }),
    ).toBe(true);
  });
});
