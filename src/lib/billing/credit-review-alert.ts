import "server-only";
import { defaultMailer, type Mailer } from "@/lib/mailer";

type Env = Record<string, string | undefined>;
/** Validation review 07/10/2026: a credit purchase that lands in review (a payment that does not match its purchase, or a second
 * payment of the same purchase) holds money without credit until someone looks. The platform admin gets one e-mail with
 * codes and ids only (never amounts typed by the customer or provider text); without e-mail configured, only the log line. */
export function creditReviewAlertEnabled(env: Env = process.env) {
  return Boolean(env.PLATFORM_ADMIN_NOTIFICATION_EMAIL?.trim() && env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim() && env.NEXTAUTH_URL?.trim());
}
const code = (value: string) => /^[A-Za-z0-9_:-]{1,120}$/.test(value) ? value : "UNKNOWN";
/** Never throws: an alert that fails never touches the payment it reports. */
export async function alertCreditReview(input: { salonId: string; purchaseId: string; reason: string }, env: Env = process.env, mailer: Mailer = defaultMailer) {
  const fields = { salonId: code(input.salonId), purchaseId: code(input.purchaseId), reason: code(input.reason) };
  console.error("SECRETARY_CREDIT_PURCHASE_REVIEW", JSON.stringify(fields));
  if (!creditReviewAlertEnabled(env)) return "disabled" as const;
  try {
    await mailer.send({ to: env.PLATFORM_ADMIN_NOTIFICATION_EMAIL!.trim(), subject: "Pagamento de crédito da Secretária para conferir",
      text: ["Um pagamento de crédito da Secretária precisa de conferência: o dinheiro entrou, mas esse pagamento não virou crédito (a compra pode já estar paga por outro pagamento).", "",
        `Salão: ${fields.salonId}`, `Compra: ${fields.purchaseId}`, `Motivo: ${fields.reason}`, "",
        "Confira o pagamento no Mercado Pago e decida entre creditar (cortesia no HQ) ou estornar."].join("\n"),
      html: `<p>Um pagamento de crédito da Secretária <strong>precisa de conferência</strong>: o dinheiro entrou, mas esse pagamento não virou crédito (a compra pode já estar paga por outro pagamento).</p>
<p>Salão: ${fields.salonId}<br>Compra: ${fields.purchaseId}<br>Motivo: ${fields.reason}</p>
<p>Confira o pagamento no Mercado Pago e decida entre creditar (cortesia no HQ) ou estornar.</p>` });
    return "sent" as const;
  } catch { console.error("SECRETARY_CREDIT_REVIEW_ALERT_FAILED"); return "failed" as const; }
}
