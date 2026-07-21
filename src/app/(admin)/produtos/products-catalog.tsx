"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Search,
  MoreVertical,
  Power,
  Trash2,
  Pencil,
  Plus,
  Minus,
  AlertTriangle,
  Truck,
  CalendarClock,
  Loader2,
  Flame,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/utils";
import { imageForProduct } from "@/lib/images";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ProductForm } from "./product-form";
import { toggleProductActive, deleteProduct, adjustStock } from "./actions";

export type ProductCard = {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  supplier: string | null;
  barcode: string | null;
  priceCents: number;
  costCents: number;
  stock: number;
  minStock: number;
  expiresAt: string | null;
  imageUrl: string | null;
  active: boolean;
  sold: number;
  topSeller: boolean;
  index: number;
};

type Filter = "all" | "restock" | "out";

export function ProductsCatalog({ products }: { products: ProductCard[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const restockCount = products.filter((p) => p.stock <= p.minStock).length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === "restock" && p.stock > p.minStock) return false;
      if (filter === "out" && p.stock > 0) return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.brand ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, search, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto ou marca…"
            className="w-44 bg-transparent text-[13px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>Todos</Chip>
        <Chip active={filter === "restock"} onClick={() => setFilter("restock")} accent="#F59E0B">
          Repor {restockCount > 0 && `(${restockCount})`}
        </Chip>
        <Chip active={filter === "out"} onClick={() => setFilter("out")} accent="#EF4444">Em falta</Chip>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-[13px] text-muted-foreground">
          Nenhum produto encontrado.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <ProductCardView key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCardView({ p }: { p: ProductCard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const margin = p.priceCents > 0 ? (p.priceCents - p.costCents) / p.priceCents : 0;
  const profit = p.priceCents - p.costCents;
  const needRestock = p.stock <= p.minStock;
  const stockPct = Math.max(4, Math.min(100, (p.stock / Math.max(1, p.minStock * 3)) * 100));

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch {
        /* reversível */
      }
    });
  }

  return (
    <div className={`card-interactive overflow-hidden rounded-2xl border border-border bg-card ${!p.active ? "opacity-60" : ""}`}>
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        <Image src={p.imageUrl || imageForProduct(p.index)} alt={p.name} fill sizes="(max-width:768px) 100vw, 33vw" className="object-cover" />
        <div className="absolute left-2 top-2 flex gap-1.5">
          {p.topSeller && (
            <span className="inline-flex items-center gap-1 rounded-full bg-marketing/90 px-2 py-0.5 text-[10px] font-semibold text-white">
              <Flame className="h-3 w-3" /> Mais vendido
            </span>
          )}
        </div>
        {p.stock === 0 ? (
          <span className="absolute right-2 top-2 rounded-full bg-danger/90 px-2 py-0.5 text-[10px] font-semibold text-white">Sem estoque</span>
        ) : needRestock ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-warning/90 px-2 py-0.5 text-[10px] font-semibold text-black">
            <AlertTriangle className="h-3 w-3" /> Repor
          </span>
        ) : null}
        {!p.active && (
          <div className="absolute inset-0 grid place-items-center bg-background/60">
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">Pausado</span>
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{p.name}</p>
            <p className="text-[11px] text-muted-foreground">{p.brand ?? p.category ?? "—"}</p>
          </div>
          <p className="shrink-0 text-[13px] font-semibold">{formatMoney(p.priceCents)}</p>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Metric label="Margem" value={`${(margin * 100).toFixed(0)}%`} accent={margin >= 0.45 ? "#2ECC8B" : margin >= 0.25 ? "#F59E0B" : "#EF4444"} />
          <Metric label="Lucro/un" value={formatMoney(profit)} />
          <Metric label="Vendidos" value={p.sold.toString()} />
        </div>

        {/* Estoque com barra e ajuste rápido */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Estoque</span>
            <span className={needRestock ? "font-semibold text-warning" : "font-semibold"}>
              {p.stock} un · mín {p.minStock}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => run(() => adjustStock(p.id, -1))}
              disabled={pending || p.stock === 0}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${stockPct}%`, background: needRestock ? "#F59E0B" : "#2ECC8B" }} />
            </div>
            <button
              onClick={() => run(() => adjustStock(p.id, 1))}
              disabled={pending}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
          <div className="min-w-0 space-y-0.5">
            {p.supplier && (
              <p className="flex items-center gap-1 truncate"><Truck className="h-3 w-3" /> {p.supplier}</p>
            )}
            {p.expiresAt && (
              <p className="flex items-center gap-1"><CalendarClock className="h-3 w-3" /> val. {format(new Date(p.expiresAt), "MMM/yy", { locale: ptBR })}</p>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-card-hover hover:text-foreground">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <ProductForm
                product={p}
                trigger={
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
                  </DropdownMenuItem>
                }
              />
              <DropdownMenuItem onSelect={() => run(() => toggleProductActive(p.id))}>
                <Power className="mr-2 h-3.5 w-3.5" /> {p.active ? "Pausar" : "Ativar"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => run(() => deleteProduct(p.id))} className="text-danger focus:text-danger">
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
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

function Chip({ active, onClick, children, accent }: { active: boolean; onClick: () => void; children: React.ReactNode; accent?: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
        active ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
      style={active && accent ? { borderColor: `${accent}66`, color: accent, background: `${accent}14` } : undefined}
    >
      {children}
    </button>
  );
}
