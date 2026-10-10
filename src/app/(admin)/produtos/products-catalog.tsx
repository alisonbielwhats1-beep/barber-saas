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
  Loader2,
  Package,
  PackageSearch,
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
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";
import { resolveProductImage } from "@/lib/images";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProductForm } from "./product-form";
import { toggleProductActive, deleteProduct, adjustStock } from "./actions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

const WHOLE_BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
/** Preço do catálogo: sem centavos quando o valor é inteiro ("R$ 72"), com centavos quando não é ("R$ 49,90"). */
function catalogMoney(cents: number) {
  return cents % 100 === 0 ? WHOLE_BRL.format(cents / 100) : formatMoney(cents);
}

/** Grade da tabela do computador: as colunas vêm das variáveis --cols-lg e --cols-xl. */
const GRID_COLS = "lg:[grid-template-columns:var(--cols-lg)] xl:[grid-template-columns:var(--cols-xl)]";
// Produto · (Categoria) · Preço · Margem · Estoque · (Vendidos) · Situação · ⋮ — entre 1024 e 1279 px Categoria e Vendidos descem para a linha do produto.
const COLUMNS = {
  "--cols-lg": "minmax(0,1fr) 88px 72px 120px 128px 36px",
  "--cols-xl": "minmax(200px,1.8fr) minmax(90px,0.8fr) 88px 72px 120px 72px 128px 36px",
} as React.CSSProperties;

function productMargin(p: ProductCard) {
  return p.priceCents > 0 && p.costCents > 0 ? (p.priceCents - p.costCents) / p.priceCents : null;
}

/** Margem do produto: 45% ou mais = boa (lilás), 25% ou mais = atenção (âmbar), abaixo = baixa (vermelho). */
function MarginValue({ m }: { m: number | null }) {
  if (m === null) return <span className="text-xs text-muted-foreground" title="Custo não informado"><span aria-hidden="true">—</span><span className="sr-only">Custo não informado</span></span>;
  const pct = `${(m * 100).toFixed(0)}%`;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold tabular-nums" title={`Margem ${pct}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${m >= 0.45 ? "bg-info" : m >= 0.25 ? "bg-warning" : "bg-danger"}`} />
      <span className="sr-only">Margem </span>{pct}
    </span>
  );
}

function StockBadge({ p, withCount }: { p: ProductCard; withCount?: boolean }) {
  if (p.stock === 0) return <span className="inline-flex min-h-[22px] items-center whitespace-nowrap rounded-full bg-danger/10 px-2.5 text-xs font-medium text-danger">Em falta</span>;
  if (p.stock <= p.minStock) return <span className="inline-flex min-h-[22px] items-center whitespace-nowrap rounded-full bg-warning/15 px-2.5 text-xs font-medium text-warning">Repor{withCount ? ` · ${p.stock}` : ""}</span>;
  return null;
}

