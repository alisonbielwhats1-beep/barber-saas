"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Search,
  MoreVertical,
  Copy,
  Power,
  Trash2,
  Pencil,
  Clock,
  Users,
  LayoutGrid,
  List,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatMoney, formatDuration } from "@/lib/utils";
import { imageForCategory } from "@/lib/images";
import { ServiceForm } from "./service-form";
import { toggleServiceActive, deleteService, duplicateService } from "./actions";

export type ServiceCard = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  costCents: number;
  category: string | null;
  imageUrl: string | null;
  colorHex: string | null;
  active: boolean;
  sold: number;
  revenueCents: number;
  proCount: number;
};

type Sort = "popular" | "price" | "margin" | "name";
type View = "grid" | "list";

function margin(s: ServiceCard) {
  return s.priceCents > 0 ? (s.priceCents - s.costCents) / s.priceCents : 0;
}

function marginColor(m: number) {
  return m >= 0.5 ? "#2ECC8B" : m >= 0.3 ? "#F59E0B" : "#EF4444";
}

export function ServicesCatalog({ services }: { services: ServiceCard[] }) {
  const [search, setSearch]           = useState("");
  const [activeCategory, setCategory] = useState("all");
  const [sort, setSort]               = useState<Sort>("popular");
  const [view, setView]               = useState<View>("grid");

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(services.map((s) => s.category).filter(Boolean) as string[]))],
    [services],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      if (activeCategory !== "all" && s.category !== activeCategory) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [services, search, activeCategory]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, ServiceCard[]>();
    for (const s of filtered) {
      const cat = s.category ?? "Sem categoria";
      if (!map.has(cat)) { order.push(cat); map.set(cat, []); }
      map.get(cat)!.push(s);
    }
    for (const [cat, items] of map) {
      map.set(cat, [...items].sort((a, b) => {
        if (sort === "price")  return b.priceCents - a.priceCents;
        if (sort === "name")   return a.name.localeCompare(b.name);
        if (sort === "margin") return margin(b) - margin(a);
        return b.sold - a.sold;
      }));
    }
    return order.map((cat) => ({ cat, items: map.get(cat)! }));
  }, [filtered, sort]);

  return (
    <div className="space-y-4">
      {/* Barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar serviço…"
            className="w-44 bg-transparent text-[13px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                activeCategory === c
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "all" ? "Todas" : c}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-9 rounded-full border border-border bg-card px-3 text-[12px] text-muted-foreground focus:outline-none"
          >
            <option value="popular">Mais vendidos</option>
            <option value="price">Maior preço</option>
            <option value="margin">Maior margem</option>
            <option value="name">Nome (A-Z)</option>
          </select>

          {/* Toggle grade / lista */}
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface-1 p-1">
            <button
              onClick={() => setView("grid")}
              title="Vista em grade (com imagens)"
              className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
                view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView("list")}
              title="Vista em lista (compacta)"
              className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
                view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-[13px] text-muted-foreground">
          Nenhum serviço encontrado.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ cat, items }) =>
            view === "grid" ? (
              <CategoryGroupGrid key={cat} cat={cat} items={items} />
            ) : (
              <CategoryGroupList key={cat} cat={cat} items={items} />
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ── Vista GRADE — banner full-width por categoria ─────────────────────── */

function CategoryGroupGrid({ cat, items }: { cat: string; items: ServiceCard[] }) {
  const totalRevenue = items.reduce((s, i) => s + i.revenueCents, 0);
  const totalSold    = items.reduce((s, i) => s + i.sold, 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Banner full-width — UMA imagem por categoria */}
      <div className="relative h-28 w-full overflow-hidden sm:h-32">
        <Image
          src={imageForCategory(cat)}
          alt={cat}
          fill
          sizes="(max-width: 768px) 100vw, 800px"
          className="object-cover"
          priority={false}
        />
        {/* Gradiente para legibilidade do texto */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/40 to-transparent" />
        <div className="absolute inset-0 flex items-center px-5">
          <div>
            <p className="text-[15px] font-semibold text-white drop-shadow">{cat}</p>
            <p className="mt-0.5 text-[12px] text-white/70">
              {items.length} {items.length === 1 ? "serviço" : "serviços"}
              {totalSold > 0 && ` · ${totalSold} vendas · ${formatMoney(totalRevenue)}`}
            </p>
          </div>
        </div>
      </div>

      {/* Serviços — linhas sem imagem */}
      {items.map((s) => (
        <ServiceRow key={s.id} s={s} />
      ))}
    </div>
  );
}

/* ── Vista LISTA — sem imagens, apenas separador de categoria ───────────── */

function CategoryGroupList({ cat, items }: { cat: string; items: ServiceCard[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Cabeçalho de texto simples */}
      <div className="border-b border-border bg-surface-1 px-4 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          {cat}
        </p>
      </div>
      {items.map((s) => (
        <ServiceRow key={s.id} s={s} />
      ))}
    </div>
  );
}

/* ── Linha de serviço (compartilhada entre as duas vistas) ─────────────── */

function ServiceRow({ s }: { s: ServiceCard }) {
  const m = margin(s);
  return (
    <div
      className={`flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 ${
        !s.active ? "opacity-50" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-tight">{s.name}</p>
        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(s.durationMin)}
          </span>
          {s.proCount > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {s.proCount}
            </span>
          )}
          {!s.active && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              Pausado
            </span>
          )}
        </p>
      </div>

      <div className="hidden w-14 shrink-0 text-right sm:block">
        <p className="text-[13px] font-semibold" style={{ color: marginColor(m) }}>
          {(m * 100).toFixed(0)}%
        </p>
        <p className="text-[10px] text-muted-foreground">margem</p>
      </div>

      <div className="hidden w-10 shrink-0 text-right sm:block">
        <p className="text-[13px] font-semibold">{s.sold}</p>
        <p className="text-[10px] text-muted-foreground">vendas</p>
      </div>

      <p className="w-20 shrink-0 text-right text-[13px] font-semibold">
        {formatMoney(s.priceCents)}
      </p>

      <ActionsMenu s={s} />
    </div>
  );
}

/* ── Menu de ações ────────────────────────────────────────────────────── */

function ActionsMenu({ s }: { s: ServiceCard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      try { await fn(); router.refresh(); } catch { /* silencioso */ }
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-card-hover hover:text-foreground">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ServiceForm
          service={s}
          trigger={
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
            </DropdownMenuItem>
          }
        />
        <DropdownMenuItem onSelect={() => run(() => duplicateService(s.id))}>
          <Copy className="mr-2 h-3.5 w-3.5" /> Duplicar
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(() => toggleServiceActive(s.id))}>
          <Power className="mr-2 h-3.5 w-3.5" /> {s.active ? "Pausar" : "Ativar"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => run(() => deleteService(s.id))}
          className="text-danger focus:text-danger"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
