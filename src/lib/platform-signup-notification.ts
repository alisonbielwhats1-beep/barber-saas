import { defaultMailer } from "./mailer";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
        character
      ]!,
  );
}

export function platformSignupEmailEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(
    environment.PLATFORM_SIGNUP_NOTIFICATIONS_ENABLED === "true" &&
      environment.PLATFORM_ADMIN_NOTIFICATION_EMAIL?.trim() &&
      environment.RESEND_API_KEY?.trim() &&
      environment.EMAIL_FROM?.trim() &&
      environment.NEXTAUTH_URL?.trim(),
  );
}

export async function notifyPlatformAdminOfSignup(input: {
  salonName: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
}): Promise<"sent" | "disabled" | "failed"> {
  if (!platformSignupEmailEnabled()) return "disabled";
  const to = process.env.PLATFORM_ADMIN_NOTIFICATION_EMAIL!.trim();
  const salon = escapeHtml(input.salonName);
  const owner = escapeHtml(input.ownerName);
  const email = escapeHtml(input.ownerEmail);
  const adminUrl = new URL("/plataforma/solicitacoes", process.env.NEXTAUTH_URL).toString();

  try {
    await defaultMailer.send(
      {
        to,
        subject: `Novo estabelecimento aguardando aprovação: ${input.salonName}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717">
            <h1 style="font-size:22px">Novo pedido de acesso</h1>
            <p><strong>${salon}</strong> acabou de solicitar acesso ao SalonSaaS.</p>
            <p>Responsável: ${owner}<br>E-mail: ${email}</p>
            <p>O estabelecimento continua bloqueado até você escolher o plano Grátis ou Pro.</p>
            <p style="margin:28px 0"><a href="${escapeHtml(adminUrl)}" style="background:#171717;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">Analisar solicitação</a></p>
          </div>
        `.trim(),
        text: [
          "Novo pedido de acesso ao SalonSaaS",
          "",
          `Estabelecimento: ${input.salonName}`,
          `Responsável: ${input.ownerName}`,
          `E-mail: ${input.ownerEmail}`,
          "",
          `Analisar: ${adminUrl}`,
        ].join("\n"),
      },
      { idempotencyKey: `platform-signup-${input.slug}` },
    );
    return "sent";
  } catch {
    // O cadastro e o pedido já foram confirmados no banco. Falha de aviso não
    // pode desfazer a conta; a solicitação continua visível no painel central.
    return "failed";
  }
}
