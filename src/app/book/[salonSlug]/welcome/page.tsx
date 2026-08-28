import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, MoreHorizontal } from "lucide-react";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { HERO_IMAGES, normalizeImageUrl } from "@/lib/images";
import { SEGMENTS } from "@/lib/segments";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { clientBookingPath, safeClientReturnTo } from "@/lib/client-routes";
import { PwaInstallCard } from "@/components/pwa-install-card";

/**
 * Entrada do app do cliente. Visitantes passam primeiro por esta escolha de
 * autenticação; clientes válidos são enviados diretamente para a home.
 */
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
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: { name: true, address: true, coverUrl: true, segment: true },
    });
    if (!salon) return null;
    const validSession = await resolveClientSessionInTenant(tx, session, salonId);
    return { salon, validSession };
  });
  if (!result) notFound();

  const bookingPath = clientBookingPath(salonSlug);
  const returnTo = safeClientReturnTo(salonSlug, query.returnTo, bookingPath);
  if (result.validSession) {
    redirect(query.returnTo ? returnTo : `/book/${salonSlug}`);
  }

  const authQuery = `?returnTo=${encodeURIComponent(returnTo)}`;
  const { salon } = result;

  // Escolha determinística por slug pra a mesma URL sempre mostrar a mesma foto
  const heroIdx = salonSlug
    .split("")
    .reduce((a, c) => a + c.charCodeAt(0), 0) % HERO_IMAGES.length;
  const segmentImage = SEGMENTS.find((item) => item.id === salon.segment)?.accentImage;
  const heroSrc = normalizeImageUrl(salon.coverUrl) ?? segmentImage ?? HERO_IMAGES[heroIdx];

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* Hero image */}
      <Image
        src={heroSrc}
        alt={salon.name}
        fill
        priority
        sizes="480px"
        className="-z-30 object-cover"
      />
      {/* Overlay dark do rodapé pra topo */}
      <div className="absolute inset-0 -z-20 bg-gradient-to-t from-background via-background/85 to-background/20" />
      {/* Tint verde no canto superior */}
      <div className="absolute inset-x-0 top-0 -z-10 h-1/2 bg-[radial-gradient(ellipse_at_top,_rgba(125,248,155,0.15),_transparent_65%)]" />

      <header className="flex items-center justify-between gap-3 px-6 pt-6 text-xs text-muted-foreground">
        <span className="font-mono">•••</span>
        <div className="flex items-center gap-1">
          <Link
            href={`/book/${salonSlug}/login${authQuery}`}
            className="inline-flex min-h-11 items-center rounded-full px-3 font-semibold text-muted-foreground hover:text-foreground"
          >
            Entrar
          </Link>
          <Link
            href={`/book/${salonSlug}/cadastro${authQuery}`}
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-3 font-semibold text-primary-foreground"
          >
            Criar conta
          </Link>
        </div>
      </header>

      <div className="flex flex-1 flex-col justify-end px-8 pb-16 pt-24">
        <span className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-primary backdrop-blur">
          <MoreHorizontal className="h-3 w-3" /> Acesso do cliente
        </span>
        <h1 className="font-display text-4xl leading-tight tracking-tight">Seu próximo horário começa aqui</h1>
        <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
          Entre na sua conta ou crie um cadastro para agendar e acompanhar seus horários em {salon.name}.
        </p>

        <div className="mt-8 grid gap-3">
          <Link
            href={`/book/${salonSlug}/login${authQuery}`}
            className="flex min-h-14 items-center justify-between rounded-full bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-2xl shadow-primary/30 transition hover:scale-[1.01]"
          >
            Entrar para agendar
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary-foreground text-primary">
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </span>
          </Link>
          <Link
            href={`/book/${salonSlug}/cadastro${authQuery}`}
            className="flex min-h-14 items-center justify-center rounded-full border border-primary/40 bg-background/30 px-6 py-4 text-sm font-semibold text-primary backdrop-blur transition hover:bg-primary/10"
          >
            Criar minha conta
          </Link>
        </div>

        <PwaInstallCard salonName={salon.name} className="mt-4" />
      </div>
    </div>
  );
}
