import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mailer", () => ({ defaultMailer: { send: vi.fn() } }));
import { alertCreditReview, creditReviewAlertEnabled } from "./credit-review-alert";

const env = { PLATFORM_ADMIN_NOTIFICATION_EMAIL: "admin@example.test", RESEND_API_KEY: "synthetic", EMAIL_FROM: "Everflair <no-reply@example.test>", NEXTAUTH_URL: "http://localhost:3000" };
const input = { salonId: "salao-1", purchaseId: "compra-1", reason: "PAYMENT_MISMATCH" };

describe("alert of a credit purchase in review (validation review 07/10/2026)", () => {
  it("needs the admin e-mail and the mailer configured; without them it only logs", async () => {
    expect(creditReviewAlertEnabled(env)).toBe(true);
    expect(creditReviewAlertEnabled({ ...env, PLATFORM_ADMIN_NOTIFICATION_EMAIL: " " })).toBe(false);
    const send = vi.fn();
    expect(await alertCreditReview(input, {}, { send })).toBe("disabled");
    expect(send).not.toHaveBeenCalled();
  });
  it("sends one e-mail with codes and ids only", async () => {
    const send = vi.fn(async () => ({ id: "m1" }));
    expect(await alertCreditReview(input, env, { send } as never)).toBe("sent");
    const message = (send.mock.calls[0] as unknown[])[0] as { to: string; subject: string; text: string };
    expect(message.to).toBe("admin@example.test");
    expect(message.text).toContain("salao-1"); expect(message.text).toContain("compra-1"); expect(message.text).toContain("PAYMENT_MISMATCH");
  });
  it("never throws, and never echoes free text from outside", async () => {
    const send = vi.fn(async () => { throw Error("provider down"); });
    expect(await alertCreditReview({ ...input, reason: "<script>x</script>" }, env, { send } as never)).toBe("failed");
    const ok = vi.fn(async () => ({ id: "m2" }));
    await alertCreditReview({ ...input, reason: "<b>x</b>" }, env, { send: ok } as never);
    expect(((ok.mock.calls[0] as unknown[])[0] as { html: string }).html).not.toContain("<b>x</b>");
  });
});
