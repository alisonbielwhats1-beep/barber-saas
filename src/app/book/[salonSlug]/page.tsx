import { WaitlistOffers } from "./waitlist-offers";
import { readableForeground } from "@/lib/color";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Clock,
  MessageCircle,
  Phone,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Instagram,
  CreditCard,
  ExternalLink,
  Globe2,
  Info,
  MapPin,
  Star,
  type LucideIcon,
} from "lucide-react";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { HERO_IMAGES, PORTFOLIO_POOL, normalizeImageUrl, resolvePortfolioImage } from "@/lib/images";
import { isValidPhoneBR, normalizePhone, formatPhoneBR } from "@/lib/phone";
import { getSegment, isSegmentId } from "@/lib/segments";
import { getPublicReviewData } from "@/lib/reviews";
import { formatDuration, formatMoney } from "@/lib/utils";
import { servicePriceLabel } from "@/lib/service-price";
import { ServicePriceNote } from "@/components/service-price";
import { ClientNotificationLink } from "./client-shell";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { CartBadge } from "./cart-badge";
import { UsualBooking } from "./usual-booking";
import { HomeTabs, type HomeTab } from "./home-tabs";
import { ReviewsSection } from "./reviews-section";
import { BrandLogo } from "@/components/brand";
import { SalonLocationLink } from "./salon-location-link";
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

