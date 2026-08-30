import type { MailMessage } from "./mailer";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char]!,
  );
}

export function passwordResetUrl(input: {
  token: string;
  salonSlug?: string;
}): string {
  if (!process.env.NEXTAUTH_URL) {
    throw new Error("NEXTAUTH_URL precisa estar configurada para recuperar senha.");
  }
  const base = new URL(process.env.NEXTAUTH_URL);
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:") {
    throw new Error("NEXTAUTH_URL precisa usar HTTPS em produção.");
  }
  base.pathname = input.salonSlug
    ? `/book/${encodeURIComponent(input.salonSlug)}/redefinir-senha/${encodeURIComponent(input.token)}`
    : `/redefinir-senha/${encodeURIComponent(input.token)}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function buildPasswordResetEmail(input: {
  recipientName: string;
  token: string;
  salonName?: string;
  salonSlug?: string;
}): MailMessage {
  const url = passwordResetUrl({ token: input.token, salonSlug: input.salonSlug });
  const name = escapeHtml(input.recipientName);
  const context = input.salonName
    ? ` para acessar <strong>${escapeHtml(input.salonName)}</strong>`
    : " para acessar o SalonSaaS";

  return {
    to: "",
    subject: input.salonName
      ? `Redefina sua senha em ${input.salonName}`
      : "Redefina sua senha no SalonSaaS",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717">
        <h1 style="font-size:22px">Redefinição de senha</h1>
        <p>Olá, ${name}.</p>
        <p>Recebemos uma solicitação para redefinir sua senha${context}.</p>
        <p>Este link é pessoal, funciona uma única vez e expira em 1 hora.</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(url)}" style="background:#171717;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">
            Criar nova senha
          </a>
        </p>
        <p style="font-size:13px;color:#666">Se você não fez esta solicitação, ignore a mensagem. Sua senha atual continua válida.</p>
      </div>
    `.trim(),
    text: [
      `Olá, ${input.recipientName}.`,
      "",
      `Recebemos uma solicitação para redefinir sua senha${input.salonName ? ` em ${input.salonName}` : " no SalonSaaS"}.`,
      "Este link é pessoal, funciona uma única vez e expira em 1 hora.",
      "",
      `Criar nova senha: ${url}`,
      "",
      "Se você não fez esta solicitação, ignore a mensagem. Sua senha atual continua válida.",
    ].join("\n"),
  };
}