function Tag({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return <span className={`inline-flex min-h-[22px] items-center whitespace-nowrap rounded-full bg-muted px-2 text-xs font-medium ${strong ? "text-foreground" : "text-muted-foreground"}`}>{children}</span>;
}

function FilterChip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] border px-[13px] text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8 lg:rounded-lg lg:px-3 ${
        active
          ? "border-primary bg-primary font-semibold text-primary-foreground lg:border-input lg:bg-elevated lg:text-foreground"
          : "border-border-strong font-medium text-foreground hover:bg-card-hover lg:text-muted-foreground lg:hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function ProductsCatalog({ products, movements, enabled = true, initialFilter = "all" }: { products: ProductCard[]; movements: StockMovement[]; enabled?: boolean; initialFilter?: Filter }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean))) as string[];
  const [filter, setFilter] = useState<Filter>(initialFilter);

  const restockCount = products.filter((p) => p.stock <= p.minStock).length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (filter === "restock" && p.stock > p.minStock) return false;
      if (filter === "out" && p.stock > 0) return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.brand ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, search, filter, category]);

  return (
    <div className="flex min-w-0 flex-col gap-3.5 lg:gap-4">
      {/* Ferramentas: no celular busca + "+", situação e categorias em linhas roláveis; no computador uma barra só. */}
      <div className="flex min-w-0 flex-col gap-3.5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2.5">
        <div className="flex min-w-0 items-center gap-2 lg:contents">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-border-strong bg-card px-3 text-muted-foreground focus-within:border-ring lg:h-9 lg:w-72 lg:flex-none">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
            <input
              type="search" inputMode="search" enterKeyHint="search" autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar produto ou marca"
              aria-label="Buscar produto ou marca"
              className="h-full w-full min-w-0 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none lg:text-sm"
            />
          </label>
          {enabled && (
            <ProductForm
              trigger={
                <button
                  type="button"
                  aria-label="Novo produto"
                  title="Novo produto"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground transition-transform active:scale-95 lg:hidden"
                >
                  <Plus aria-hidden="true" className="h-[22px] w-[22px]" strokeWidth={2.2} />
                </button>
              }
            />
          )}
        </div>
        <div role="group" aria-label="Filtros de produtos" className="scrollbar-none -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5 md:-mx-6 md:px-6 lg:mx-0 lg:gap-1.5 lg:overflow-visible lg:px-0">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>Todos</FilterChip>
          <FilterChip active={filter === "restock"} onClick={() => setFilter("restock")}>Repor{restockCount > 0 && ` (${restockCount})`}</FilterChip>
          <FilterChip active={filter === "out"} onClick={() => setFilter("out")}>Em falta</FilterChip>
        </div>
        {categories.length > 0 && (
          <>
            <div role="group" aria-label="Categorias de produtos" className="scrollbar-none -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5 md:-mx-6 md:px-6 lg:hidden">
              <FilterChip active={category === "all"} onClick={() => setCategory("all")}>Todas</FilterChip>
              {categories.map(c => <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>{c}</FilterChip>)}
            </div>
            <label className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground lg:ml-auto lg:flex">
              Categoria
              <select
                value={category}
                aria-label="Categoria de produtos"
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 min-w-0 max-w-56 rounded-lg border border-border-strong bg-card px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">Todas</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center rounded-[14px] border border-border bg-card px-6 py-10 text-center">
          <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><PackageSearch className="h-5 w-5" /></span>
          <p className="mt-3 text-sm font-semibold">Nenhum produto encontrado</p>
          <p className="mt-1 text-sm text-muted-foreground">Ajuste a busca ou limpe os filtros para ver o catálogo.</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => { setSearch(""); setFilter("all"); setCategory("all"); }}
          >
            Limpar filtros
          </Button>
        </div>
      ) : (
        <div aria-label="Lista de produtos" className="min-w-0 overflow-hidden rounded-[14px] border border-border bg-card">
          <div
            aria-hidden="true"
            className={`hidden min-h-9 items-center gap-3 border-b border-border px-4 text-xs font-medium text-muted-foreground lg:grid ${GRID_COLS}`}
            style={COLUMNS}
          >
            <span>Produto</span>
            <span className="hidden xl:block">Categoria</span>
            <span className="text-right">Preço</span>
            <span className="text-right">Margem</span>
            <span className="text-right">Estoque</span>
            <span className="hidden text-right xl:block">Vendidos</span>
            <span>Situação</span>
            <span />
          </div>
          {shown.map((p) => (
            <ProductRow key={p.id} p={p} enabled={enabled} />
          ))}
        </div>
      )}

      <StockHistory movements={movements} />
    </div>
  );
}

/* ── Histórico de movimentações: aberto no computador, recolhido no celular ── */

