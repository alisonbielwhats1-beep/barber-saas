import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  MapPin,
  ArrowUpRight,
  Sparkles,
  Clock,
  MessageCircle,
  Phone,
  UserRound,
  ShieldCheck,
  ChevronRight,
  Instagram,
  CreditCard,
  ExternalLink,
  Globe2,
  Info,
  type LucideIcon,
} from "lucide-react";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { HERO_IMAGES, normalizeImageUrl, resolvePortfolioImage, resolveProductImage } from "@/lib/images";
import { isValidPhoneBR, normalizePhone, formatPhoneBR } from "@/lib/phone";
import { getSegment, isSegmentId } from "@/lib/segments";
import { getPublicReviewData } from "@/lib/reviews";
import { formatMoney } from "@/lib/utils";
import { ClientNotificationLink } from "./client-shell";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { CartBadge } from "./cart-badge";
import { HomeExplore } from "./home-explore";
import { ReviewsSection } from "./reviews-section";
import { SalonLogoLightbox } from "./salon-logo-lightbox";
import { PwaInstallCard } from "@/components/pwa-install-card";

// Capa determinística por salão — mesmo salão, mesma foto
function heroForSalon(slug: string) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 997;
  return HERO_IMAGES[h % HERO_IMAGES.length];
}

const PAYMENT_LABELS: Record<string, string> = {
  PIX: "Pix",
  CASH: "Dinheiro",
  CREDIT_CARD: "Crédito",
  DEBIT_CARD: "Débito",
  TRANSFER: "Transferência",
};

