import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { getClientSessionForSalonSlug } from "@/lib/client-session-tenant";
import { clientHomePath, safeClientReturnTo } from "@/lib/client-routes";
import { CadastroForm } from "./cadastro-form";
import { ClientAccessLayout } from "../client-access-layout";

export default async function CadastroPage({
  params,
  searchParams,
}: {
  params: Promise<{ salonSlug: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const [{ salonSlug }, query] = await Promise.all([params, searchParams]);
  const homePath = safeClientReturnTo(salonSlug, query.returnTo, clientHomePath(salonSlug));

  const session = await getClientSessionForSalonSlug(salonSlug);
  if (session) redirect(homePath);
  const salon = await withSalonBySlug(salonSlug, (tx, salonId) => tx.salon.findUnique({ where: { id: salonId }, select: { name: true } }));
  if (!salon) notFound();

  return (
    <ClientAccessLayout salonName={salon.name} eyebrow="Primeira vez por aqui?" title="Criar conta" description="Cadastre-se para reservar seu horário e ter seus atendimentos sempre à mão.">
      <div className="space-y-6">
        <CadastroForm salonSlug={salonSlug} returnTo={homePath} />

        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <Link
            href={`/book/${salonSlug}/login?returnTo=${encodeURIComponent(homePath)}`}
            className="font-medium text-primary hover:underline"
          >
            Entrar
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