function StockHistory({ movements }: { movements: StockMovement[] }) {
  const [open, setOpen] = useState(false);
  const shown = movements.slice(0, 15);
  const heading = (
    <span className="min-w-0 flex-1 text-left">
      <span className="block text-sm font-semibold text-foreground">Histórico de movimentações</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">Entradas, perdas e inventários</span>
    </span>
  );
  return (
    <section aria-label="Histórico de movimentações" className="min-w-0 overflow-hidden rounded-[14px] border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:hidden"
      >
        {heading}
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div className="hidden px-4 pb-2 pt-4 lg:flex">{heading}</div>
      <div className={open ? "block" : "hidden lg:block"}>
        {movements.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">As entradas, perdas e inventários aparecerão aqui.</p>
        ) : (
          <>
            {shown.map((movement) => {
              const delta = Number(movement.metadata?.delta ?? 0);
              return (
                <div key={movement.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border px-4 py-2 sm:flex-nowrap">
                  <span className={`grid h-[26px] w-[34px] shrink-0 place-items-center rounded-[7px] text-xs font-semibold tabular-nums ${delta >= 0 ? "bg-info/15 text-info" : "bg-danger/10 text-danger"}`}>
                    {delta >= 0 ? `+${delta}` : delta}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{String(movement.metadata?.productName ?? "Produto")}</p>
                    <p className="break-words text-xs text-muted-foreground">{movement.reason ?? "Sem motivo"} · {movement.actorName}</p>
                  </div>
                  <p className="w-full whitespace-nowrap pl-[46px] text-xs tabular-nums text-muted-foreground sm:w-auto sm:pl-0 sm:text-right">
                    {format(new Date(movement.createdAt), "dd/MM · HH:mm", { locale: ptBR })}
                  </p>
                </div>
              );
            })}
            {movements.length > shown.length && (
              <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">Mostrando as {shown.length} mais recentes de {movements.length}.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ── Linha do produto: lista no celular, linha de tabela no computador; tocar abre a ficha ── */

function ProductRow({ p, enabled }: { p: ProductCard; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const margin = productMargin(p);
  const profit = margin === null ? null : p.priceCents - p.costCents;
  const needRestock = p.stock <= p.minStock;
  const stockPct = Math.max(4, Math.min(100, (p.stock / Math.max(1, p.minStock * 3)) * 100));
  const off = !p.active;
  const imageSrc = resolveProductImage({
    imageUrl: p.imageUrl,
    name: p.name,
    category: p.category,
    index: p.index,
  });

  const [detailOpen, setDetailOpen] = useState(false);
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

  const thumb = (size: "sm" | "md") => (
    <span aria-hidden="true" className={`relative grid shrink-0 place-items-center overflow-hidden bg-muted text-foreground ${size === "sm" ? "h-[34px] w-[34px] rounded-[9px] lg:h-8 lg:w-8" : "h-12 w-12 rounded-xl"} ${off ? "opacity-50" : ""}`}>
      {p.imageUrl ? (
        <ImageWithFallback
          src={imageSrc}
          fallback={<Package className="h-4 w-4" />}
          alt=""
          fill
          sizes="48px"
          className="object-cover"
        />
      ) : <Package className="h-4 w-4" />}
    </span>
  );

  return (
    <div className={`relative flex min-h-[56px] items-center gap-3 border-b border-border px-3.5 py-2 transition-colors last:border-b-0 hover:bg-card-hover lg:grid lg:min-h-[54px] lg:px-4 ${GRID_COLS}`} style={COLUMNS}>
      {/* Produto */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {thumb("sm")}
        <div className="min-w-0 flex-1">
          {/* Botão "esticado": o nome recebe o foco e o ::after cobre a linha toda; o ⋮ fica acima (z-10). */}
          <button
            type="button"
            aria-label={p.name}
            title={p.name}
            onClick={() => setDetailOpen(true)}
            className="block w-full text-left focus-visible:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
          >
            <span className={`block break-words text-sm font-medium leading-snug lg:line-clamp-2 ${off ? "text-muted-foreground" : "text-foreground"}`}>{p.name}</span>
          </button>
          <p className="mt-0.5 break-words text-sm text-muted-foreground lg:line-clamp-2 lg:text-xs">
            {p.brand || "Sem marca"}
            {p.category && <span className="hidden lg:inline xl:hidden"> · {p.category}</span>}
          </p>
          {(off || p.topSeller) && (
            <span className="mt-1.5 flex flex-wrap gap-1.5 lg:hidden">
              {off && <Tag>Pausado</Tag>}
              {p.topSeller && <Tag strong>Mais vendido</Tag>}
            </span>
          )}
        </div>
      </div>

      {/* Categoria */}
      <span className="hidden min-w-0 break-words text-sm text-muted-foreground xl:line-clamp-2" title={p.category ?? undefined}>{p.category || "—"}</span>

      {/* Preço (no celular, com a situação do estoque embaixo) */}
      <span className="flex shrink-0 flex-col items-end gap-1 text-right">
        <span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${off ? "text-muted-foreground" : "text-foreground"}`}>{catalogMoney(p.priceCents)}</span>
        <span className="lg:hidden">
          {needRestock ? <StockBadge p={p} withCount /> : <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{p.stock} em estoque</span>}
        </span>
      </span>

      {/* Margem */}
      <span className="hidden text-right lg:block"><MarginValue m={margin} /></span>

      {/* Estoque */}
      <span className="hidden text-right lg:block">
        <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{p.stock}<span className="text-xs font-normal text-muted-foreground"> / mín. {p.minStock}</span></span>
        <span className="block whitespace-nowrap text-xs tabular-nums text-muted-foreground xl:hidden">{p.sold} vendidos</span>
      </span>

      {/* Vendidos */}
      <span className="hidden text-right text-sm font-semibold tabular-nums xl:block">{p.sold}</span>

      {/* Situação */}
      <span className="hidden flex-wrap items-center gap-1 lg:flex">
        {needRestock ? <StockBadge p={p} /> : <span className="text-sm text-muted-foreground">Em estoque</span>}
        {off && <Tag>Pausado</Tag>}
        {p.topSeller && <Tag strong>Mais vendido</Tag>}
      </span>

      {/* Ações */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={!enabled}
            aria-label={`Mais opções para ${p.name}`}
            className="relative z-10 -mr-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 lg:mr-0 lg:h-9 lg:w-9 lg:rounded-[9px]"
          >
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
          <DropdownMenuItem onSelect={() => setStockDialog(true)}>
            <PackagePlus className="mr-2 h-3.5 w-3.5" /> Movimentar estoque
          </DropdownMenuItem>
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

      {/* Ficha do produto */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 pr-8">
              {thumb("md")}
              <div className="min-w-0">
                <DialogTitle className="break-words text-lg leading-snug">{p.name}</DialogTitle>
                <DialogDescription className="mt-0.5 break-words">{p.brand || "Sem marca"}{p.category ? ` · ${p.category}` : ""}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap gap-1.5">
              {needRestock ? <StockBadge p={p} /> : <Tag>Em estoque</Tag>}
              {off && <Tag>Pausado</Tag>}
              {p.topSeller && <Tag strong>Mais vendido</Tag>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="Margem" value={<MarginValue m={margin} />} />
              <Metric label={profit === null ? "Custo" : "Resultado/un"} value={profit === null ? "não informado" : formatMoney(profit)} />
              <Metric label="Vendidos" value={p.sold.toString()} />
            </div>

            {/* Estoque com barra e ajuste rápido */}
            <div className="flex flex-col gap-2.5 rounded-xl border border-border p-3.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Estoque</span>
                <span className={`font-semibold tabular-nums ${needRestock ? "text-warning" : ""}`}>
                  {p.stock} un · mín {p.minStock}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => run(() => adjustStock(p.id, -1, { reason: "Ajuste rápido de saída", kind: "ADJUSTMENT" }))}
                  disabled={!enabled || pending || p.stock === 0}
                  aria-label={`Diminuir estoque de ${p.name}`}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-border-strong text-foreground transition-colors hover:bg-card-hover disabled:opacity-40 lg:h-9 lg:w-9 lg:rounded-[9px]"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${needRestock ? "bg-warning" : "bg-muted-foreground"}`} style={{ width: `${stockPct}%` }} />
                </div>
                <button
                  type="button"
                  onClick={() => run(() => adjustStock(p.id, 1, { reason: "Ajuste rápido de entrada", kind: "ADJUSTMENT" }))}
                  disabled={!enabled || pending}
                  aria-label={`Aumentar estoque de ${p.name}`}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-border-strong text-foreground transition-colors hover:bg-card-hover disabled:opacity-40 lg:h-9 lg:w-9 lg:rounded-[9px]"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <Button type="button" variant="outline" disabled={!enabled} onClick={() => setStockDialog(true)} className="w-full">
                <PackagePlus className="h-4 w-4" /> Movimentar estoque
              </Button>
            </div>

            {(p.supplier || p.expiresAt) && (
              <dl className="rounded-xl border border-border px-3.5">
                {p.supplier && <div className="flex min-h-11 items-center justify-between gap-3 text-sm"><dt className="text-muted-foreground">Fornecedor</dt><dd className="min-w-0 break-words text-right">{p.supplier}</dd></div>}
                {p.expiresAt && <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border text-sm first:border-t-0"><dt className="text-muted-foreground">Validade</dt><dd className="tabular-nums">{format(new Date(p.expiresAt), "MMM/yy", { locale: ptBR })}</dd></div>}
              </dl>
            )}

            {enabled && (
              <ProductForm
                product={p}
                trigger={<Button type="button" className="w-full"><Pencil className="h-4 w-4" /> Editar produto</Button>}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={stockDialog} onOpenChange={setStockDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Movimentar estoque</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="break-words text-sm text-muted-foreground">{p.name} · saldo atual <strong className="font-semibold tabular-nums text-foreground">{p.stock} un</strong></p>
            <div><label htmlFor={`kind-${p.id}`} className="mb-1.5 block text-sm font-medium text-muted-foreground">Tipo</label><select id={`kind-${p.id}`} value={stockKind} onChange={(event) => setStockKind(event.target.value as typeof stockKind)} className="h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-base lg:text-sm"><option value="PURCHASE">Entrada por compra</option><option value="LOSS">Perda ou descarte</option><option value="INVENTORY">Correção de inventário</option><option value="ADJUSTMENT">Outro ajuste</option></select></div>
            <div><label htmlFor={`quantity-${p.id}`} className="mb-1.5 block text-sm font-medium text-muted-foreground">Quantidade</label><input id={`quantity-${p.id}`} type="number" min="1" value={stockDelta} onChange={(event) => setStockDelta(event.target.value)} className="h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-base tabular-nums lg:text-sm" /></div>
            <div><label htmlFor={`reason-${p.id}`} className="mb-1.5 block text-sm font-medium text-muted-foreground">Motivo (opcional)</label><input id={`reason-${p.id}`} value={stockReason} onChange={(event) => setStockReason(event.target.value)} placeholder="Ex.: Nota 123 do fornecedor" className="h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-base lg:text-sm" /></div>
            <Button type="button" disabled={!enabled || pending || Number(stockDelta) < 1} onClick={() => run(async () => { const quantity = Math.max(1, Math.floor(Number(stockDelta))); const sign = stockKind === "LOSS" ? -1 : 1; await adjustStock(p.id, sign * quantity, { reason: stockReason, kind: stockKind }); setStockDialog(false); setStockReason(""); }, "Movimentação registrada")} className="w-full lg:min-h-10">{pending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar movimentação</Button>
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

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background px-1 py-2.5">
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
