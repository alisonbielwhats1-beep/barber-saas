"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  PackageSearch,
  ClipboardList,
  PackagePlus,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/utils";
import { resolveProductImage } from "@/lib/images";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProductForm } from "./product-form";
import { toggleProductActive, deleteProduct, adjustStock } from "./actions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";

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
export type StockMovement = { id: string; actorName: string; reason: string | null; createdAt: string; metadata: Record<string, unknown> | null };

export function ProductsCatalog({ products, movements, enabled = true, initialFilter = "all" }: { products: ProductCard[]; movements: StockMovement[]; enabled?: boolean; initialFilter?: Filter }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);

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
      <div className="admin-catalog-tools flex flex-wrap items-center gap-2">
        <div className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-3">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto ou marca…"
            aria-label="Buscar produto ou marca"
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
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <PackageSearch className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-[14px] font-medium">Nenhum produto encontrado</p>
          <p className="mt-1 text-[12px] text-muted-foreground">Ajuste a busca ou limpe os filtros para ver o catálogo.</p>
          <button
            type="button"
            onClick={() => { setSearch(""); setFilter("all"); }}
            className="mt-4 min-h-11 rounded-lg border border-border px-4 text-[13px] font-medium transition hover:bg-card-hover"
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <div aria-label="Lista de produtos" className="overflow-hidden rounded-2xl border border-border bg-card">
          {shown.map((p) => (
            <ProductCardView key={p.id} p={p} enabled={enabled} />
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5"><ClipboardList className="h-4 w-4 text-primary" /><h2 className="text-[13px] font-semibold">Histórico de movimentações</h2></div>
        {movements.length === 0 ? <p className="p-8 text-center text-[12px] text-muted-foreground">As entradas, perdas e inventários aparecerão aqui.</p> : movements.slice(0, 15).map((movement) => {
          const delta = Number(movement.metadata?.delta ?? 0);
          return <div key={movement.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:px-5"><span className={`grid h-8 w-8 place-items-center rounded-lg text-[12px] font-bold ${delta >= 0 ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>{delta >= 0 ? `+${delta}` : delta}</span><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">{String(movement.metadata?.productName ?? "Produto")}</p><p className="truncate text-[10px] text-muted-foreground">{movement.reason ?? "Sem motivo"} · {movement.actorName}</p></div><p className="text-[10px] text-muted-foreground">{format(new Date(movement.createdAt), "dd/MM · HH:mm", { locale: ptBR })}</p></div>;
        })}
      </div>
    </div>
  );
}

function ProductCardView({ p, enabled }: { p: ProductCard; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const hasCost = p.priceCents > 0 && p.costCents > 0;
  const margin = hasCost ? (p.priceCents - p.costCents) / p.priceCents : null;
  const profit = hasCost ? p.priceCents - p.costCents : null;
  const needRestock = p.stock <= p.minStock;
  const stockPct = Math.max(4, Math.min(100, (p.stock / Math.max(1, p.minStock * 3)) * 100));
  const imageSrc = resolveProductImage({
    imageUrl: p.imageUrl,
    name: p.name,
    category: p.category,
    index: p.index,
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [stockDialog, setStockDialog] = useState(false);
  const [stockDelta, setStockDelta] = useState("1");
  const [stockReason, setStockReason] = useState("");
  const [stockKind, setStockKind] = useState<"PURCHASE" | "LOSS" | "INVENTORY" | "ADJUSTMENT">("PURCHASE");

  // Toda mutação dá feedback: sucesso ou erro, nunca silêncio.
  // Ajuste de estoque só avisa em erro — o número na tela já é o feedback.
  function run(fn: () => Promise<void>, okMsg?: string) {
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
        if (okMsg) toast(okMsg);
      } catch {
        toast("Não foi possível concluir. Tente novamente.", "error");
      }
    });
  }

  return (
    <div className={`border-b border-border last:border-0 ${!p.active ? "opacity-60" : ""}`}>
      <details className="group">
      <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
        {p.imageUrl ? <ImageWithFallback
          src={imageSrc}
          fallback={<PackageSearch aria-hidden="true" className="h-5 w-5 text-muted-foreground" />}
          alt=""
          fill
          sizes="48px"
          className="object-cover"
        /> : <PackageSearch aria-hidden="true" className="h-5 w-5 text-muted-foreground" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium">{p.name}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{formatMoney(p.priceCents)}{p.brand ? ` · ${p.brand}` : ""}</span>
          <span className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${needRestock ? "text-warning" : "text-muted-foreground"}`}>
            <span>Estoque: {p.stock}</span>
            {needRestock && <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{p.stock === 0 ? "Em falta" : "Repor"}</span>}
            {!p.active && <span>Pausado</span>}
            {p.topSeller && <span className="inline-flex items-center gap-1 text-primary"><Flame className="h-3 w-3" />Mais vendido</span>}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border bg-surface-1/30 p-4">
        {p.category && <p className="mb-3 text-xs text-muted-foreground">{p.category}</p>}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label="Margem" value={margin === null ? "—" : `${(margin * 100).toFixed(0)}%`} accent={margin === null ? undefined : margin >= 0.45 ? "#2ECC8B" : margin >= 0.25 ? "#F59E0B" : "#EF4444"} />
          <Metric label={profit === null ? "Custo" : "Resultado/un"} value={profit === null ? "não informado" : formatMoney(profit)} />
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
              onClick={() => run(() => adjustStock(p.id, -1, { reason: "Ajuste rápido de saída", kind: "ADJUSTMENT" }))}
              disabled={!enabled || pending || p.stock === 0}
              aria-label={`Diminuir estoque de ${p.name}`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-card-hover hover:text-foreground disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${stockPct}%`, background: needRestock ? "#F59E0B" : "#2ECC8B" }} />
            </div>
            <button
              onClick={() => run(() => adjustStock(p.id, 1, { reason: "Ajuste rápido de entrada", kind: "ADJUSTMENT" }))}
              disabled={!enabled || pending}
              aria-label={`Aumentar estoque de ${p.name}`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-card-hover hover:text-foreground disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <button disabled={!enabled} onClick={() => setStockDialog(true)} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-[11px] font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"><PackagePlus className="h-3.5 w-3.5" /> Movimentar estoque</button>
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
              <button disabled={!enabled} aria-label={`Mais opções para ${p.name}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-card-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {enabled && <ProductForm
                  product={p}
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
                    </DropdownMenuItem>
                  }
                />}
              <DropdownMenuItem
                onSelect={() =>
                  run(() => toggleProductActive(p.id), p.active ? "Produto pausado" : "Produto ativado")
                }
              >
                <Power className="mr-2 h-3.5 w-3.5" /> {p.active ? "Pausar" : "Ativar"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-danger focus:text-danger">
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      </details>
      <Dialog open={stockDialog} onOpenChange={setStockDialog}>
        <DialogContent className="admin-form-dialog max-w-sm">
          <DialogHeader><DialogTitle>Movimentar estoque</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label htmlFor={`kind-${p.id}`} className="mb-1 block text-[11px] font-medium text-muted-foreground">Tipo</label><select id={`kind-${p.id}`} value={stockKind} onChange={(event) => setStockKind(event.target.value as typeof stockKind)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px]"><option value="PURCHASE">Entrada por compra</option><option value="LOSS">Perda ou descarte</option><option value="INVENTORY">Correção de inventário</option><option value="ADJUSTMENT">Outro ajuste</option></select></div>
            <div><label htmlFor={`quantity-${p.id}`} className="mb-1 block text-[11px] font-medium text-muted-foreground">Quantidade</label><input id={`quantity-${p.id}`} type="number" min="1" value={stockDelta} onChange={(event) => setStockDelta(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px]" /></div>
            <div><label htmlFor={`reason-${p.id}`} className="mb-1 block text-[11px] font-medium text-muted-foreground">Motivo</label><input id={`reason-${p.id}`} value={stockReason} onChange={(event) => setStockReason(event.target.value)} placeholder="Ex.: Nota 123 do fornecedor" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px]" /></div>
            <button disabled={!enabled || pending || stockReason.trim().length < 3 || Number(stockDelta) < 1} onClick={() => run(async () => { const quantity = Math.max(1, Math.floor(Number(stockDelta))); const sign = stockKind === "LOSS" ? -1 : 1; await adjustStock(p.id, sign * quantity, { reason: stockReason, kind: stockKind }); setStockDialog(false); setStockReason(""); }, "Movimentação registrada")} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-50">{pending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar movimentação</button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Excluir "${p.name}"?`}
        description="O produto sai do catálogo e da vitrine do cliente. Vendas já registradas são mantidas."
        onConfirm={() => {
          setConfirmDelete(false);
          run(() => deleteProduct(p.id), "Produto excluído");
        }}
        pending={pending}
      />
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-full border px-3 text-[12px] font-medium transition-colors ${
        active ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
      style={active && accent ? { borderColor: `${accent}66`, color: accent, background: `${accent}14` } : undefined}
    >
      {children}
    </button>
  );
}
