import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, MoreHorizontal } from "lucide-react";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { HERO_IMAGES, normalizeImageUrl } from "@/lib/images";
import { SEGMENTS } from "@/lib/segments";

/**
 * Splash / onboarding — hero full-bleed com foto do salão, overlay dark +
 * tint verde, e CTA. Não é linkada de nenhum outro lugar do app hoje.
 */
export default async function WelcomePage({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  const salon = await withSalonBySlug(salonSlug, (tx, salonId) =>
    tx.salon.findUnique({
      where: { id: salonId },
      select: { name: true, address: true, coverUrl: true, segment: true },
    }),
  );
  if (!salon) notFound();

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

      <header className="flex items-center justify-between px-6 pt-6 text-xs text-muted-foreground">
        <span className="font-mono">•••</span>
        <Link
          href={`/book/${salonSlug}`}
          className="flex items-center gap-1 text-primary"
        >
          Pular <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      <div className="flex flex-1 flex-col justify-end px-8 pb-16 pt-24">
        <span className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-primary backdrop-blur">
          <MoreHorizontal className="h-3 w-3" /> Agendamento online
        </span>
        <h1 className="font-display text-4xl uppercase leading-tight tracking-tight">
          {salon.name.toUpperCase()}
        </h1>
        <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
          Se pra você isso é ritual, não rotina — te esperamos.
          {salon.address ? ` ${salon.address}.` : ""}
        </p>

        <Link
          href={`/book/${salonSlug}`}
          className="mt-10 flex items-center justify-between rounded-full bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-2xl shadow-primary/30 transition hover:scale-[1.01]"
        >
          Vamos lá
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary-foreground text-primary">
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </span>
        </Link>
      </div>
    </div>
  );
}
