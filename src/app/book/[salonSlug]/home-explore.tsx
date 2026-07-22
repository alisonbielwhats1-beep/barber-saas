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

      {/* Category pills — derived from actual DB categories */}
      {categories.length > 1 && (
        <section>
          <p className="mb-2.5 text-sm font-semibold text-muted-foreground">Categorias</p>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => setActiveCategory(null)}
              className={`shrink-0 rounded-full border px-4 py-2 text-[13px] font-medium transition ${
                activeCategory === null
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              Todos
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
                className={`shrink-0 rounded-full border px-4 py-2 text-[13px] font-medium transition ${
                  activeCategory === cat
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Service groups — one banner image per category, no duplicates */}
      <section className="space-y-4">
        <p className="text-sm font-semibold text-muted-foreground">
          {activeCategory ?? (query ? `${groups.reduce((n, g) => n + g.items.length, 0)} resultado${groups.reduce((n, g) => n + g.items.length, 0) !== 1 ? "s" : ""}` : "Nossos serviços")}
        </p>

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
              {/* Category banner — ONE image per category, distinct and correct */}
              <div className="relative h-36 w-full overflow-hidden">
                <Image
                  src={imageForCategory(cat)}
                  alt={cat}
                  fill
                  sizes="(max-width: 480px) 92vw, 440px"
                  className="object-cover"
                  priority={false}
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-transparent" />
                <div className="absolute inset-0 flex items-center px-5">
                  <div>
                    <p className="text-[17px] font-semibold text-white drop-shadow">{cat}</p>
                    <p className="mt-0.5 text-[12px] text-white/65">
                      {items.length} {items.length === 1 ? "serviço" : "serviços"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Service rows — no per-service images, clean list */}
              {items.map((s) => (
                <Link
                  key={s.id}
                  href={`/book/${salonSlug}/agendar?service=${s.id}`}
                  className="flex items-center gap-3 border-t border-border px-4 py-3.5 transition hover:bg-card-hover active:opacity-75"
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
