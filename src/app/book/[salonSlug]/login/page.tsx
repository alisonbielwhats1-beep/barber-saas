import Link from "next/link";
import { redirect } from "next/navigation";
import { getClientSessionForSalonSlug } from "@/lib/client-session-tenant";
import { clientHomePath } from "@/lib/client-routes";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ salonSlug: string }>;
  searchParams: Promise<{ returnTo?: string; senha?: string }>;
}) {
  const [{ salonSlug }, query] = await Promise.all([params, searchParams]);
  const homePath = clientHomePath(salonSlug);

  const session = await getClientSessionForSalonSlug(salonSlug);
  if (session) redirect(homePath);

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

        <LoginForm salonSlug={salonSlug} passwordReset={query.senha === "alterada"} />

        <p className="text-center text-sm text-muted-foreground">
          Esqueceu a senha?{" "}
          <Link
            href={`/book/${salonSlug}/recuperar-senha`}
            className="font-medium text-primary hover:underline"
          >
            Recuperar por e-mail
          </Link>
        </p>

        <p className="text-center text-sm text-muted-foreground">
          Primeira vez?{" "}
          <Link
            href={`/book/${salonSlug}/cadastro`}
            className="font-medium text-primary hover:underline"
          >
            Criar conta
          </Link>
        </p>

        <div className="text-center">
          <Link
            href={`/book/${salonSlug}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Voltar para o salão
          </Link>
        </div>
      </div>
    </main>
  );
}
