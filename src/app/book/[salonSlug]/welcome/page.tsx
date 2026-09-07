import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BellRing, CalendarDays, Scissors } from "lucide-react";
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
  const benefits = [
    { icon: CalendarDays, label: "Agende", text: "Escolha seu horário" },
    { icon: Scissors, label: "Cuide-se", text: "Encontre seu serviço" },
    { icon: BellRing, label: "Acompanhe", text: "Veja suas reservas" },
  ];

  return (
    <ClientAccessLayout
      salonName={result.salon.name}
      eyebrow="Bem-vindo"
      title="Seu próximo horário começa aqui"
      description="Entre ou crie sua conta para agendar e acompanhar seus atendimentos."
      footer={<PwaInstallCard salonName={result.salon.name} storageKey={salonSlug} />}
    >
      <div className="space-y-3">
        <Link href={`/book/${salonSlug}/login${authQuery}`} className="client-access-primary flex min-h-14 items-center justify-between gap-3 rounded-full px-5 py-3 text-sm font-semibold transition-colors">
          Entrar na minha conta <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
        <Link href={`/book/${salonSlug}/cadastro${authQuery}`} className="flex min-h-12 items-center justify-center rounded-full border border-border bg-background px-5 py-3 text-sm font-semibold transition hover:bg-card-hover">
          Criar uma conta
        </Link>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-5" aria-label="Benefícios da sua conta">
        {benefits.map(({ icon: Icon, label, text }) => (
          <div key={label} className="min-w-0">
            <Icon className="mb-2 h-4 w-4 text-primary" aria-hidden="true" />
            <p className="break-words text-xs font-semibold">{label}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>
    </ClientAccessLayout>
  );
}
