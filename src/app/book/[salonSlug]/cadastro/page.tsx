import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { getClientSessionForSalonSlug } from "@/lib/client-session-tenant";
import { clientHomePath, safeClientReturnTo } from "@/lib/client-routes";
import { CadastroForm } from "./cadastro-form";

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
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
            {salon.name}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Criar conta</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Agende sem precisar digitar seus dados toda vez.
          </p>
        </div>

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
    </main>
  );
}