function formatHours(openMinutes: number, closeMinutes: number) {
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${fmt(openMinutes)} às ${fmt(closeMinutes)}`;
}

function normalizeInstagramHandle(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const fromUrl = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/i,
  )?.[1];
  const handle = (fromUrl ?? trimmed).replace(/^@/, "");
  return /^[a-z0-9._]{1,30}$/i.test(handle) ? handle : null;
}

function normalizeExternalUrl(value: string): string | null {
  try {
    const parsed = new URL(value.replace(/[),.;!?]+$/g, ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function compactExternalLabel(value: string): string {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname.replace(/\/+$/g, "");
    return `${host}${path && path !== "/" ? path : ""}`;
  } catch {
    return value;
  }
}

function extractPublicLinks(value: string | null): {
  siteUrl: string | null;
  blogUrl: string | null;
  importantText: string;
} {
  const raw = value ?? "";
  const urls = Array.from(
    new Set(
      (raw.match(/https?:\/\/[^\s|]+/gi) ?? [])
        .map(normalizeExternalUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  );
  const blogUrl = urls.find((url) => {
    try {
      return /\/blog(?:\/|$)/i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }) ?? null;
  const siteUrl = urls.find((url) => url !== blogUrl) ?? null;
  const importantText = raw
    .replace(/https?:\/\/[^\s|]+/gi, "")
    .replace(/\b(?:site|blog|instagram(?:\s+dos\s+responsáveis?)?)\s*:\s*/gi, "")
    .replace(/[|•]+/g, " ")
    .replace(/(?:^|\s)(?:e|ou)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { siteUrl, blogUrl, importantText };
}

function QuickContact({
  href,
  icon: Icon,
  label,
  value,
  external = false,
  className = "",
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  external?: boolean;
  className?: string;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      title={value}
      className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-2xl border border-border bg-card px-3 text-left transition-colors hover:border-primary/40 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="grid min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="max-w-[10rem] truncate text-[11px] font-medium text-foreground">
          {value}
        </span>
      </span>
      {external && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </a>
  );
}

export default async function ClientHome({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  const clientSession = await getClientSession();
  if (!clientSession) {
    const returnTo = `/book/${salonSlug}`;
    redirect(`/book/${salonSlug}/welcome?returnTo=${encodeURIComponent(returnTo)}`);
  }
  const salon = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    const salonData = await tx.salon.findUnique({
      where: { id: salonId },
      select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      currency: true,
      openMinutes: true,
      closeMinutes: true,
      cancelPolicyHours: true,
      // Personalização do dono (colunas de 004_salon_customization.sql)
      segment: true,
      description: true,
      coverUrl: true,
      logoUrl: true,
      instagram: true,
      whatsapp: true,
      paymentMethods: true,
      importantInfo: true,
      services: {
        where: { active: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          priceCents: true,
          durationMin: true,
          category: true,
          imageUrl: true,
        },
      },
      professionals: {
        where: { active: true },
        select: { id: true, bio: true, colorHex: true, user: { select: { name: true, avatarUrl: true } } },
      },
      portfolio: {
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, imageUrl: true, caption: true },
      },
      products: {
        where: { active: true },
        orderBy: { name: "asc" },
        take: 4,
        select: { id: true, name: true, category: true, priceCents: true, imageUrl: true },
      },
      },
    });
    if (!salonData) return null;
    const effectiveSession = clientSession?.salonId === salonId
      ? await resolveClientSessionInTenant(tx, clientSession, salonId)
      : null;
    const pendingProposalCount = effectiveSession
      ? await tx.rescheduleProposal.count({
          where: {
            salonId,
            status: "PENDING",
            appointment: { clientId: effectiveSession.clientId },
          },
        })
      : 0;
    return {
      ...salonData,
      hasValidClientSession: Boolean(effectiveSession),
      pendingProposalCount,
      reviewData: await getPublicReviewData(tx, salonId, 3),
    };
  });
  if (!salon) notFound();
  if (!salon.hasValidClientSession) {
    const returnTo = `/book/${salonSlug}`;
    redirect(`/book/${salonSlug}/welcome?returnTo=${encodeURIComponent(returnTo)}`);
  }

  // WhatsApp próprio tem precedência sobre o telefone geral do salão.
  const whatsappNumber = salon.whatsapp || salon.phone;
  const whatsappDigits = whatsappNumber ? normalizePhone(whatsappNumber) : "";
  const whatsappHref = whatsappNumber && isValidPhoneBR(whatsappNumber)
    ? `https://wa.me/55${whatsappDigits}`
    : null;
  const phoneDigits = salon.phone ? normalizePhone(salon.phone) : "";
  const phoneHref = salon.phone && isValidPhoneBR(salon.phone) ? `tel:+55${phoneDigits}` : null;
  const instagramHandle = normalizeInstagramHandle(salon.instagram);
  const { siteUrl, blogUrl, importantText } = extractPublicLinks(salon.importantInfo);
  // Sem capa própria: usa a imagem do segmento escolhido em Configurações;
  // sem segmento definido, cai no pool determinístico de sempre (mesmo salão,
  // mesma foto, pelo hash do slug — como já era antes desta personalização).
  const segment = isSegmentId(salon.segment) ? getSegment(salon.segment) : null;
  const coverSrc = normalizeImageUrl(salon.coverUrl) || segment?.accentImage || heroForSalon(salonSlug);
  const logoSrc = normalizeImageUrl(salon.logoUrl);
  const services = salon.services.map((service) => ({
    ...service,
    imageUrl: normalizeImageUrl(service.imageUrl),
  }));
  const paymentLabels = (salon.paymentMethods ?? "")
    .split(",")
    .map((m) => PAYMENT_LABELS[m.trim()])
    .filter(Boolean);

  const initials = salon.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <main className="animate-fade-in space-y-6 px-4 pt-5 sm:px-5 sm:pt-6 lg:space-y-8 lg:px-0 lg:pt-8">
      {/* Top bar */}
      <header className="flex items-center gap-3">
        <SalonLogoLightbox
          src={logoSrc}
          alt={`Logo de ${salon.name}`}
          salonName={salon.name}
          thumbnailImageClassName="object-cover object-center"
          className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-primary/35 bg-card p-0 text-xs font-bold text-primary shadow-sm"
        >
          <span className="grid h-full w-full place-items-center rounded-full bg-primary/15">
            {initials}
          </span>
        </SalonLogoLightbox>
        <div className="min-w-0 flex-1">
          <p className="truncate whitespace-nowrap text-[11px] uppercase tracking-wide text-muted-foreground">Bem-vindo</p>
          <p className="truncate text-sm font-semibold">{salon.name}</p>
        </div>
        <CartBadge salonSlug={salonSlug} />
        <ClientNotificationLink salonSlug={salonSlug} />
        {salon.hasValidClientSession ? (
          <Link
            href={`/book/${salonSlug}/minhas`}
            aria-label="Minha conta"
            title="Minha conta"
            className="inline-flex min-h-11 w-11 items-center justify-center rounded-full border border-border text-primary sm:h-auto sm:w-auto sm:gap-1 sm:px-3"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            <span className="hidden text-[11px] font-semibold sm:inline">Minha conta</span>
          </Link>
        ) : (
          <div className="flex items-center gap-1">
            <Link
              href={`/book/${salonSlug}/login`}
              className="inline-flex min-h-11 items-center rounded-full px-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Entrar
            </Link>
            <Link
              href={`/book/${salonSlug}/cadastro`}
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
            >
              Criar conta
            </Link>
          </div>
        )}
      </header>

      {salon.pendingProposalCount > 0 && salon.hasValidClientSession && (
        <Link
          href={`/book/${salonSlug}/minhas`}
          className="block rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
        >
          <span className="font-semibold">Você tem uma alteração de horário aguardando resposta.</span>
          <span className="mt-1 block text-xs">Abra suas reservas para aceitar ou recusar.</span>
        </Link>
      )}

      <PwaInstallCard salonName={salon.name} storageKey={salonSlug} compact />

      {/* Hero — capa do salão */}
      <div className="relative h-48 overflow-hidden rounded-3xl sm:h-56 lg:h-72">
        <Image
          src={coverSrc}
          alt={salon.name}
          fill
          priority
          quality={95}
          sizes="(max-width: 640px) calc(100vw - 2rem), (max-width: 1024px) calc(100vw - 3rem), 1088px"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5">
          {/* Badge de segmento — dado real escolhido pelo dono, no lugar do
              rótulo genérico que havia antes. Sem segmento definido, mantém
              o texto anterior; não some nada para quem não personalizou. */}
          <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
            {segment ? <segment.icon className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
            {segment ? segment.shortLabel : "Experiência premium"}
          </span>
          <h1 className="font-display text-2xl leading-tight text-white">{salon.name}</h1>
        </div>
      </div>

      {/* Reputação visível antes da escolha do serviço — avaliações verificadas. */}
      <ReviewsSection
        salonSlug={salonSlug}
        summary={salon.reviewData.summary}
        reviews={salon.reviewData.reviews}
      />

      {/* CTA de agendamento */}
      <Link
        href={`/book/${salonSlug}/agendar`}
        className="block overflow-hidden rounded-3xl bg-primary p-6 text-primary-foreground shadow-lg"
      >
        <h2 className="font-display text-2xl leading-tight">Agendar um horário</h2>
        <p className="mt-1 text-sm text-primary-foreground/80">
          Escolha o serviço e veja os horários disponíveis agora.
        </p>
        <div className="mt-4 flex w-fit items-center gap-2 rounded-full bg-primary-foreground px-4 py-2 text-sm font-semibold text-primary">
          Agendar agora
          <ArrowUpRight className="h-4 w-4" />
        </div>
      </Link>

      {(whatsappHref || phoneHref || instagramHandle || siteUrl || blogUrl) && (
        <section aria-labelledby="contact-title" className="rounded-3xl border border-border bg-card p-4">
          <div className="mb-3">
            <p id="contact-title" className="text-sm font-semibold">Fale com o Studio</p>
            <p className="mt-1 text-xs text-muted-foreground">Canais oficiais do salão</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {whatsappHref && (
              <QuickContact
                href={whatsappHref}
                icon={MessageCircle}
                label="WhatsApp"
                value={formatPhoneBR(whatsappNumber ?? "")}
                external
                className="w-full min-w-0"
              />
            )}
            {phoneHref && (
              <QuickContact
                href={phoneHref}
                icon={Phone}
                label="Ligar"
                value={formatPhoneBR(salon.phone ?? "")}
                className="w-full min-w-0"
              />
            )}
            {instagramHandle && (
              <QuickContact
                href={`https://instagram.com/${instagramHandle}`}
                icon={Instagram}
                label="Instagram"
                value={`@${instagramHandle}`}
                external
                className="w-full min-w-0"
              />
            )}
            {siteUrl && (
              <QuickContact
                href={siteUrl}
                icon={Globe2}
                label="Site"
                value={compactExternalLabel(siteUrl)}
                external
                className="w-full min-w-0"
              />
            )}
            {blogUrl && (
              <QuickContact
                href={blogUrl}
                icon={ExternalLink}
                label="Conteúdo"
                value={compactExternalLabel(blogUrl)}
                external
                className="w-full min-w-0"
              />
            )}
          </div>
        </section>
      )}

      {/* Apresentação escrita pelo dono */}
      {salon.description && (
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          {salon.description}
        </p>
      )}

      {/* Informações — só dados que existem de verdade no cadastro do salão */}
      <div className="grid grid-cols-1 gap-2.5 rounded-3xl border border-border bg-card p-4 text-[13px] sm:grid-cols-2">
        {salon.address && (
          <div className="flex items-start gap-2.5 text-muted-foreground sm:col-span-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{salon.address}</span>
          </div>
        )}
        <div className="flex items-center gap-2.5 text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0 text-primary" />
          Aberto das {formatHours(salon.openMinutes, salon.closeMinutes)}
        </div>
        <div className="flex items-center gap-2.5 text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          Cancelamento com {salon.cancelPolicyHours}h de antecedência
        </div>
        {paymentLabels.length > 0 && (
          <div className="flex items-start gap-2.5 text-muted-foreground sm:col-span-2">
            <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Aceita {paymentLabels.join(" · ")}
          </div>
        )}
        {importantText && (
          <div className="flex items-start gap-2.5 text-muted-foreground sm:col-span-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {importantText}
          </div>
        )}
      </div>

      {/* Equipe — só profissionais ativos, sem dado inventado */}
      {salon.professionals.length > 0 && (
        <section>
          <p className="mb-3 text-sm font-semibold text-muted-foreground">Nossa equipe</p>
          <div className="scrollbar-dark flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">
            {salon.professionals.map((p) => {
              const initials = (p.user.name || "?")
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase();
              return (
                <div
                  key={p.id}
                  className="w-32 shrink-0 rounded-2xl border border-border bg-card p-3 text-center lg:w-auto"
                >
                  {p.user.avatarUrl ? (
                    <Image
                      src={p.user.avatarUrl}
                      alt={`Foto de ${p.user.name}`}
                      width={96}
                      height={96}
                      sizes="48px"
                      quality={95}
                      className="mx-auto h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="mx-auto grid h-12 w-12 place-items-center rounded-full text-sm font-semibold text-white"
                      style={{ backgroundColor: p.colorHex ?? "hsl(var(--primary))" }}
                    >
                      {initials}
                    </div>
                  )}
                  <p className="mt-2 truncate text-[12px] font-medium">{p.user.name}</p>
                  {p.bio && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{p.bio}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Busca + categorias + grid (interativo) */}
      <HomeExplore
        salonSlug={salonSlug}
        currency={salon.currency}
        services={services}
      />

      {/* Teaser de portfólio */}
      {salon.portfolio.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">Portfólio</p>
            <Link
              href={`/book/${salonSlug}/portfolio`}
              className="flex items-center gap-0.5 text-xs font-medium text-primary"
            >
              Ver tudo <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {salon.portfolio.slice(0, 6).map((item, index) => (
              <Link
                key={item.id}
                href={`/book/${salonSlug}/portfolio`}
                className="relative aspect-square overflow-hidden rounded-xl"
              >
                <Image
                  src={resolvePortfolioImage(item.imageUrl, index)}
                  alt={item.caption ?? "Trabalho do portfólio"}
                  fill
                  sizes="(max-width: 640px) 30vw, (max-width: 1024px) 22vw, 180px"
                  className="object-cover"
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Teaser de produtos */}
      {salon.products.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">Produtos</p>
            <Link
              href={`/book/${salonSlug}/produtos`}
              className="flex items-center gap-0.5 text-xs font-medium text-primary"
            >
              Ver loja <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="scrollbar-dark flex gap-3 overflow-x-auto pb-1">
            {salon.products.map((p, i) => (
              <Link
                key={p.id}
                href={`/book/${salonSlug}/produtos`}
                className="w-28 shrink-0 overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="relative aspect-square w-full">
                  <Image
                    src={resolveProductImage({
                      imageUrl: p.imageUrl,
                      name: p.name,
                      category: p.category,
                      index: i,
                    })}
                    alt={p.name}
                    fill
                    sizes="112px"
                    className="object-cover"
                  />
                </div>
                <div className="p-2">
                  <p className="truncate text-[11px] font-medium">{p.name}</p>
                  <p className="text-[11px] font-semibold text-primary">
                    {formatMoney(p.priceCents, salon.currency)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

    </main>
  );
}
