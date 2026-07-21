import { notFound } from "next/navigation";
import Link from "next/link";
import { Bell, MapPin, ArrowUpRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { BottomNav } from "./bottom-nav";
import { CartBadge } from "./cart-badge";
import { HomeExplore } from "./home-explore";

export default async function ClientHome({
  params,
}: {
  params: { salonSlug: string };
}) {
  const salon = await prisma.salon.findUnique({
    where: { slug: params.salonSlug },
    select: {
      id: true,
      name: true,
      address: true,
      currency: true,
      services: {
        where: { active: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          priceCents: true,
          durationMin: true,
        },
      },
    },
  });
  if (!salon) notFound();

  const initials = salon.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <main className="animate-fade-in space-y-6 px-5 pt-6">
      {/* Top bar */}
      <header className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
          {initials}
        </div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Onde</p>
          <p className="flex items-center gap-1 text-sm font-medium">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            {salon.address ?? "Endereço não informado"}
          </p>
        </div>
        <CartBadge salonSlug={params.salonSlug} />
        <button
          aria-label="Notificações"
          className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-muted-foreground"
        >
          <Bell className="h-4 w-4" />
        </button>
      </header>

      {/* Promo card */}
      <Link
        href={`/book/${params.salonSlug}/agendar`}
        className="block overflow-hidden rounded-3xl bg-primary p-6 text-primary-foreground shadow-lg"
      >
        <span className="inline-block rounded-full bg-primary-foreground/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wide">
          Oferta especial
        </span>
        <h2 className="mt-3 font-display text-2xl leading-tight">
          Primeira vez?
          <br />
          <span className="font-semibold">30% de desconto</span>
        </h2>
        <div className="mt-4 flex w-fit items-center gap-2 rounded-full bg-primary-foreground px-4 py-2 text-sm font-semibold text-primary">
          Agendar agora
          <ArrowUpRight className="h-4 w-4" />
        </div>
      </Link>

      {/* Busca + categorias + grid (interativo) */}
      <HomeExplore
        salonSlug={params.salonSlug}
        currency={salon.currency}
        services={salon.services}
      />

      <BottomNav salonSlug={params.salonSlug} />
    </main>
  );
}
