import { Scissors } from "lucide-react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInviteMode } from "@/lib/invitations";
import { InviteForm } from "./invite-form";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const session = await getServerSession(authOptions);
  const mode = await getInviteMode(params.token, session?.user?.id);

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary">
            <Scissors className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="font-semibold">SalonSaaS</span>
        </div>
        <section className="rounded-2xl border border-border bg-card p-6 shadow-xl">
          {mode === "INVALID" ? (
            <>
              <h1 className="text-xl font-semibold">Convite indisponível</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                O link é inválido, expirou ou já foi utilizado. Solicite um novo
                convite ao responsável pelo estabelecimento.
              </p>
            </>
          ) : mode === "LOGIN_REQUIRED" ? (
            <>
              <h1 className="text-xl font-semibold">Confirme sua identidade</h1>
              <p className="mb-5 mt-1 text-sm text-muted-foreground">
                Entre com sua conta para confirmar o convite. Sua senha atual
                não será alterada.
              </p>
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(`/convite/${params.token}`)}`}
                className="flex w-full justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Entrar para aceitar
              </Link>
            </>
          ) : mode === "VERIFICATION_REQUIRED" ? (
            <>
              <h1 className="text-xl font-semibold">
                Verificação de e-mail necessária
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Esta conta ainda não existe e o projeto não possui verificação
                de e-mail configurada. O convite permanece bloqueado: este link
                não permite criar senha nem ativar acesso.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold">Confirme o convite</h1>
              <p className="mb-5 mt-1 text-sm text-muted-foreground">
                Confirme o convite para acessar este estabelecimento.{" "}
                O link funciona uma única vez e expira automaticamente.
              </p>
              <InviteForm token={params.token} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
