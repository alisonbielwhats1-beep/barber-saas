import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Scissors,
  ShieldCheck,
} from "lucide-react";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { HERO_IMAGES, normalizeImageUrl } from "@/lib/images";
import { SEGMENTS } from "@/lib/segments";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { clientHomePath, safeClientReturnTo } from "@/lib/client-routes";
import { PwaInstallCard } from "@/components/pwa-install-card";
import { SalonLogoLightbox } from "../salon-logo-lightbox";

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
      select: {
        name: true,
        coverUrl: true,
        logoUrl: true,
        segment: true,
      },
    });
    if (!salon) return null;
    const validSession = await resolveClientSessionInTenant(tx, session, salonId);
    return { salon, validSession };
  });
  if (!result) notFound();

  const homePath = clientHomePath(salonSlug);
  const returnTo = safeClientReturnTo(salonSlug, query.returnTo, homePath);
  if (result.validSession) {
    redirect(returnTo);
  }

  const authQuery = `?returnTo=${encodeURIComponent(returnTo)}`;
  const { salon } = result;

  // Escolha determinística por slug pra a mesma URL sempre mostrar a mesma foto
  const heroIdx = salonSlug
    .split("")
    .reduce((a, c) => a + c.charCodeAt(0), 0) % HERO_IMAGES.length;
  const segmentImage = SEGMENTS.find((item) => item.id === salon.segment)?.accentImage;
  const heroSrc = normalizeImageUrl(salon.coverUrl) ?? segmentImage ?? HERO_IMAGES[heroIdx];
  const logoSrc = normalizeImageUrl(salon.logoUrl);
  const benefits = [
    { icon: CalendarDays, label: "Agende", text: "Escolha seu horário" },
    { icon: Scissors, label: "Cuide-se", text: "Serviços do salão" },
    { icon: BellRing, label: "Acompanhe", text: "Tudo na sua conta" },
  ];

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* Hero image */}
      <Image
        src={heroSrc}
        alt=""
        fill
        priority
        quality={95}
        sizes="100vw"
        className="-z-30 object-cover"
      />
      {/* Overlay dark do rodapé pra topo */}
      <div className="absolute inset-0 -z-20 bg-gradient-to-t from-background via-background/85 to-background/20" />
      {/* Atmosfera sutil na cor padrão do app do cliente */}
      <div className="absolute inset-x-0 top-0 -z-10 h-1/2 bg-[radial-gradient(ellipse_at_top,_hsl(var(--primary)/0.18),_transparent_65%)]" />

      <header className="flex items-center justify-between gap-4 px-6 pt-6">
        <div className="flex min-w-0 items-center gap-3">
          <SalonLogoLightbox
            src={logoSrc}
            alt={`Logo de ${salon.name}`}
            salonName={salon.name}
            className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border-0 bg-transparent p-0 text-primary shadow-none"
          >
            <span className="grid h-full w-full place-items-center rounded-lg bg-primary/15">
              <Scissors className="h-5 w-5" aria-hidden="true" />
            </span>
          </SalonLogoLightbox>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{salon.name}</p>
            <p className="text-[11px] text-white/65">Agendamento online</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/book/${salonSlug}/login${authQuery}`}
            className="inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-white/75 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Entrar
          </Link>
          <Link
            href={`/book/${salonSlug}/cadastro${authQuery}`}
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Criar conta
          </Link>
        </div>
      </header>

      <div className="flex flex-1 flex-col justify-end px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-20 sm:px-8">
        <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-primary/40 bg-black/35 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary backdrop-blur">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Acesso do cliente
        </span>
        <h1 className="max-w-[19rem] font-display text-[clamp(2rem,9vw,3.25rem)] leading-[1.05] tracking-tight text-white">
          Seu próximo horário começa aqui
        </h1>
        <p className="mt-4 max-w-[22rem] text-sm leading-relaxed text-white/75">
          Entre na sua conta ou crie um cadastro para agendar e acompanhar seus horários em {salon.name}.
        </p>

        <div className="mt-7 grid grid-cols-3 gap-2" aria-label="Benefícios da sua conta">
          {benefits.map(({ icon: Icon, label, text }) => (
            <div
              key={label}
              className="min-w-0 rounded-2xl border border-white/15 bg-black/30 p-3 backdrop-blur"
            >
              <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
              <p className="mt-2 truncate text-[11px] font-semibold text-white">{label}</p>
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-white/60">{text}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3">
          <Link
            href={`/book/${salonSlug}/login${authQuery}`}
            className="flex min-h-14 items-center justify-between rounded-full bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-2xl shadow-primary/30 transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Entrar na minha conta
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary-foreground text-primary">
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </span>
          </Link>
          <Link
            href={`/book/${salonSlug}/cadastro${authQuery}`}
            className="flex min-h-14 items-center justify-center rounded-full border border-white/20 bg-black/25 px-6 py-4 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Criar uma conta
          </Link>
        </div>

        <PwaInstallCard salonName={salon.name} storageKey={salonSlug} className="mt-4" />
      </div>
    </div>
  );
}
