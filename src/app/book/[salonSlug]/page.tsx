import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Bell, Search, MapPin, ArrowUpRight, Scissors, Droplet, Palette, Wand2, ShoppingBag } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatMoney, formatDuration } from "@/lib/utils";
import { imageForService } from "@/lib/images";
import { BottomNav } from "./bottom-nav";
import { CartBadge } from "./cart-badge";

const CATEGORIES = [
  { key: "todos", label: "Todos", icon: Scissors },
  { key: "corte", label: "Cortes", icon: Scissors },
  { key: "barba", label: "Barba", icon: Wand2 },
  { key: "quente", label: "Hot towel", icon: Droplet },
  { key: "coloracao", label: "Coloração", icon: Palette },
];

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
          colorHex: true,
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

      {/* Search */}
      <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          placeholder="Buscar serviços…"
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          aria-label="Filtros"
          className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground"
        >
          <span className="text-xs leading-none">⇋</span>
        </button>
      </div>

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
        <div className="mt-4 flex items-center gap-2 rounded-full bg-primary-foreground px-4 py-2 text-sm font-semibold text-primary w-fit">
          Agendar agora
          <ArrowUpRight className="h-4 w-4" />
        </div>
      </Link>

      {/* Categories */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Categorias</h3>
        <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((c, i) => {
            const active = i === 0;
            return (
              <button
                key={c.key}
                className={`flex shrink-0 flex-col items-center gap-2 rounded-2xl px-3 py-3 text-xs transition ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
                style={{ minWidth: 76 }}
              >
                <c.icon className="h-5 w-5" strokeWidth={2.2} />
                <span className="font-medium">{c.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Populares */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Nossos mais populares
          </h3>
          <span className="text-xs text-primary">Todos</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {salon.services.slice(0, 6).map((s) => (
            <Link
              key={s.id}
              href={`/book/${params.salonSlug}/agendar?service=${s.id}`}
              className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/50"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden">
                <Image
                  src={imageForService(s.name)}
                  alt={s.name}
                  fill
                  sizes="(max-width: 480px) 45vw, 220px"
                  className="object-cover transition group-hover:scale-[1.03]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-card/70 via-transparent to-transparent" />
              </div>
              <div className="p-3">
                <p className="line-clamp-1 text-sm font-medium">{s.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatDuration(s.durationMin)}
                </p>
                <p className="mt-2 text-sm font-semibold text-primary">
                  {formatMoney(s.priceCents, salon.currency)}
                </p>
              </div>
            </Link>
          ))}
        </div>
        {salon.services.length === 0 && (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Este salão ainda não publicou serviços.
          </div>
        )}
      </section>

      <BottomNav salonSlug={params.salonSlug} />
    </main>
  );
}
