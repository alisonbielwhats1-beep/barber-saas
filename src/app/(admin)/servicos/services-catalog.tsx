"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  MoreVertical,
  Copy,
  Power,
  Trash2,
  Pencil,
  Users,
  LayoutGrid,
  List,
  Loader2,
  Plus,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatMoney } from "@/lib/utils";
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

const WHOLE_BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Preço do catálogo: sem centavos quando o valor é inteiro ("R$ 120"), com centavos quando não é ("R$ 49,90"). */
export function catalogMoney(cents: number) {
  return cents % 100 === 0 ? WHOLE_BRL.format(cents / 100) : formatMoney(cents);
}

/** Grade da tabela do computador: as colunas vêm das variáveis --cols-lg e --cols-xl de cada tela. */
const GRID_COLS = "lg:[grid-template-columns:var(--cols-lg)] xl:[grid-template-columns:var(--cols-xl)]";

function margin(s: ServiceCard) {
  return s.priceCents > 0 && s.costCents > 0 ? (s.priceCents - s.costCents) / s.priceCents : null;
}

/** Margem do serviço: 50% ou mais = boa (lilás), 30% ou mais = atenção (âmbar), abaixo = baixa (vermelho). */
function marginDot(m: number) {
  return m >= 0.5 ? "bg-info" : m >= 0.3 ? "bg-warning" : "bg-danger";
}

