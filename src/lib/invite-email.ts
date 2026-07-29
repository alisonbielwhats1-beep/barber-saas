import type { InviteRole } from "./invitations";
import type { MailMessage } from "./mailer";

const ROLE_LABEL: Record<InviteRole, string> = {
  OWNER: "Dono(a)",
  MANAGER: "Gerente",
  PROFESSIONAL: "Profissional",
  RECEPTIONIST: "Recepção",
};

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

export function inviteUrl(token: string): string {
  const configured = process.env.NEXTAUTH_URL;
  if (!configured) {
    throw new Error("NEXTAUTH_URL precisa estar configurada para enviar convites.");
  }
  const base = new URL(configured);
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:") {
    throw new Error("NEXTAUTH_URL precisa usar HTTPS em produção.");
  }
  base.pathname = `/convite/${encodeURIComponent(token)}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function buildInviteEmail(input: {
  salonName: string;
  invitedName: string;
  role: InviteRole;
  token: string;
}): MailMessage {
  const url = inviteUrl(input.token);
  const salon = escapeHtml(input.salonName);
  const name = escapeHtml(input.invitedName);
  const role = ROLE_LABEL[input.role];

  return {
    to: "",
    subject: `Convite para acessar ${input.salonName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717">
        <h1 style="font-size:22px">Você recebeu um convite</h1>
        <p>Olá, ${name}.</p>
        <p><strong>${salon}</strong> convidou você para participar como <strong>${role}</strong>.</p>
        <p>Este link é pessoal, funciona uma única vez e expira em 24 horas.</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(url)}" style="background:#171717;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">
            Aceitar convite
          </a>
        </p>
        <p style="font-size:13px;color:#666">Se você não reconhece este convite, ignore esta mensagem. Nenhum acesso será criado.</p>
      </div>
    `.trim(),
    text: [
      `Olá, ${input.invitedName}.`,
      "",
      `${input.salonName} convidou você para participar como ${role}.`,
      "Este link é pessoal, funciona uma única vez e expira em 24 horas.",
      "",
      `Aceitar convite: ${url}`,
      "",
      "Se você não reconhece este convite, ignore esta mensagem. Nenhum acesso será criado.",
    ].join("\n"),
  };
}

