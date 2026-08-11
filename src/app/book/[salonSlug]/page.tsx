import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  MapPin,
  ArrowUpRight,
  Sparkles,
  Clock,
  MessageCircle,
  ShieldCheck,
  ChevronRight,
  Instagram,
  CreditCard,
  Info,
} from "lucide-react";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { HERO_IMAGES, resolveProductImage } from "@/lib/images";
import { normalizePhone, formatPhoneBR } from "@/lib/phone";
import { hexToHslTriple, readableForeground } from "@/lib/color";
import { getSegment, isSegmentId } from "@/lib/segments";
import { formatMoney } from "@/lib/utils";
import { ClientNotificationLink } from "./client-shell";
import { CartBadge } from "./cart-badge";
import { HomeExplore } from "./home-explore";

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

export default async function ClientHome({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  const salon = await withSalonBySlug(salonSlug, (tx, salonId) => tx.salon.findUnique({
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
      themeColorHex: true,
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
        },
      },
      professionals: {
        where: { active: true },
        select: { id: true, bio: true, colorHex: true, user: { select: { name: true } } },
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
  }));
  if (!salon) notFound();

  // WhatsApp próprio tem precedência sobre o telefone geral do salão.
  const whatsappNumber = salon.whatsapp || salon.phone;
  const whatsappHref = whatsappNumber
    ? `https://wa.me/55${normalizePhone(whatsappNumber)}`
    : null;
  // Sem capa própria: usa a imagem do segmento escolhido em Configurações;
  // sem segmento definido, cai no pool determinístico de sempre (mesmo salão,
  // mesma foto, pelo hash do slug — como já era antes desta personalização).
  const segment = isSegmentId(salon.segment) ? getSegment(salon.segment) : null;
  const coverSrc = salon.coverUrl || segment?.accentImage || heroForSalon(salonSlug);
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

  // Cor da marca sobrescreve o verde neon do tema salon-dark. Fica no escopo
  // desta página (CSS variable inline) para não vazar para o painel.
  const brandHsl = hexToHslTriple(salon.themeColorHex);
  const brandStyle = brandHsl
    ? ({
        "--primary": brandHsl,
        "--accent": brandHsl,
        "--ring": brandHsl,
        "--primary-foreground": readableForeground(salon.themeColorHex) ?? "0 0% 100%",
      } as React.CSSProperties)
    : undefined;

  return (
    <main className="animate-fade-in space-y-6 px-5 pt-6" style={brandStyle}>
      {/* Top bar */}
      <header className="flex items-center gap-3">
        <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/20 text-sm font-semibold text-primary">
          {salon.logoUrl ? (
            <Image
              src={salon.logoUrl}
              alt={`Foto de ${salon.name}`}
              fill
              sizes="44px"
              className="object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Bem-vindo a</p>
          <p className="text-sm font-semibold">{salon.name}</p>
        </div>
        <CartBadge salonSlug={salonSlug} />
        <ClientNotificationLink salonSlug={salonSlug} />
      </header>

      {/* Hero — capa do salão */}
      <div className="relative h-48 overflow-hidden rounded-3xl">
        <Image
          src={coverSrc}
          alt={salon.name}
          fill
          priority
          sizes="(max-width: 480px) 92vw, 440px"
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
          <p className="mt-1 flex items-center gap-1 text-xs text-white/80">
            <MapPin className="h-3 w-3 text-primary" />
            {salon.address ?? "Endereço não informado"}
          </p>
        </div>
      </div>

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

      {/* Apresentação escrita pelo dono */}
      {salon.description && (
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          {salon.description}
        </p>
      )}

      {/* Informações — só dados que existem de verdade no cadastro do salão */}
      <div className="grid grid-cols-1 gap-2.5 rounded-3xl border border-border bg-card p-4 text-[13px] sm:grid-cols-2">
        <div className="flex items-center gap-2.5 text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0 text-primary" />
          Aberto das {formatHours(salon.openMinutes, salon.closeMinutes)}
        </div>
        <div className="flex items-center gap-2.5 text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          Cancelamento com {salon.cancelPolicyHours}h de antecedência
        </div>
        {whatsappHref && (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 text-primary"
          >
            <MessageCircle className="h-4 w-4 shrink-0" />
            {formatPhoneBR(whatsappNumber ?? "")} · WhatsApp
          </a>
        )}
        {salon.instagram && (
          <a
            href={`https://instagram.com/${salon.instagram}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 text-primary"
          >
            <Instagram className="h-4 w-4 shrink-0" />@{salon.instagram}
          </a>
        )}
        {paymentLabels.length > 0 && (
          <div className="flex items-start gap-2.5 text-muted-foreground sm:col-span-2">
            <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Aceita {paymentLabels.join(" · ")}
          </div>
        )}
        {salon.importantInfo && (
          <div className="flex items-start gap-2.5 text-muted-foreground sm:col-span-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {salon.importantInfo}
          </div>
        )}
      </div>

      {/* Equipe — só profissionais ativos, sem dado inventado */}
      {salon.professionals.length > 0 && (
        <section>
          <p className="mb-3 text-sm font-semibold text-muted-foreground">Nossa equipe</p>
          <div className="scrollbar-dark flex gap-3 overflow-x-auto pb-1">
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
                  className="w-32 shrink-0 rounded-2xl border border-border bg-card p-3 text-center"
                >
                  <div
                    className="mx-auto grid h-12 w-12 place-items-center rounded-full text-sm font-semibold text-white"
                    style={{ backgroundColor: p.colorHex ?? "hsl(var(--primary))" }}
                  >
                    {initials}
                  </div>
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
        services={salon.services}
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
          <div className="grid grid-cols-3 gap-2">
            {salon.portfolio.slice(0, 6).map((item) => (
              <Link
                key={item.id}
                href={`/book/${salonSlug}/portfolio`}
                className="relative aspect-square overflow-hidden rounded-xl"
              >
                <Image
                  src={item.imageUrl}
                  alt={item.caption ?? "Trabalho do portfólio"}
                  fill
                  sizes="150px"
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
