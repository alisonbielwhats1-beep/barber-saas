"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Search,
  LayoutGrid,
  List,
  MoreVertical,
  Copy,
  Power,
  Trash2,
  Pencil,
  Clock,
  Users,
  TrendingUp,
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
import { imageForService } from "@/lib/images";
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

export function ServicesCatalog({ services }: { services: ServiceCard[] }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<Sort>("popular");
  const [view, setView] = useState<"grid" | "list">("grid");

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(services.map((s) => s.category).filter(Boolean) as string[]))],
    [services],
  );
  const maxSold = Math.max(1, ...services.map((s) => s.sold));

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = services.filter((s) => {
      if (category !== "all" && s.category !== category) return false;
      if (q && !s.name.toLowerCase().includes(q) && !(s.description ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "price") return b.priceCents - a.priceCents;
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "margin") return margin(b) - margin(a);
      return b.sold - a.sold;
    });
    return list;
  }, [services, search, category, sort]);

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
            className="w-40 bg-transparent text-[13px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                category === c ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
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
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface-1 p-1">
            <button onClick={() => setView("grid")} className={`grid h-7 w-7 place-items-center rounded-full ${view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setView("list")} className={`grid h-7 w-7 place-items-center rounded-full ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-[13px] text-muted-foreground">
          Nenhum serviço encontrado.
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => (
            <ServiceGridCard key={s.id} s={s} maxSold={maxSold} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {shown.map((s) => (
            <ServiceListRow key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function margin(s: ServiceCard) {
  return s.priceCents > 0 ? (s.priceCents - s.costCents) / s.priceCents : 0;
}

function useActions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch {
        /* erro silencioso; ações são reversíveis */
      }
    });
  return { pending, run };
}

function ActionsMenu({ s }: { s: ServiceCard }) {
  const { pending, run } = useActions();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-card-hover hover:text-foreground">
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

function ServiceGridCard({ s, maxSold }: { s: ServiceCard; maxSold: number }) {
  const m = margin(s);
  const profit = s.priceCents - s.costCents;
  return (
    <div className={`card-interactive overflow-hidden rounded-2xl border border-border bg-card ${!s.active ? "opacity-60" : ""}`}>
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        <Image src={s.imageUrl || imageForService(s.name)} alt={s.name} fill sizes="(max-width:768px) 100vw, 33vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        {s.category && (
          <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
            {s.category}
          </span>
        )}
        <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.active ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}`}>
          {s.active ? "Ativo" : "Pausado"}
        </span>
        <div className="absolute inset-x-3 bottom-2 flex items-end justify-between">
          <div>
            <p className="text-sm font-semibold text-white">{s.name}</p>
            <p className="flex items-center gap-1 text-[11px] text-white/80">
              <Clock className="h-3 w-3" /> {formatDuration(s.durationMin)}
            </p>
          </div>
          <p className="text-base font-bold text-white">{formatMoney(s.priceCents)}</p>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label="Margem" value={`${(m * 100).toFixed(0)}%`} accent={m >= 0.5 ? "#2ECC8B" : m >= 0.3 ? "#F59E0B" : "#EF4444"} />
          <Metric label="Lucro" value={formatMoney(profit)} />
          <Metric label="Vendas" value={s.sold.toString()} />
        </div>

        {/* Barra de popularidade */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Popularidade</span>
            <span>{formatMoney(s.revenueCents)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (s.sold / maxSold) * 100)}%` }} />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> {s.proCount} {s.proCount === 1 ? "profissional" : "profissionais"}
          </span>
          <ActionsMenu s={s} />
        </div>
      </div>
    </div>
  );
}

function ServiceListRow({ s }: { s: ServiceCard }) {
  const m = margin(s);
  return (
    <div className={`flex items-center gap-4 border-b border-border px-4 py-3 last:border-0 ${!s.active ? "opacity-60" : ""}`}>
      <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg">
        <Image src={s.imageUrl || imageForService(s.name)} alt={s.name} fill sizes="64px" className="object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{s.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {s.category ?? "—"} · {formatDuration(s.durationMin)} · {s.proCount} prof.
        </p>
      </div>
      <div className="hidden w-16 text-center sm:block">
        <p className="text-[13px] font-semibold" style={{ color: m >= 0.5 ? "#2ECC8B" : m >= 0.3 ? "#F59E0B" : "#EF4444" }}>{(m * 100).toFixed(0)}%</p>
        <p className="text-[10px] text-muted-foreground">margem</p>
      </div>
      <div className="hidden w-16 text-center sm:block">
        <p className="text-[13px] font-semibold">{s.sold}</p>
        <p className="text-[10px] text-muted-foreground">vendas</p>
      </div>
      <p className="w-20 shrink-0 text-right text-[13px] font-semibold">{formatMoney(s.priceCents)}</p>
      <ActionsMenu s={s} />
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-surface-1 py-2">
      <p className="text-[13px] font-semibold" style={accent ? { color: accent } : undefined}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
