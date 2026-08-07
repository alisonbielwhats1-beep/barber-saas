"use client";

import { useMemo, useRef, useState, useTransition } from "react";
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
  ShoppingCart,
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
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProductForm } from "./product-form";
import {
  toggleProductActive,
  deleteProduct,
  adjustStock,
  registerProductSale,
} from "./actions";

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

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleQuantity, setSaleQuantity] = useState(1);
  const [saleError, setSaleError] = useState<string | null>(null);
  const saleIdempotencyKey = useRef<string | null>(null);

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

  function changeSaleQuantity(next: number) {
    saleIdempotencyKey.current = null;
    setSaleError(null);
    setSaleQuantity(Math.max(1, Math.min(p.stock, next)));
  }

  function submitSale() {
    setSaleError(null);
    startTransition(async () => {
      const idempotencyKey = saleIdempotencyKey.current ?? crypto.randomUUID();
      saleIdempotencyKey.current = idempotencyKey;
      const result = await registerProductSale({
        productId: p.id,
        quantity: saleQuantity,
        idempotencyKey,
      });

      if (!result.ok) {
        setSaleError(result.error);
        return;
      }

      setSaleOpen(false);
      setSaleQuantity(1);
      saleIdempotencyKey.current = null;
      router.refresh();
      toast(
        result.duplicate
          ? "Venda já estava registrada"
          : `Venda registrada · estoque atual: ${result.stockAfter}`,
      );
    });
  }

  return (
    <div className={`card-interactive overflow-hidden rounded-2xl border border-border bg-card ${!p.active ? "opacity-60" : ""}`}>
      <div className="relative aspect-video w-full overflow-hidden bg-surface-1">
        <Image
          src={p.imageUrl || imageForProduct(p.index)}
          alt={`Foto completa de ${p.name}`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
          className="object-contain"
        />
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

        <button
          type="button"
          onClick={() => {
            setSaleError(null);
            setSaleQuantity(1);
            saleIdempotencyKey.current = null;
            setSaleOpen(true);
          }}
          disabled={pending || p.stock === 0 || !p.active}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
          {p.stock === 0 ? "Sem estoque para vender" : "Registrar venda"}
        </button>

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

      <Dialog
        open={saleOpen}
        onOpenChange={(open) => {
          if (pending) return;
          setSaleOpen(open);
          if (!open) {
            setSaleError(null);
            setSaleQuantity(1);
            saleIdempotencyKey.current = null;
          }
        }}
      >
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Registrar venda</DialogTitle>
            <DialogDescription>
              A venda será contabilizada e o estoque de {p.name} será reduzido na mesma operação.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-surface-1 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.stock} unidades disponíveis</p>
                </div>
                <p className="shrink-0 text-sm font-semibold">{formatMoney(p.priceCents)}</p>
              </div>
            </div>

            <div>
              <label htmlFor={`sale-quantity-${p.id}`} className="mb-2 block text-sm font-medium">
                Quantidade vendida
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => changeSaleQuantity(saleQuantity - 1)}
                  disabled={pending || saleQuantity <= 1}
                  aria-label="Diminuir quantidade vendida"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  id={`sale-quantity-${p.id}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={p.stock}
                  value={saleQuantity}
                  onChange={(event) => changeSaleQuantity(Number(event.target.value) || 1)}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-center text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => changeSaleQuantity(saleQuantity + 1)}
                  disabled={pending || saleQuantity >= p.stock}
                  aria-label="Aumentar quantidade vendida"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-primary/10 px-4 py-3">
              <div>
                <p className="text-xs text-muted-foreground">Estoque depois</p>
                <p className="text-sm font-semibold">{p.stock - saleQuantity} unidades</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total da venda</p>
                <p className="text-base font-bold text-primary">
                  {formatMoney(p.priceCents * saleQuantity)}
                </p>
              </div>
            </div>

            {saleError && (
              <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
                {saleError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaleOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="button" onClick={submitSale} disabled={pending || saleQuantity > p.stock}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              Confirmar venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
