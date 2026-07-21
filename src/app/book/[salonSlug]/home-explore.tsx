"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  Scissors,
  Droplet,
  Palette,
  Wand2,
  Sparkles,
  Wind,
  LayoutGrid,
} from "lucide-react";
import { formatMoney, formatDuration } from "@/lib/utils";
import { imageForService } from "@/lib/images";

type Service = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationMin: number;
};

/**
 * Vitrine de serviços da home do cliente: busca + categorias circulares +
 * grid de cards full-bleed (imagem cobre o card, texto flutua sobre degradê).
 * Client component porque busca e filtro de categoria são interativos.
 */

// normaliza igual ao lib/images.ts pra heurística de categoria bater
function norm(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "");
}

const CATEGORIES: {
  key: string;
  label: string;
  icon: typeof Scissors;
  match: (n: string) => boolean;
}[] = [
  { key: "todos", label: "Todos", icon: LayoutGrid, match: () => true },
  { key: "corte", label: "Cortes", icon: Scissors, match: (n) => n.includes("corte") },
  { key: "barba", label: "Barba", icon: Wand2, match: (n) => n.includes("barba") },
  {
    key: "coloracao",
    label: "Coloração",
    icon: Palette,
    match: (n) => n.includes("coloracao") || n.includes("tinta") || n.includes("luzes") || n.includes("mecha"),
  },
  {
    key: "tratamento",
    label: "Tratamentos",
    icon: Sparkles,
    match: (n) => n.includes("hidrata") || n.includes("tratamento") || n.includes("botox") || n.includes("selagem"),
  },
  {
    key: "escova",
    label: "Escova",
    icon: Wind,
    match: (n) => n.includes("escova") || n.includes("finaliza") || n.includes("penteado"),
  },
  {
    key: "quente",
    label: "Hot towel",
    icon: Droplet,
    match: (n) => n.includes("hot") || n.includes("toalha"),
  },
];

export function HomeExplore({
  salonSlug,
  currency,
  services,
}: {
  salonSlug: string;
  currency: string;
  services: Service[];
}) {
  const [category, setCategory] = useState("todos");
  const [query, setQuery] = useState("");

  // só mostra categorias que têm pelo menos 1 serviço (fora "Todos")
  const visibleCategories = useMemo(
    () =>
      CATEGORIES.filter(
        (c) => c.key === "todos" || services.some((s) => c.match(norm(s.name))),
      ),
    [services],
  );

  const filtered = useMemo(() => {
    const cat = CATEGORIES.find((c) => c.key === category) ?? CATEGORIES[0];
    const q = norm(query);
    return services.filter((s) => {
      const n = norm(s.name);
      if (!cat.match(n)) return false;
      if (q && !n.includes(q) && !norm(s.description ?? "").includes(q)) return false;
      return true;
    });
  }, [services, category, query]);

  return (
    <>
      {/* Busca */}
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

      {/* Categorias — círculos perfeitos, scroll horizontal */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Categorias</h3>
        <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleCategories.map((c) => {
            const active = c.key === category;
            return (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className="flex shrink-0 flex-col items-center gap-2"
                style={{ minWidth: 64 }}
              >
                <span
                  className={`grid h-14 w-14 place-items-center rounded-full transition ${
                    active
                      ? "bg-primary text-primary-foreground shadow-[0_0_24px_-4px_hsl(var(--primary))]"
                      : "border border-border bg-card text-muted-foreground"
                  }`}
                >
                  <c.icon className="h-5 w-5" strokeWidth={2.2} />
                </span>
                <span
                  className={`text-xs font-medium ${
                    active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {c.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Grid de serviços — imagem full-bleed com texto sobre degradê */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {category === "todos" && !query
              ? "Nossos serviços"
              : `${filtered.length} ${filtered.length === 1 ? "resultado" : "resultados"}`}
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((s) => (
            <Link
              key={s.id}
              href={`/book/${salonSlug}/agendar?service=${s.id}`}
              className="group relative aspect-[4/5] overflow-hidden rounded-3xl"
            >
              <Image
                src={imageForService(s.name)}
                alt={s.name}
                fill
                sizes="(max-width: 480px) 45vw, 220px"
                className="object-cover transition duration-300 group-hover:scale-[1.05]"
              />
              {/* degradê protege a leitura do texto flutuante */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
              <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
                {formatDuration(s.durationMin)}
              </span>
              <div className="absolute inset-x-0 bottom-0 p-3.5">
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-white">
                  {s.name}
                </p>
                <p className="mt-1 text-sm font-bold text-primary">
                  {formatMoney(s.priceCents, currency)}
                </p>
              </div>
            </Link>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="rounded-3xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {services.length === 0
              ? "Este salão ainda não publicou serviços."
              : "Nada encontrado com esse filtro."}
          </div>
        )}
      </section>
    </>
  );
}
