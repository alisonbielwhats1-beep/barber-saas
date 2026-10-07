"use client";
import { servicePriceLabel } from "@/lib/service-price";
import { ServicePriceNote } from "@/components/service-price";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Search, ChevronRight } from "lucide-react";
import { formatDuration } from "@/lib/utils";


type Service = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  priceType?: string;
  priceNote?: string | null;
  durationMin: number;
  category: string | null;
  imageUrl: string | null;
};

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Prévia curta: a tela de início não vira o cardápio inteiro no celular.
const PREVIEW_LIMIT = 6;

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
  const [expanded, setExpanded] = useState(false);
  const resultsRef = useRef<HTMLElement>(null);

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

  // Services filtered by active category + search query, in category order
  const matches = useMemo(() => {
    const q = norm(query.trim());
    return categories
      .filter((cat) => activeCategory === null || cat === activeCategory)
      .flatMap((cat) =>
        services.filter((s) => {
          if ((s.category ?? "Outros") !== cat) return false;
          if (!q) return true;
          return norm(s.name).includes(q) || norm(s.description ?? "").includes(q);
        }),
      );
  }, [services, categories, activeCategory, query]);

  const visible = expanded ? matches : matches.slice(0, PREVIEW_LIMIT);
  const hidden = matches.length - visible.length;
  const showCategoryLabel = activeCategory === null && categories.length > 1;

  function chooseCategory(category: string | null, chip?: HTMLElement) {
    setActiveCategory(category);
    setQuery("");
    setExpanded(false);
    chip?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  function collapse() {
    setExpanded(false);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const chipClass = (active: boolean) =>
    `min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:border-primary"
    }`;

  return (
    <>
      {/* Search */}
      <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-3">
        <Search aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setExpanded(false);
            if (e.target.value) setActiveCategory(null);
          }}
          aria-label="Buscar serviços"
          placeholder="Buscar serviços…"
          className="min-w-0 flex-1 bg-transparent text-base placeholder:text-muted-foreground focus:outline-none"
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

      {/* Categorias numa linha só, que desliza para o lado no celular. */}
      {categories.length > 1 && !query && (
        <section aria-label="Categorias de serviços">
          <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-5 sm:px-5 lg:mx-0 lg:flex-wrap lg:px-0 [&::-webkit-scrollbar]:hidden">
            <button type="button" onClick={(e) => chooseCategory(null, e.currentTarget)} aria-pressed={activeCategory === null} className={chipClass(activeCategory === null)}>
              Todos <span className="ml-1 text-xs opacity-75">{services.length}</span>
            </button>
            {categories.map(cat => (
              <button type="button" key={cat} onClick={(e) => chooseCategory(cat, e.currentTarget)} aria-pressed={activeCategory === cat} className={chipClass(activeCategory === cat)}>
                {cat} <span className="ml-1 text-xs opacity-75">{countByCat.get(cat) ?? 0}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Service list */}
      <section ref={resultsRef} tabIndex={-1} aria-label="Serviços" className="space-y-3 outline-none">
        {query && (
          <p className="text-sm font-semibold text-muted-foreground">
            {matches.length} resultado{matches.length !== 1 ? "s" : ""}
          </p>
        )}

        {matches.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {services.length === 0
              ? "Este salão ainda não publicou serviços."
              : "Nada encontrado com esse filtro."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-border bg-card">
            {visible.map((s) => (
              <Link
                key={s.id}
                href={`/book/${salonSlug}/agendar?service=${s.id}`}
                className="flex items-center gap-3 border-t border-border px-4 py-3.5 transition hover:bg-card-hover active:opacity-75 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-[14px] font-medium">{s.name}</p>
                  {s.description && (
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                  <ServicePriceNote service={s} />
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {showCategoryLabel && `${s.category ?? "Outros"} · `}{formatDuration(s.durationMin)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p className="max-w-32 text-right text-[14px] font-bold text-primary">
                    {servicePriceLabel(s, currency)}
                  </p>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="min-h-11 w-full rounded-full border border-border bg-card px-4 text-sm font-semibold text-primary transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ver mais {hidden} {hidden === 1 ? "serviço" : "serviços"}
          </button>
        )}
        {expanded && matches.length > PREVIEW_LIMIT && (
          <button
            type="button"
            onClick={collapse}
            className="min-h-11 w-full rounded-full px-4 text-sm font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Mostrar menos
          </button>
        )}
      </section>
    </>
  );
}
