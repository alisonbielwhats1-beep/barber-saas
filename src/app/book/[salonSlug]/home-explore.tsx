"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, ChevronRight } from "lucide-react";
import { formatMoney, formatDuration } from "@/lib/utils";
import { imageForCategory } from "@/lib/images";

type Service = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationMin: number;
  category: string | null;
};

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function HomeExplore({
  salonSlug,
  currency,
  services,
}: {
  salonSlug: string;
  currency: string;
  services: Service[];
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Derive ordered category list from DB data
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of services) {
      const cat = s.category ?? "Outros";
      if (!seen.has(cat)) { seen.add(cat); result.push(cat); }
    }
    return result;
  }, [services]);

  // Count per category
  const countByCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of services) {
      const cat = s.category ?? "Outros";
      m.set(cat, (m.get(cat) ?? 0) + 1);
    }
    return m;
  }, [services]);

  // Groups filtered by active category + search query
  const groups = useMemo(() => {
    const q = norm(query.trim());
    return categories
      .filter((cat) => activeCategory === null || cat === activeCategory)
      .map((cat) => ({
        cat,
        items: services.filter((s) => {
          if ((s.category ?? "Outros") !== cat) return false;
          if (!q) return true;
          return norm(s.name).includes(q) || norm(s.description ?? "").includes(q);
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [services, categories, activeCategory, query]);

  return (
    <>
      {/* Search */}
      <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar serviços…"
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Category grid — 2-column square tiles, shown only when multiple categories */}
      {categories.length > 1 && !query && (
        <section>
          <p className="mb-3 text-sm font-semibold text-muted-foreground">Categorias</p>
          <div className="grid grid-cols-2 gap-3">
            {/* "Todos" tile */}
            <button
              onClick={() => setActiveCategory(null)}
              className={`relative aspect-square overflow-hidden rounded-2xl transition ${
                activeCategory === null
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "opacity-80 hover:opacity-100"
              }`}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/40 to-primary/10" />
              <div className="absolute inset-0 flex flex-col items-start justify-end p-4">
                <p className="text-sm font-bold text-white drop-shadow-sm">Todos</p>
                <p className="text-xs text-white/70">
                  {services.length} {services.length === 1 ? "serviço" : "serviços"}
                </p>
              </div>
            </button>

            {categories.map((cat) => {
              const count = countByCat.get(cat) ?? 0;
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(active ? null : cat)}
                  className={`relative aspect-square overflow-hidden rounded-2xl transition ${
                    active
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "opacity-85 hover:opacity-100"
                  }`}
                >
                  <Image
                    src={imageForCategory(cat)}
                    alt={cat}
                    fill
                    sizes="(max-width: 480px) 45vw, 200px"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
                  <div className="absolute inset-0 flex flex-col items-start justify-end p-4">
                    <p className="text-sm font-bold text-white drop-shadow-sm">{cat}</p>
                    <p className="text-xs text-white/70">
                      {count} {count === 1 ? "serviço" : "serviços"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Service list */}
      <section className="space-y-4">
        {query && (
          <p className="text-sm font-semibold text-muted-foreground">
            {groups.reduce((n, g) => n + g.items.length, 0)} resultado
            {groups.reduce((n, g) => n + g.items.length, 0) !== 1 ? "s" : ""}
          </p>
        )}
        {!query && activeCategory && (
          <p className="text-sm font-semibold text-muted-foreground">{activeCategory}</p>
        )}
        {!query && !activeCategory && categories.length <= 1 && (
          <p className="text-sm font-semibold text-muted-foreground">Nossos serviços</p>
        )}

        {groups.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {services.length === 0
              ? "Este salão ainda não publicou serviços."
              : "Nada encontrado com esse filtro."}
          </div>
        ) : (
          groups.map(({ cat, items }) => (
            <div
              key={cat}
              className="overflow-hidden rounded-3xl border border-border bg-card"
            >
              {/* Category header — only when showing multiple categories */}
              {(activeCategory === null && categories.length > 1 && !query) && (
                <div className="border-b border-border px-4 py-3">
                  <p className="text-[13px] font-semibold">{cat}</p>
                </div>
              )}

              {/* Service rows */}
              {items.map((s) => (
                <Link
                  key={s.id}
                  href={`/book/${salonSlug}/agendar?service=${s.id}`}
                  className="flex items-center gap-3 border-t border-border px-4 py-3.5 transition hover:bg-card-hover active:opacity-75 first:border-t-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{s.name}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {formatDuration(s.durationMin)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <p className="text-[14px] font-bold text-primary">
                      {formatMoney(s.priceCents, currency)}
                    </p>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          ))
        )}
      </section>
    </>
  );
}
