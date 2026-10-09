import { WaitlistOffers } from "./waitlist-offers";
import { readableForeground } from "@/lib/color";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight,
  Sparkles,
  Clock,
  Phone,
  UserRound,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Instagram,
  CreditCard,
  Info,
  Link2,
  MapPin,
  Star,
} from "lucide-react";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { HERO_IMAGES, PORTFOLIO_POOL, imageForProduct, normalizeImageUrl, resolvePortfolioImage, resolveProductImage } from "@/lib/images";
import { isValidPhoneBR, normalizePhone, formatPhoneBR } from "@/lib/phone";
import { getSegment, isSegmentId } from "@/lib/segments";
import { getPublicReviewData } from "@/lib/reviews";
import { formatMoney } from "@/lib/utils";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { CartBadge } from "./cart-badge";
import { UsualBooking } from "./usual-booking";
import { HomeExplore } from "./home-explore";
import { ReviewsSection } from "./reviews-section";
import { BrandLogo } from "@/components/brand";
import { OpenNowBadge } from "./open-now-badge";
import { PwaInstallCard } from "@/components/pwa-install-card";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { PushPermissionCard } from "./notificacoes/push-permission-card";

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

/** Símbolo do WhatsApp (lucide não tem marcas); segue a cor do botão. */
function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z" />
    </svg>
  );
}

