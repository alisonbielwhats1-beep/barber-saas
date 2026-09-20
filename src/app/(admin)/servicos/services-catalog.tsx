"use client";
import { MobileListTools } from "@/components/mobile-list-tools";
import { servicePriceLabel } from "@/lib/service-price";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  Scissors,
  Paintbrush,
  Hand,
  Sparkles,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatMoney, formatDuration } from "@/lib/utils";
import { bannerForCategory, normalizeImageUrl } from "@/lib/images";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ServiceForm } from "./service-form";
import { toggleServiceActive, deleteService, duplicateService } from "./actions";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";

export type ServiceCard = {
  variantGroup?: string | null;
  variantLabel?: string | null;
  processingMin?: number;
  finishingMin?: number;
  physicalResourceId?: string | null;
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  priceType?: string;
  priceNote?: string | null;
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
  return s.priceCents > 0 && s.costCents > 0 ? (s.priceCents - s.costCents) / s.priceCents : null;
}

function marginColor(m: number) {
  return m >= 0.5 ? "#2ECC8B" : m >= 0.3 ? "#F59E0B" : "#EF4444";
}

export function ServicesCatalog({
  services,
  canManage,
  canSeeFinancial,
}: {
  services: ServiceCard[];
  canManage: boolean;
  canSeeFinancial: boolean;
}) {
  const [search, setSearch]           = useState("");
  const [activeCategory, setCategory] = useState("all");
  const [sort, setSort]               = useState<Sort>(canSeeFinancial ? "popular" : "name");
  // A lista é a leitura mais rápida para quem está administrando o catálogo.
  // A grade continua disponível quando a imagem ajuda na decisão.
  const [view, setView]               = useState<View>("list");

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
        if (sort === "margin") return (margin(b) ?? -1) - (margin(a) ?? -1);
        return b.sold - a.sold;
      }));
    }
    return order.map((cat) => ({ cat, items: map.get(cat)! }));
  }, [filtered, sort]);

  return (
    <div className="space-y-2">
      {/* Barra de ferramentas */}
      <div className="admin-catalog-tools flex flex-wrap items-center gap-2">
        <div className="flex min-h-11 min-w-0 flex-1 md:flex-none items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar serviço…"
            aria-label="Buscar serviço"
            className="w-full min-w-0 md:w-44 bg-transparent text-[13px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div className="service-category-filters order-last flex w-full items-center gap-1.5 overflow-x-auto" role="group" aria-label="Categorias de serviços">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={activeCategory === c}
              className="min-h-9 shrink-0 rounded-full px-0 text-[12px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className={`inline-flex min-h-9 items-center rounded-full border px-3 transition-colors ${activeCategory === c ? "border-transparent bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>{c === "all" ? "Todas" : c}</span>
            </button>
          ))}
        </div>

        <MobileListTools label="Mais opções">
        <div className="ml-auto flex items-center gap-2">
          <select
            value={sort}
            aria-label="Ordenar serviços"
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-11 rounded-lg border border-border bg-card px-3 text-[12px] text-muted-foreground focus:outline-none"
          >
            {canSeeFinancial && <option value="popular">Mais vendidos</option>}
            <option value="price">Maior preço</option>
            {canSeeFinancial && <option value="margin">Maior margem</option>}
            <option value="name">Nome (A-Z)</option>
          </select>

          {/* Toggle grade / lista */}
          <div className="hidden md:flex items-center gap-0.5 rounded-full border border-border bg-surface-1 p-1">
            <button
              onClick={() => setView("grid")}
              title="Vista em grade (com imagens)"
              aria-pressed={view === "grid"}
              className={`grid h-11 w-11 place-items-center rounded-lg transition-colors ${
                view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView("list")}
              title="Vista em lista (compacta)"
              aria-pressed={view === "list"}
              className={`grid h-11 w-11 place-items-center rounded-lg transition-colors ${
                view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        </MobileListTools>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-[13px] text-muted-foreground">
          Nenhum serviço encontrado.
        </div>
      ) : (
        <div aria-label="Lista de serviços" className="overflow-hidden">
          {groups.map(({ cat, items }) =>
            view === "grid" ? (
              <CategoryGroupGrid
                key={cat}
                cat={cat}
                items={items}
                canManage={canManage}
                canSeeFinancial={canSeeFinancial}
              />
            ) : (
              <CategoryGroupList
                key={cat}
                cat={cat}
                items={items}
                canManage={canManage}
                canSeeFinancial={canSeeFinancial}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ── Vista GRADE — banner full-width por categoria ─────────────────────── */

function CategoryGroupGrid({
  cat,
  items,
  canManage,
  canSeeFinancial,
}: {
  cat: string;
  items: ServiceCard[];
  canManage: boolean;
  canSeeFinancial: boolean;
}) {
  const totalRevenue = items.reduce((s, i) => s + i.revenueCents, 0);
  const totalSold    = items.reduce((s, i) => s + i.sold, 0);
  const categoryImage = normalizeImageUrl(items.find((item) => item.imageUrl)?.imageUrl) ?? bannerForCategory(cat);

  return (
    <div className="overflow-hidden border-b border-border/50 last:border-b-0">
      {/* Banner discreto: identifica a categoria sem dominar a operação. */}
      <div className="relative hidden h-36 w-full overflow-hidden md:block">
        <ImageWithFallback
          src={categoryImage}
          fallbackSrc={bannerForCategory(cat)}
          alt={cat}
          fill
          sizes="(max-width: 768px) 100vw, 900px"
          className="object-cover object-center"
          priority={false}
        />
        {/* Gradiente vertical — escurece a base onde fica o texto */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-5 pb-4">
          <p className="text-[17px] font-semibold text-white drop-shadow">{cat}</p>
          <p className="mt-0.5 text-[12px] text-white/70">
            {items.length} {items.length === 1 ? "serviço" : "serviços"}
            {canSeeFinancial && totalSold > 0 && ` · ${totalSold} vendas · ${formatMoney(totalRevenue)}`}
          </p>
        </div>
      </div>

      {/* Serviços — linhas sem imagem */}
      {items.map((s) => (
        <ServiceRow
          key={s.id}
          s={s}
          canManage={canManage}
          canSeeFinancial={canSeeFinancial}
        />
      ))}
    </div>
  );
}

/* ── Vista LISTA — sem imagens, apenas separador de categoria ───────────── */

function CategoryGroupList({
  cat,
  items,
  canManage,
  canSeeFinancial,
}: {
  cat: string;
  items: ServiceCard[];
  canManage: boolean;
  canSeeFinancial: boolean;
}) {
  return (
    <div className="overflow-hidden border-b border-border/50 last:border-b-0">
      {/* Cabeçalho de texto simples */}
      <div className="hidden border-b border-border bg-surface-1 px-4 py-2 md:block">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {cat}
        </p>
      </div>
      {items.map((s) => (
        <ServiceRow
          key={s.id}
          s={s}
          canManage={canManage}
          canSeeFinancial={canSeeFinancial}
        />
      ))}
    </div>
  );
}

/* ── Linha de serviço (compartilhada entre as duas vistas) ─────────────── */

function ServiceIcon({ service }: { service: ServiceCard }) {
  const label = `${service.category ?? ""} ${service.name}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const [Icon, background, color] = /unha|manicure|pedicure/.test(label)
    ? [Hand, "#C9E0FA", "#275685"] as const
    : /color|quim|tint/.test(label)
      ? [Paintbrush, "#DDD0F0", "#644183"] as const
      : /corte|barba|cabelo/.test(label)
        ? [Scissors, "#BFEBDD", "#195E4A"] as const
        : [Sparkles, "#DDD0F0", "#644183"] as const;
  return <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background, color }}><Icon className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>;
}

function ServiceRow({
  s,
  canManage,
  canSeeFinancial,
}: {
  s: ServiceCard;
  canManage: boolean;
  canSeeFinancial: boolean;
}) {
  const m = margin(s);
  return (
    <div
      className={`flex items-center gap-2.5 border-b border-border py-3 sm:px-4 last:border-0 ${
        !s.active ? "opacity-50" : ""
      }`}
    >
      <ServiceIcon service={s} />
      <div className="min-w-0 flex-1">
        <p className="break-words text-[13px] font-medium leading-snug md:truncate">{s.name}</p>
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

      {canSeeFinancial && <div className="hidden w-14 shrink-0 text-right sm:block">
        <p className={`text-[13px] font-semibold ${m === null ? "text-muted-foreground" : ""}`} style={m === null ? undefined : { color: marginColor(m) }}>
          {m === null ? "—" : `${(m * 100).toFixed(0)}%`}
        </p>
        <p className="text-[10px] text-muted-foreground">{m === null ? "custo não informado" : "margem"}</p>
      </div>}

      {canSeeFinancial && <div className="hidden w-10 shrink-0 text-right sm:block">
        <p className="text-[13px] font-semibold">{s.sold}</p>
        <p className="text-[10px] text-muted-foreground">vendas</p>
      </div>}

      <p className="w-[4.5rem] md:w-20 shrink-0 text-right text-[13px] font-semibold">
        {servicePriceLabel(s)}
      </p>

      {canManage && <ActionsMenu s={s} />}
    </div>
  );
}

/* ── Menu de ações ────────────────────────────────────────────────────── */

function ActionsMenu({ s }: { s: ServiceCard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Toda mutação dá feedback: sucesso ou erro, nunca silêncio.
  const run = (fn: () => Promise<void>, okMsg: string) =>
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
        toast(okMsg);
      } catch {
        toast("Não foi possível concluir. Tente novamente.", "error");
      }
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label={`Mais opções para ${s.name}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-card-hover hover:text-foreground">
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
          <DropdownMenuItem onSelect={() => run(() => duplicateService(s.id), "Serviço duplicado")}>
            <Copy className="mr-2 h-3.5 w-3.5" /> Duplicar
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run(() => toggleServiceActive(s.id), s.active ? "Serviço pausado" : "Serviço ativado")
            }
          >
            <Power className="mr-2 h-3.5 w-3.5" /> {s.active ? "Pausar" : "Ativar"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setConfirmDelete(true)}
            className="text-danger focus:text-danger"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Excluir "${s.name}"?`}
        description="O serviço sai do catálogo e do link de agendamento. O histórico de atendimentos já realizados é mantido."
        onConfirm={() => {
          setConfirmDelete(false);
          run(() => deleteService(s.id), "Serviço excluído");
        }}
        pending={pending}
      />
    </>
  );
}
