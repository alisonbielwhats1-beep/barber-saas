import Link from "next/link";
import { redirect } from "next/navigation";
import { getClientSessionForSalonSlug } from "@/lib/client-session-tenant";
import { clientHomePath, safeClientReturnTo } from "@/lib/client-routes";
import { PasswordRecoveryLoginLink } from "@/components/password-recovery-login-link";
import { LoginForm } from "./login-form";
import { ClientAccessLayout } from "../client-access-layout";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ salonSlug: string }>;
  searchParams: Promise<{ returnTo?: string; senha?: string }>;
}) {
  const [{ salonSlug }, query] = await Promise.all([params, searchParams]);
  const homePath = safeClientReturnTo(salonSlug, query.returnTo, clientHomePath(salonSlug));

  const session = await getClientSessionForSalonSlug(salonSlug);
  if (session) redirect(homePath);

  return (
    <ClientAccessLayout eyebrow="Sua conta" title="Entrar" description="Acesse para agendar e acompanhar suas reservas.">
      <div className="space-y-6">
        <LoginForm salonSlug={salonSlug} returnTo={homePath} passwordReset={query.senha === "alterada"} />

        <PasswordRecoveryLoginLink
          href={`/book/${salonSlug}/recuperar-senha`}
        />

        <p className="text-center text-sm text-muted-foreground">
          Primeira vez?{" "}
          <Link
            href={`/book/${salonSlug}/cadastro?returnTo=${encodeURIComponent(homePath)}`}
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
    </ClientAccessLayout>
  );
}