export default async function ClientHome({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  const clientSession = await getClientSession();
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
      timezone: true,
      cancelPolicyHours: true,
      // Personalização do dono (colunas de 004_salon_customization.sql)
      segment: true,
      description: true,
      coverUrl: true,
      coverShowName: true,
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
          priceCents: true, priceType: true, priceNote: true,
          durationMin: true,
          category: true,
          imageUrl: true,
        },
      },
      professionals: {
        where: { active: true },
        select: {
          id: true, bio: true, colorHex: true, user: { select: { name: true, avatarUrl: true } },
          workingHours: { select: { weekday: true, startMinutes: true, endMinutes: true } },
        },
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
  const coverFallback = segment?.accentImage || heroForSalon(salonSlug);
  const coverSrc = normalizeImageUrl(salon.coverUrl) || coverFallback;
  // Capa própria que já traz o nome: o título continua disponível a leitores
  // de tela, mas some visualmente junto com o selo e o degradê de contraste.
  const coverNameVisible = !normalizeImageUrl(salon.coverUrl) || salon.coverShowName;
  const services = salon.services.map((service) => ({
    ...service,
    imageUrl: normalizeImageUrl(service.imageUrl),
  }));
  const paymentLabels = (salon.paymentMethods ?? "")
    .split(",")
    .map((m) => PAYMENT_LABELS[m.trim()])
    .filter(Boolean);

  const headerSiteUrl = siteUrl ?? blogUrl;
  // Expediente semanal da equipe ativa, para "Aberto agora" respeitar folgas e pausas.
  const weeklyHours = salon.professionals.flatMap((professional) => professional.workingHours);
  const reviewSummary = salon.reviewData.summary;
  const reviewAverage = reviewSummary.average.toFixed(1).replace(".", ",");
  const address = salon.address?.trim() || null;
  const mapsHref = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;

  return (
    <main className="animate-fade-in space-y-4 px-4 pt-2.5 sm:space-y-6 sm:px-5 sm:pt-6 lg:space-y-8 lg:px-0 lg:pt-8">
      {/* Topo: marca, conta e contatos oficiais do estabelecimento */}
      <header className="client-home-header">
        <BrandLogo className="client-brand-logo" />
        <div className="client-home-actions">
          <CartBadge salonSlug={salonSlug} hideWhenEmpty />
          {salon.hasValidClientSession ? (
            <Link
              href={`/book/${salonSlug}/minhas`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-semibold text-foreground transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <UserRound className="h-4 w-4" aria-hidden="true" />
              Minha conta
            </Link>
          ) : (
            <div className="flex items-center gap-1">
              <Link
                href={`/book/${salonSlug}/login`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
        </div>
        {(whatsappHref || instagramHandle || headerSiteUrl) && (
          <div className="client-header-contacts" role="group" aria-label={`Fale com ${salon.name}`}>
            {whatsappHref && (
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="client-header-contact" data-channel="whatsapp" aria-label="WhatsApp (abre em nova aba)">
                <WhatsAppGlyph />
              </a>
            )}
            {instagramHandle && (
              <a href={`https://instagram.com/${instagramHandle}`} target="_blank" rel="noopener noreferrer" className="client-header-contact" data-channel="instagram" aria-label={`Instagram @${instagramHandle} (abre em nova aba)`}>
                <Instagram className="h-[17px] w-[17px]" aria-hidden="true" />
              </a>
            )}
            {headerSiteUrl && (
              <a href={headerSiteUrl} target="_blank" rel="noopener noreferrer" className="client-header-contact" data-channel="website" aria-label="Site (abre em nova aba)">
                <Link2 className="h-[17px] w-[17px]" aria-hidden="true" />
              </a>
            )}
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

      {/* Lembretes: convite compacto no topo, só quando o aparelho ainda pode ativar */}
      {salon.hasValidClientSession && <PushPermissionCard salonSlug={salonSlug} placement="home" />}

      {/* Hero — capa do salão */}
      <div
        className={`relative flex items-end overflow-hidden rounded-3xl ${
          coverNameVisible
            ? "min-h-[180px] sm:min-h-56 lg:min-h-72 [@media(max-height:700px)]:min-h-[108px]"
            : "aspect-[16/9] max-h-[28rem] w-full"
        }`}
      >
        <ImageWithFallback
          src={coverSrc}
          fallbackSrc={coverFallback}
          alt={salon.name}
          fill
          priority
          quality={95}
          sizes="(max-width: 640px) calc(100vw - 2rem), (max-width: 1024px) calc(100vw - 3rem), 1088px"
          className="object-cover"
        />
        {coverNameVisible && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        )}
        <div className={coverNameVisible ? "relative min-w-0 w-full px-4 py-3.5 sm:p-5" : "sr-only"}>
          {/* Badge de segmento — dado real escolhido pelo dono, no lugar do
              rótulo genérico que havia antes. Sem segmento definido, mantém
              o texto anterior; não some nada para quem não personalizou. */}
          <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-md [@media(max-height:700px)]:hidden">
            {segment ? <segment.icon className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
            {segment ? segment.shortLabel : "Experiência premium"}
          </span>
          <h1 className="break-words font-display text-[22px] leading-tight text-white sm:text-2xl [@media(max-height:700px)]:text-lg">{salon.name}</h1>
        </div>
      </div>

      {/* CTA de agendamento — ação principal da tela */}
      <Link
        href={`/book/${salonSlug}/agendar`}
        className="client-booking-cta block overflow-hidden rounded-3xl px-5 pb-4 pt-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-6"
      >
        <h2 className="font-display text-[22px] leading-tight sm:text-2xl">Agendar um horário</h2>
        <p className="mt-1 text-sm [@media(max-height:700px)]:hidden">
          Escolha o serviço e veja os horários disponíveis agora.
        </p>
        <div className="client-booking-cta-action mt-3.5 flex min-h-11 w-fit items-center gap-2 rounded-full px-[18px] text-[15px] font-semibold">
          Agendar agora
          <ArrowUpRight className="h-4 w-4" />
        </div>
      </Link>

      {/* Equipe logo abaixo da ação principal: escolher com quem agendar */}
      {salon.professionals.length > 0 && (
        <section aria-labelledby="team-title">
          <h2 id="team-title" className="mb-2 text-[15px] font-semibold">Escolha com quem agendar</h2>
          <div role="region" aria-label="Profissionais do estabelecimento" tabIndex={0} className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">
            {salon.professionals.map((p) => {
              const initials = (p.user.name || "?")
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase();
              return (
                <Link
                  key={p.id}
                  href={`/book/${salonSlug}/agendar?pro=${encodeURIComponent(p.id)}`}
                  aria-label={`Agendar com ${p.user.name}`}
                  className="w-28 shrink-0 rounded-2xl border border-border bg-card px-2 py-2.5 text-center transition-transform hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[.97] lg:w-auto"
                >
                  {normalizeImageUrl(p.user.avatarUrl) ? (
                    <ImageWithFallback
                      src={normalizeImageUrl(p.user.avatarUrl)!}
                      alt={`Foto de ${p.user.name}`}
                      width={120}
                      height={120}
                      sizes="60px"
                      quality={95}
                      className="mx-auto h-[60px] w-[60px] rounded-full object-cover [@media(max-height:700px)]:h-12 [@media(max-height:700px)]:w-12"
                      fallback={(
                        <div
                          role="img" aria-label={`Iniciais de ${p.user.name}`}
                          className="mx-auto grid h-[60px] w-[60px] place-items-center rounded-full text-sm font-semibold text-white"
                          style={{ backgroundColor: p.colorHex ?? "hsl(var(--primary))", color: p.colorHex ? `hsl(${readableForeground(p.colorHex) ?? "0 0% 0%"})` : "hsl(var(--primary-foreground))" }}
                        >
                          {initials}
                        </div>
                      )}
                    />
                  ) : (
                    <div
                      className="mx-auto grid h-[60px] w-[60px] place-items-center rounded-full text-sm font-semibold text-white"
                      style={{ backgroundColor: p.colorHex ?? "hsl(var(--primary))", color: p.colorHex ? `hsl(${readableForeground(p.colorHex) ?? "0 0% 0%"})` : "hsl(var(--primary-foreground))" }}
                    >
                      {initials}
                    </div>
                  )}
                  <p className="mt-2 line-clamp-2 text-[13px] font-semibold leading-tight">{p.user.name}</p>
                  {p.bio && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{p.bio}</p>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Avaliação, endereço e horário recolhidos; detalhes ao tocar */}
      <details className="client-info-card group">
        <summary className="client-info-summary">
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
              {reviewSummary.count > 0 ? (
                <>
                  <Star aria-hidden="true" className="h-4 w-4 text-warning" fill="currentColor" />
                  <b className="font-bold">{reviewAverage}</b>
                  <span className="text-[13px] text-muted-foreground">({reviewSummary.count})</span>
                </>
              ) : (
                <>
                  <Clock aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  <span>Aberto das {formatHours(salon.openMinutes, salon.closeMinutes)}</span>
                </>
              )}
              <OpenNowBadge openMinutes={salon.openMinutes} closeMinutes={salon.closeMinutes} timeZone={salon.timezone} weeklyHours={weeklyHours} />
            </span>
            {address && (
              <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground group-open:hidden">
                <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="truncate">{address}</span>
              </span>
            )}
          </span>
          <ChevronDown aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="client-info-body">
          {mapsHref && (
            <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="client-info-row">
              <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 break-words leading-snug">{address}</span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-primary">
                Rotas <ChevronRight aria-hidden="true" className="h-4 w-4" />
                <span className="sr-only"> no Google Maps (abre em nova aba)</span>
              </span>
            </a>
          )}
          <div className="client-info-row">
            <Clock aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">Aberto das {formatHours(salon.openMinutes, salon.closeMinutes)}</span>
          </div>
          {phoneHref && (
            <a href={phoneHref} className="client-info-row">
              <Phone aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">Ligar · {formatPhoneBR(salon.phone ?? "")}</span>
            </a>
          )}
          {siteUrl && blogUrl && (
            <a href={blogUrl} target="_blank" rel="noopener noreferrer" className="client-info-row">
              <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Conteúdo · {compactExternalLabel(blogUrl)}</span>
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          )}
          {reviewSummary.count > 0 && (
            <a href="#avaliacoes" className="client-info-row">
              <Star aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" fill="currentColor" />
              <span className="min-w-0 flex-1">
                Ver {reviewSummary.count === 1 ? "a avaliação" : `as ${reviewSummary.count} avaliações`}
              </span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            </a>
          )}
        </div>
      </details>

      {/* Reputação — avaliações verificadas em carrossel compacto */}
      <ReviewsSection
        salonSlug={salonSlug}
        summary={salon.reviewData.summary}
        reviews={salon.reviewData.reviews}
      />

      <PwaInstallCard salonName={salon.name} storageKey={salonSlug} compact />

      {/* Apresentação escrita pelo dono */}
      {salon.description && (
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          {salon.description}
        </p>
      )}

      {/* Regras do atendimento — só dados que existem de verdade no cadastro */}
      <div className="grid grid-cols-1 gap-2.5 rounded-3xl border border-border bg-card p-4 text-[13px] sm:grid-cols-2">
        <div className="flex items-center gap-2.5 text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
          Cancelamento com {salon.cancelPolicyHours}h de antecedência
        </div>
        {paymentLabels.length > 0 && (
          <div className="flex items-start gap-2.5 text-muted-foreground sm:col-span-2">
            <CreditCard className="client-payment-icon mt-0.5 h-4 w-4 shrink-0" />
            Aceita {paymentLabels.join(" · ")}
          </div>
        )}
        {importantText && (
          <div className="flex items-start gap-2.5 text-muted-foreground sm:col-span-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            {importantText}
          </div>
        )}
      </div>

      {/* Busca + categorias + grid (interativo) */}
      <WaitlistOffers salonSlug={salonSlug} />
      <UsualBooking salonSlug={salonSlug} />
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
                <ImageWithFallback
                  src={resolvePortfolioImage(item.imageUrl, index)}
                  fallbackSrc={PORTFOLIO_POOL[index % PORTFOLIO_POOL.length]}
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
                  <ImageWithFallback
                    src={resolveProductImage({
                      imageUrl: p.imageUrl,
                      name: p.name,
                      category: p.category,
                      index: i,
                    })}
                    fallbackSrc={imageForProduct(i)}
                    alt={p.name}
                    fill
                    sizes="112px"
                    className="object-cover"
                  />
                </div>
                <div className="p-2">
                  <p className="truncate text-[11px] font-medium">{p.name}</p>
                  <p className="text-[11px] font-semibold">
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