function prosLabel(count: number) {
  if (count === 0) return "Sem profissional";
  return `${count} ${count === 1 ? "profissional" : "profissionais"}`;
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
  // A grade (com a foto da categoria) continua disponível no computador.
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

  // Colunas do computador: Serviço · Duração · Quem faz · (Margem e vendas) · Preço · (⋮).
  // Entre 1024 e 1279 px a coluna Duração some e a duração desce para baixo do nome.
  const tail = (canSeeFinancial ? ["124px"] : []).concat(["112px"], canManage ? ["36px"] : []);
  const columns = {
    "--cols-lg": ["minmax(0,2fr)", "minmax(120px,1fr)"].concat(tail).join(" "),
    "--cols-xl": ["minmax(200px,2fr)", "76px", "minmax(140px,1fr)"].concat(tail).join(" "),
  } as React.CSSProperties;

  return (
    <div className="flex min-w-0 flex-col gap-3.5 lg:gap-4">
      {/* Ferramentas: no celular busca + "+" numa linha, categorias roláveis e a linha de contagem/ordem;
          no computador tudo numa barra só. */}
      <div className="flex min-w-0 flex-col gap-3.5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2.5">
        <div className="flex min-w-0 items-center gap-2 lg:contents">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-border-strong bg-card px-3 text-muted-foreground focus-within:border-ring lg:h-9 lg:w-60 lg:flex-none">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
            <input
              type="search" inputMode="search" enterKeyHint="search" autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar serviço"
              aria-label="Buscar serviço"
              className="h-full w-full min-w-0 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none lg:text-sm"
            />
          </label>
          {canManage && (
            <ServiceForm
              trigger={
                <button
                  type="button"
                  aria-label="Novo serviço"
                  title="Novo serviço"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground transition-transform active:scale-95 lg:hidden"
                >
                  <Plus aria-hidden="true" className="h-[22px] w-[22px]" strokeWidth={2.2} />
                </button>
              }
            />
          )}
        </div>

        <div
          role="group"
          aria-label="Categorias de serviços"
          className="scrollbar-none -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5 md:-mx-6 md:px-6 lg:mx-0 lg:flex-wrap lg:gap-1.5 lg:overflow-visible lg:px-0"
        >
          {categories.map((c) => (
            <FilterChip key={c} active={activeCategory === c} onClick={() => setCategory(c)}>
              {c === "all" ? "Todas" : c}
            </FilterChip>
          ))}
        </div>

        <div className="flex min-w-0 items-center justify-between gap-3 lg:ml-auto lg:justify-end">
          <span className="shrink-0 text-sm text-muted-foreground lg:hidden">
            {filtered.length} {filtered.length === 1 ? "serviço" : "serviços"}
          </span>
          <label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="shrink-0">Ordenar</span>
            <select
              value={sort}
              aria-label="Ordenar serviços"
              onChange={(e) => setSort(e.target.value as Sort)}
              className="h-11 min-w-0 rounded-[10px] border border-border-strong bg-card px-2.5 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-9 lg:rounded-lg lg:text-sm"
            >
              {canSeeFinancial && <option value="popular">Mais vendidos</option>}
              <option value="price">Maior preço</option>
              {canSeeFinancial && <option value="margin">Maior margem</option>}
              <option value="name">Nome (A-Z)</option>
            </select>
          </label>
          <SegmentedControl
            className="hidden lg:flex"
            stretch={false}
            ariaLabel="Visualização do catálogo"
            value={view}
            onChange={setView}
            options={[
              { value: "list", ariaLabel: "Vista em lista (compacta)", label: <List aria-hidden="true" className="h-4 w-4" /> },
              { value: "grid", ariaLabel: "Vista em grade (com imagens)", label: <LayoutGrid aria-hidden="true" className="h-4 w-4" /> },
            ]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Nenhum serviço encontrado.
        </div>
      ) : (
        <div
          aria-label="Lista de serviços"
          className="flex min-w-0 flex-col gap-3.5 lg:gap-0 lg:overflow-hidden lg:rounded-[14px] lg:border lg:border-border lg:bg-card"
        >
          <div
            aria-hidden="true"
            className={`hidden min-h-9 items-center gap-3 border-b border-border px-4 text-xs font-medium text-muted-foreground lg:grid ${GRID_COLS}`}
            style={columns}
          >
            <span>Serviço</span>
            <span className="hidden xl:block">Duração</span>
            <span>Quem faz</span>
            {canSeeFinancial && <span className="text-right">Margem e vendas</span>}
            <span className="text-right">Preço</span>
            {canManage && <span />}
          </div>
          {groups.map(({ cat, items }) => (
            <CategoryGroup
              key={cat}
              cat={cat}
              items={items}
              view={view}
              columns={columns}
              canManage={canManage}
              canSeeFinancial={canSeeFinancial}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
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

/* ── Grupo da categoria: no celular um título e um cartão; no computador uma faixa dentro da tabela ── */

function CategoryGroup({
  cat,
  items,
  view,
  columns,
  canManage,
  canSeeFinancial,
}: {
  cat: string;
  items: ServiceCard[];
  view: View;
  columns: React.CSSProperties;
  canManage: boolean;
  canSeeFinancial: boolean;
}) {
  const totalSold = items.reduce((s, i) => s + i.sold, 0);
  const totalRevenue = items.reduce((s, i) => s + i.revenueCents, 0);
  const categoryImage = normalizeImageUrl(items.find((item) => item.imageUrl)?.imageUrl) ?? bannerForCategory(cat);
  const count = `${items.length}${canSeeFinancial ? ` · ${totalSold} ${totalSold === 1 ? "venda" : "vendas"}` : ""}`;

  return (
    <section aria-label={cat} className="min-w-0 lg:border-b lg:border-border lg:last:border-b-0">
      {view === "grid" && (
        <div className="relative hidden h-28 w-full overflow-hidden border-b border-border lg:block">
          <ImageWithFallback
            src={categoryImage}
            fallbackSrc={bannerForCategory(cat)}
            alt=""
            fill
            sizes="900px"
            className="object-cover object-center"
            priority={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <p className="absolute inset-x-0 bottom-0 px-4 pb-3 text-xs text-white/80">
            {items.length} {items.length === 1 ? "serviço" : "serviços"}
            {canSeeFinancial && totalSold > 0 && ` · ${totalSold} vendas · ${formatMoney(totalRevenue)}`}
          </p>
        </div>
      )}
      <div className="mx-0.5 mb-2 flex items-baseline justify-between gap-3 lg:m-0 lg:border-b lg:border-border lg:px-4 lg:py-2">
        <h2 className="min-w-0 break-words text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground lg:normal-case lg:tracking-normal">
          {cat}
        </h2>
        <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">{count}</span>
      </div>
      <div className="overflow-hidden rounded-[14px] border border-border bg-card lg:rounded-none lg:border-0 lg:bg-transparent">
        {items.map((s) => (
          <ServiceRow
            key={s.id}
            s={s}
            columns={columns}
            canManage={canManage}
            canSeeFinancial={canSeeFinancial}
          />
        ))}
      </div>
    </section>
  );
}

/* ── Linha do serviço: lista no celular, linha de tabela no computador (mesmo DOM) ── */

function MarginValue({ m, verbose }: { m: number | null; verbose?: boolean }) {
  if (m === null) {
    return (
      <span className="text-xs font-medium text-muted-foreground" title="Custo não informado">
        {verbose ? "custo não informado" : <><span aria-hidden="true">—</span><span className="sr-only">Custo não informado</span></>}
      </span>
    );
  }
  const pct = `${Math.round(m * 100)}%`;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold tabular-nums text-foreground" title={`Margem ${pct}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${marginDot(m)}`} />
      <span className="sr-only">Margem </span>{pct}
    </span>
  );
}

function ServiceRow({
  s,
  columns,
  canManage,
  canSeeFinancial,
}: {
  s: ServiceCard;
  columns: React.CSSProperties;
  canManage: boolean;
  canSeeFinancial: boolean;
}) {
  const m = margin(s);
  const off = !s.active;
  const color = s.colorHex ?? "hsl(var(--muted-foreground))";
  // O mesmo estado abre a edição pela linha e pelo menu ⋮ > Editar.
  const [editOpen, setEditOpen] = useState(false);
  const rowButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  function openEdit(from: HTMLElement | null) {
    opener.current = from;
    setEditOpen(true);
  }
  const nameClass = `block break-words text-sm font-medium leading-snug lg:line-clamp-2 ${off ? "text-muted-foreground" : "text-foreground"}`;
  return (
    <div
      className={`relative flex min-h-[54px] items-center gap-3 border-b border-border px-3.5 py-2 last:border-b-0 lg:grid lg:min-h-[52px] lg:px-4 ${GRID_COLS} ${
        canManage ? "transition-colors hover:bg-card-hover" : ""
      }`}
      style={columns}
    >
      {/* Serviço */}
      <div className="flex min-w-0 flex-1 items-center gap-3 self-stretch lg:gap-2.5 lg:self-auto">
        <span aria-hidden="true" className={`w-1 shrink-0 self-stretch rounded lg:hidden ${off ? "opacity-50" : ""}`} style={{ background: color }} />
        <span aria-hidden="true" className={`hidden h-2 w-2 shrink-0 rounded-full lg:block ${off ? "opacity-50" : ""}`} style={{ background: color }} />
        <div className="min-w-0 flex-1 py-0.5">
          {canManage ? (
            // Botão "esticado": só o nome recebe o foco, mas o ::after cobre a linha toda e o ⋮ fica acima (z-10).
            <button
              ref={rowButton}
              type="button"
              aria-label={`Editar ${s.name}`}
              title={s.name}
              onClick={() => openEdit(rowButton.current)}
              className="block w-full cursor-pointer text-left focus-visible:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
            >
              <span className={nameClass}>{s.name}</span>
            </button>
          ) : (
            <p className={nameClass} title={s.name}>{s.name}</p>
          )}
          <p className="mt-0.5 break-words text-sm text-muted-foreground lg:hidden">
            <span className="tabular-nums">{s.durationMin} min</span> · {prosLabel(s.proCount)}
          </p>
          <p className="mt-0.5 hidden text-xs tabular-nums text-muted-foreground lg:block xl:hidden">{s.durationMin} min</p>
          {off && (
            <span className="mt-1.5 inline-flex min-h-[22px] items-center rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">
              Pausado
            </span>
          )}
        </div>
      </div>

      {/* Duração */}
      <span className="hidden text-sm tabular-nums text-muted-foreground xl:block">{s.durationMin} min</span>

      {/* Quem faz */}
      <span className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground lg:flex" title="Profissionais que fazem este serviço">
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted">
          <Users className="h-4 w-4" />
        </span>
        <span className="min-w-0 truncate">{prosLabel(s.proCount)}</span>
      </span>

      {/* Margem e vendas */}
      {canSeeFinancial && (
        <span className="hidden flex-col items-end gap-0.5 text-right lg:flex">
          <MarginValue m={m} verbose />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {s.sold} {s.sold === 1 ? "venda" : "vendas"}
          </span>
        </span>
      )}

      {/* Preço (no celular, com a margem embaixo) */}
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <span className={`text-sm font-semibold tabular-nums ${off ? "text-muted-foreground" : "text-foreground"}`}>
          {s.priceType === "FROM" && <span className="lg:block lg:text-xs lg:font-normal lg:text-muted-foreground">A partir de </span>}
          <span className="whitespace-nowrap">{catalogMoney(s.priceCents)}</span>
        </span>
        {canSeeFinancial && <span className="lg:hidden"><MarginValue m={m} /></span>}
      </span>

      {canManage && <ActionsMenu s={s} triggerRef={menuButton} onEdit={() => openEdit(menuButton.current)} />}
      {canManage && (
        <ServiceForm
          service={s}
          open={editOpen}
          onOpenChange={setEditOpen}
          restoreFocus={() => (opener.current?.isConnected ? opener.current : rowButton.current)?.focus()}
        />
      )}
    </div>
  );
}

/* ── Menu de ações ────────────────────────────────────────────────────── */

function ActionsMenu({ s, triggerRef, onEdit }: { s: ServiceCard; triggerRef: React.Ref<HTMLButtonElement>; onEdit: () => void }) {
  const router = useRouter();
  const choseEdit = useRef(false);
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
          <button
            ref={triggerRef}
            type="button"
            aria-label={`Mais opções para ${s.name}`}
            className="relative z-10 -mr-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:mr-0 lg:h-9 lg:w-9 lg:rounded-[9px]"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // Ao escolher Editar, o foco é do formulário (que devolve ao ⋮ ao fechar), não do menu.
          onCloseAutoFocus={(event) => { if (choseEdit.current) { event.preventDefault(); choseEdit.current = false; } }}
        >
          <DropdownMenuItem onSelect={() => { choseEdit.current = true; onEdit(); }}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
          </DropdownMenuItem>
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
