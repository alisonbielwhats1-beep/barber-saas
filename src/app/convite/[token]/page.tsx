import { Scissors } from "lucide-react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { emailInvitesEnabled } from "@/lib/email-invites-feature";
import { getInviteView, type InviteRole } from "@/lib/invitations";
import { InviteForm } from "./invite-form";

const ROLE_LABEL: Record<InviteRole, string> = {
  OWNER: "Dono(a)",
  MANAGER: "Gerente",
  PROFESSIONAL: "Profissional",
  RECEPTIONIST: "Recepção",
};

const STATE_COPY = {
  INVALID: ["Convite inválido", "Confira o link recebido ou solicite um novo convite."],
  EXPIRED: ["Convite expirado", "Este link expirou após 24 horas. Solicite um novo envio."],
  USED: ["Convite já utilizado", "Este acesso já foi confirmado. Entre normalmente no painel."],
  REVOKED: ["Convite cancelado", "O responsável pelo estabelecimento cancelou este convite."],
  WRONG_USER: ["Usuário incorreto", "Saia da conta atual e entre com o e-mail que recebeu o convite."],
} as const;

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!emailInvitesEnabled()) {
    return (
      <main id="main-content" tabIndex={-1} className="grid min-h-dvh place-items-center bg-background p-6 text-foreground outline-none">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center justify-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary">
              <Scissors className="h-4 w-4 text-primary-foreground" />
            </span>
            <span className="font-semibold">SalonSaaS</span>
          </div>
          <section className="rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h1 className="text-xl font-semibold">Convites temporariamente indisponíveis</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              O envio e o aceite de convites ainda não estão liberados. Fale
              com o responsável pelo estabelecimento.
            </p>
          </section>
        </div>
      </main>
    );
  }

  const { token } = await params;
  const session = await getServerSession(authOptions);
  const invite = await getInviteView(token, session?.user?.id);
  const terminal =
    invite.state === "INVALID" ||
    invite.state === "EXPIRED" ||
    invite.state === "USED" ||
    invite.state === "REVOKED" ||
    invite.state === "WRONG_USER";
  const terminalCopy = terminal
    ? STATE_COPY[invite.state as keyof typeof STATE_COPY]
    : null;

  return (
    <main id="main-content" tabIndex={-1} className="grid min-h-dvh place-items-center bg-background p-6 text-foreground outline-none">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary">
            <Scissors className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="font-semibold">SalonSaaS</span>
        </div>
        <section className="rounded-2xl border border-border bg-card p-6 shadow-xl">
          {terminal ? (
            <>
              <h1 className="text-xl font-semibold">
                {terminalCopy![0]}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {terminalCopy![1]}
              </p>
              {invite.state === "WRONG_USER" && (
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(`/convite/${token}`)}`}
                  className="mt-5 flex w-full justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Entrar com outra conta
                </Link>
              )}
            </>
          ) : (
            <>
              <p className="text-xs font-medium uppercase tracking-wider text-primary">
                {invite.salonName}
              </p>
              <h1 className="mt-1 text-xl font-semibold">Aceitar convite</h1>
              <div className="my-4 rounded-xl bg-surface-1 p-3 text-sm">
                <p className="font-medium">{invite.invitedName}</p>
                <p className="text-muted-foreground">{invite.maskedEmail}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Função: {ROLE_LABEL[invite.role!]}
                </p>
              </div>
              {invite.state === "LOGIN_REQUIRED" ? (
                <>
                  <p className="mb-5 text-sm text-muted-foreground">
                    Esta conta já existe. Entre com a senha atual do e-mail
                    convidado; ela não será alterada.
                  </p>
                  <Link
                    href={`/login?callbackUrl=${encodeURIComponent(`/convite/${token}`)}`}
                    className="flex w-full justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Entrar para aceitar
                  </Link>
                </>
              ) : (
                <>
                  <p className="mb-5 text-sm text-muted-foreground">
                    {invite.state === "CREATE_ACCOUNT"
                      ? "Crie sua senha para ativar a conta. O link funciona uma única vez."
                      : "Confirme o convite para liberar seu acesso ao painel."}
                  </p>
                  <InviteForm
                    token={token}
                    mode={invite.state === "CREATE_ACCOUNT" ? "new" : "existing"}
                  />
                </>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