function QuickContact({
  href,
  icon: Icon,
  label,
  value,
  channel,
  external = false,
  className = "",
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  channel: "whatsapp" | "instagram" | "phone" | "website" | "content";
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
      <span className="client-contact-icon" data-channel={channel}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
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

type HomeService = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  priceType: string;
  priceNote: string | null;
  durationMin: number;
  category: string | null;
};

function initialsOf(name: string | null | undefined) {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Categorias fechadas por padrão: o cliente vê o cardápio inteiro sem rolar
// e abre só o que interessa. Os serviços ficam no HTML (<details>), então a
// busca do navegador e os leitores de tela continuam encontrando tudo.
function ServiceCategories({
  salonSlug,
  currency,
  services,
}: {
  salonSlug: string;
  currency: string;
  services: HomeService[];
}) {
  if (services.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Este salão ainda não publicou serviços.
      </div>
    );
  }
  const groups = new Map<string, HomeService[]>();
  for (const service of services) {
    const category = service.category ?? "Outros";
    groups.set(category, [...(groups.get(category) ?? []), service]);
  }
  const single = groups.size === 1;
  return (
    <div className="space-y-2.5">
      {[...groups].map(([category, items]) => {
        const from = Math.min(...items.map((s) => s.priceCents));
        return (
          <details key={category} open={single} className="client-service-group group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[15px] font-semibold">{category}</span>
                <span className="block text-xs text-muted-foreground">
                  {items.length} {items.length === 1 ? "serviço" : "serviços"} · a partir de {formatMoney(from, currency)}
                </span>
              </span>
              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-border">
              {items.map((s) => (
                <Link
                  key={s.id}
                  href={`/book/${salonSlug}/agendar?service=${s.id}`}
                  className="flex items-center gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium">{s.name}</span>
                    {s.description && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{s.description}</span>
                    )}
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatDuration(s.durationMin)} · <span className="font-semibold text-foreground">{servicePriceLabel(s, currency)}</span>
                    </span>
                    <ServicePriceNote service={s} />
                  </span>
                  <span className="client-service-book">Agendar</span>
                </Link>
              ))}
            </div>
          </details>
        );
      })}
    </div>
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
      cancelPolicyHours: true,
      // Personalização do dono (colunas de 004_salon_customization.sql)
      segment: true,
      description: true,
      coverUrl: true,
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
        },
      },
      professionals: {
        where: { active: true },
        select: { id: true, colorHex: true, user: { select: { name: true, avatarUrl: true } } },
      },
      portfolio: {
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, imageUrl: true, caption: true },
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
      clientName: effectiveSession?.name ?? null,
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
  // mesma foto, pelo hash do slug).
  const segment = isSegmentId(salon.segment) ? getSegment(salon.segment) : null;
  const coverFallback = segment?.accentImage || heroForSalon(salonSlug);
  const coverSrc = normalizeImageUrl(salon.coverUrl) || coverFallback;
  const paymentLabels = (salon.paymentMethods ?? "")
    .split(",")
    .map((m) => PAYMENT_LABELS[m.trim()])
    .filter(Boolean);
  const firstName = salon.clientName?.trim().split(/\s+/)[0] ?? null;
  const reviewSummary = salon.reviewData.summary;
  const hasContacts = Boolean(whatsappHref || phoneHref || instagramHandle || siteUrl || blogUrl);

  const tabs: HomeTab[] = [
    {
      id: "servicos",
      label: "Serviços",
      content: <ServiceCategories salonSlug={salonSlug} currency={salon.currency} services={salon.services} />,
    },
    {
      id: "avaliacoes",
      label: "Avaliações",
      content: (
        <ReviewsSection
          salonSlug={salonSlug}
          summary={reviewSummary}
          reviews={salon.reviewData.reviews}
        />
      ),
    },
  ];
  if (salon.portfolio.length > 0) {
    tabs.push({
      id: "portfolio",
      label: "Portfólio",
      content: (
        <section aria-label="Portfólio">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {salon.portfolio.map((item, index) => (
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
          <Link
            href={`/book/${salonSlug}/portfolio`}
            className="mt-3 inline-flex min-h-11 items-center gap-0.5 text-xs font-semibold text-primary"
          >
            Ver portfólio completo <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </section>
      ),
    });
  }
  tabs.push({
    id: "sobre",
    label: "Sobre",
    content: (
      <div className="space-y-4">
        {hasContacts && (
          <section id="contato" aria-labelledby="contact-title">
            <p id="contact-title" className="mb-2 text-sm font-semibold">Fale com o Studio</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {whatsappHref && (
                <QuickContact href={whatsappHref} icon={MessageCircle} label="WhatsApp" channel="whatsapp"
                  value={formatPhoneBR(whatsappNumber ?? "")} external className="w-full min-w-0" />
              )}
              {phoneHref && (
                <QuickContact href={phoneHref} icon={Phone} label="Ligar" channel="phone"
                  value={formatPhoneBR(salon.phone ?? "")} className="w-full min-w-0" />
              )}
              {instagramHandle && (
                <QuickContact href={`https://instagram.com/${instagramHandle}`} icon={Instagram} label="Instagram"
                  channel="instagram" value={`@${instagramHandle}`} external className="w-full min-w-0" />
              )}
              {siteUrl && (
                <QuickContact href={siteUrl} icon={Globe2} label="Site" channel="website"
                  value={compactExternalLabel(siteUrl)} external className="w-full min-w-0" />
              )}
              {blogUrl && (
                <QuickContact href={blogUrl} icon={ExternalLink} label="Conteúdo" channel="content"
                  value={compactExternalLabel(blogUrl)} external className="w-full min-w-0" />
              )}
            </div>
          </section>
        )}

        {salon.description && (
          <p className="text-[14px] leading-relaxed text-muted-foreground">{salon.description}</p>
        )}

        {/* Informações — só dados que existem de verdade no cadastro do salão */}
        <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-border bg-card p-4 text-[13px] sm:grid-cols-2">
          <SalonLocationLink address={salon.address} className="sm:col-span-2" />
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <Clock className="client-hours-icon h-4 w-4 shrink-0" />
            Aberto das {formatHours(salon.openMinutes, salon.closeMinutes)}
          </div>
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
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
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {importantText}
            </div>
          )}
        </div>

      </div>
    ),
  });

  return (
    <main className="animate-fade-in space-y-5 px-4 pt-3 sm:px-5 sm:pt-4 lg:space-y-6 lg:px-0 lg:pt-6">
      {/* Topo: marca à esquerda, atalhos à direita */}
      <header className="client-home-header">
        <BrandLogo className="client-brand-logo" />
        <div className="client-home-actions">
          {salon.hasValidClientSession ? (
            <>
              <CartBadge salonSlug={salonSlug} hideWhenEmpty />
              <ClientNotificationLink salonSlug={salonSlug} />
              <Link
                href={`/book/${salonSlug}/minhas`}
                aria-label="Minha conta"
                title="Minha conta"
                className="client-account-avatar"
              >
                {initialsOf(salon.clientName)}
              </Link>
            </>
          ) : (
            <CartBadge salonSlug={salonSlug} />
          )}
        </div>
      </header>

      {/* Nome em linha própria, com os fatos que ajudam a decidir */}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">
          {firstName ? `Olá, ${firstName}! Que bom te ver de novo` : "Olá! Boas-vindas ao"}
        </p>
        <h1 className="mt-0.5 break-words text-xl font-semibold leading-snug">{salon.name}</h1>
        <div className="client-home-facts">
          {reviewSummary.count > 0 && (
            <a href="#avaliacoes">
              <Star aria-hidden="true" className="h-3.5 w-3.5 text-warning" fill="currentColor" />
              <span className="font-semibold text-foreground">{reviewSummary.average.toFixed(1).replace(".", ",")}</span>
              ({reviewSummary.count})
              <span className="sr-only"> — ver avaliações</span>
            </a>
          )}
          <span>
            <Clock aria-hidden="true" className="h-3.5 w-3.5" />
            {formatHours(salon.openMinutes, salon.closeMinutes).replace(" às ", "–")}
          </span>
          {salon.address?.trim() && (
            <a href="#sobre">
              <MapPin aria-hidden="true" className="client-location-icon h-3.5 w-3.5" />
              <span className="font-semibold text-foreground">Ver endereço</span>
            </a>
          )}
        </div>
        {!salon.hasValidClientSession && (
          <p className="-mb-2 text-[13px] text-muted-foreground">
            Já é cliente?{" "}
            <Link href={`/book/${salonSlug}/login`} className="client-inline-link">Entrar</Link>
            {" · "}
            <Link href={`/book/${salonSlug}/cadastro`} className="client-inline-link">Criar conta</Link>
          </p>
        )}
      </div>

      {salon.hasValidClientSession && <UsualBooking salonSlug={salonSlug} />}

      {salon.pendingProposalCount > 0 && salon.hasValidClientSession && (
        <Link
          href={`/book/${salonSlug}/minhas`}
          className="block rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
        >
          <span className="font-semibold">Você tem uma alteração de horário aguardando resposta.</span>
          <span className="mt-1 block text-xs">Abra suas reservas para aceitar ou recusar.</span>
        </Link>
      )}

      <WaitlistOffers salonSlug={salonSlug} />

      {salon.hasValidClientSession && <PushPermissionCard salonSlug={salonSlug} placement="home" />}

      {/* Capa inteira (3:2) e, logo abaixo, a ação principal — nada sobre a foto */}
      <section aria-label="Agendamento" className="client-booking-card">
        <div className="relative aspect-[3/2] w-full lg:aspect-[21/9]">
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
        </div>
        <Link
          href={`/book/${salonSlug}/agendar`}
          className="client-booking-cta flex items-center gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-semibold leading-tight">Agendar um horário</span>
            <span className="mt-0.5 block text-xs opacity-90">Escolha o serviço e veja os horários disponíveis.</span>
          </span>
          <span className="client-booking-cta-action inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold">
            Agendar <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </span>
        </Link>
      </section>

      {/* Equipe — só profissionais ativos, sem dado inventado */}
      {salon.professionals.length > 0 && (
        <section aria-labelledby="team-title">
          <h2 id="team-title" className="mb-2.5 text-sm font-semibold">Nossa equipe</h2>
          <ul className="scrollbar-dark -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {salon.professionals.map((p) => {
              const avatar = normalizeImageUrl(p.user.avatarUrl);
              const style = {
                backgroundColor: p.colorHex ?? "hsl(var(--primary))",
                color: p.colorHex ? `hsl(${readableForeground(p.colorHex) ?? "0 0% 0%"})` : "hsl(var(--primary-foreground))",
              };
              const initials = (
                <span role="img" aria-label={`Iniciais de ${p.user.name}`} className="client-team-avatar grid place-items-center text-sm font-semibold" style={style}>
                  {initialsOf(p.user.name)}
                </span>
              );
              return (
                <li key={p.id} className="w-16 shrink-0 text-center">
                  {avatar ? (
                    <ImageWithFallback
                      src={avatar}
                      alt={`Foto de ${p.user.name}`}
                      width={112}
                      height={112}
                      sizes="56px"
                      quality={95}
                      className="client-team-avatar block object-cover"
                      fallback={initials}
                    />
                  ) : initials}
                  <p className="mt-1.5 truncate text-[11px] font-medium" title={p.user.name}>
                    {p.user.name.trim().split(/\s+/)[0]}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <HomeTabs tabs={tabs} />
    </main>
  );
}
