import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { clientHomePath, safeClientReturnTo } from "@/lib/client-routes";
import { PwaInstallCard } from "@/components/pwa-install-card";
import { ClientAccessLayout } from "../client-access-layout";

export default async function WelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ salonSlug: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const [{ salonSlug }, query] = await Promise.all([params, searchParams]);
  const session = await getClientSession();
  const result = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    const salon = await tx.salon.findUnique({ where: { id: salonId }, select: { name: true } });
    if (!salon) return null;
    const validSession = await resolveClientSessionInTenant(tx, session, salonId);
    return { salon, validSession };
  });
  if (!result) notFound();
  const homePath = clientHomePath(salonSlug);
  if (result.validSession) redirect(homePath);
  const returnTo = safeClientReturnTo(salonSlug, query.returnTo, homePath);
  const authQuery = `?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <ClientAccessLayout
      salonName={result.salon.name}
      eyebrow="Bem-vindo"
      title="Seu tempo de se cuidar."
      description="Escolha seu atendimento. Acompanhe suas reservas e conte como foi sua experiência."
      footer={<PwaInstallCard salonName={result.salon.name} storageKey={salonSlug} />}
    >
      <div className="space-y-3">
        <Link href={`/book/${salonSlug}/agendar`} className="client-access-primary flex min-h-14 items-center justify-between gap-3 rounded-2xl px-5 py-3 text-sm font-semibold transition-colors">
          Agendar um horário <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
        <p className="pb-3 text-center text-xs text-muted-foreground">Veja serviços e horários antes de entrar.</p>
        <Link href={`/book/${salonSlug}/login${authQuery}`} className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-border px-5 py-3 text-sm font-semibold transition-colors hover:bg-muted">
          Entrar na minha conta <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
        <Link href={`/book/${salonSlug}/cadastro${authQuery}`} className="flex min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-sm font-medium text-primary transition hover:bg-muted">
          Criar uma conta
        </Link>
      </div>
      <div className="mt-5 flex items-start gap-3 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
        <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <p>Já tem um horário marcado? Entre na sua conta para consultar, remarcar ou avaliar seu atendimento.</p>
      </div>
    </ClientAccessLayout>
  );
}
