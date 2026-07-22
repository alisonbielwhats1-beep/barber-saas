import Link from "next/link";
import { redirect } from "next/navigation";
import { getClientSession } from "@/lib/client-auth";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: { salonSlug: string };
  searchParams: { returnTo?: string };
}) {
  const returnTo =
    searchParams.returnTo?.startsWith(`/book/${params.salonSlug}/`)
      ? searchParams.returnTo
      : null;

  const session = await getClientSession();
  if (session) redirect(returnTo ?? `/book/${params.salonSlug}/minhas`);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
            Sua conta
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Entrar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acesse para ver e gerenciar suas reservas.
          </p>
        </div>

        <LoginForm salonSlug={params.salonSlug} returnTo={returnTo} />

        <p className="text-center text-sm text-muted-foreground">
          Primeira vez?{" "}
          <Link
            href={`/book/${params.salonSlug}/cadastro${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
            className="font-medium text-primary hover:underline"
          >
            Criar conta
          </Link>
        </p>

        <div className="text-center">
          <Link
            href={`/book/${params.salonSlug}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Voltar para o salão
          </Link>
        </div>
      </div>
    </main>
  );
}
