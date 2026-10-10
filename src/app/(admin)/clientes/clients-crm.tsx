"use client";
import { Button } from "@/components/ui/button";

import { Root as Tabs, List as TabsList, Trigger as TabsTrigger, Content as TabsContent } from "@radix-ui/react-tabs";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { useMediaQuery } from "@/components/ui/use-media-query";
import {
  Search, Phone, MessageCircle, Crown, Cake, ChevronRight, Loader2, ShieldCheck, FileUp, Gift, X, GitMerge,
  AlertTriangle, MoreHorizontal, UserX, Users, Undo2,
} from "lucide-react";
import { cn, formatMoney } from "@/lib/utils";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { ClientForm } from "./client-form";
import { deleteClient, restoreClient, fetchClientHistory, importClientsCsv, mergeClients, redeemLoyaltyReward } from "./actions";
import { toast } from "@/components/ui/toast";
import type { ClientRow } from "@/lib/crm";

export type ClientSegment = "all" | "vip" | "birthday" | "lapsed" | "recurring";
type HistoryItem = { id: string; startAt: string; priceCents: number; status: string; serviceName: string; serviceColor: string | null; proName: string };
const HISTORY_PREVIEW_COUNT = 3;
/** From 1024px the list and the client's profile share the screen (prototype v6); below it the profile opens as a sheet. */
const DESKTOP_QUERY = "(min-width: 1024px)";
/** Same values the redeem action has always received (cost in points and the reward's label). */
const LOYALTY_REWARD_COST = 5;
const LOYALTY_REWARD_LABEL = "R$ 10 de desconto";

const wholeMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
/** Summaries and indicators show whole reais, as in the prototype; visit lists keep the cents. */
function formatWholeMoney(cents: number) {
  return wholeMoney.format(cents / 100);
}

function daysAgo(days: number | null) {
  return days == null ? "nunca" : days === 0 ? "hoje" : `${days}d atrás`;
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function plural(count: number, one: string, many: string) {
  return `${count}\u00a0${count === 1 ? one : many}`;
}

function GenderBadge({ gender, source }: { gender: "MALE" | "FEMALE" | "OTHER" | null; source: "confirmed" | "inferred" | null }) {
  if (gender !== "MALE" && gender !== "FEMALE") return null;
  const letter = gender === "MALE" ? "M" : "F";
  const label = gender === "MALE" ? "Masculino" : "Feminino";
  return (
    <span
      role="img"
      aria-label={label}
      title={source === "inferred" ? `${label} (estimado pelo nome, confira em Editar)` : label}
      className={cn(
        "inline-grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border text-xs font-semibold leading-none text-muted-foreground",
        source === "inferred" ? "border-dashed border-muted-foreground/60" : "border-border-strong",
      )}
    >
      <span aria-hidden="true">{letter}</span>
    </span>
  );
}

type PillTone = "neutral" | "selection" | "warning" | "danger";
const PILL_TONES: Record<PillTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  selection: "bg-[hsl(var(--selection))] text-[hsl(var(--selection-foreground))]",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
};

/** Status label: text on a soft background (never color alone). A span, so it can sit inside a row button. */
function Pill({ tone, children, className }: { tone: PillTone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex min-h-[22px] items-center whitespace-nowrap rounded-full px-[9px] text-xs font-medium", PILL_TONES[tone], className)}>{children}</span>;
}

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-foreground", large ? "h-14 w-14 text-base" : "h-10 w-10 text-sm")}>
      {initials(name)}
    </span>
  );
}

function waLink(phone: string | null, first: string, salonName: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const full = digits.length <= 11 ? `55${digits}` : digits;
  const msg = `Olá ${first}! Aqui é do ${salonName}. Tudo bem? 💈`;
  return `https://wa.me/${full}?text=${encodeURIComponent(msg)}`;
}

export function ClientsCrm({
  clients,
  salonName,
  timezone,
  canManage,
  canDelete = false,
  showExcluded = false,
  lapsedClientDays,
  initialSegment = "all",
  indicators,
  returnOpportunities,
}: {
  clients: ClientRow[];
  salonName: string;
  timezone: string;
  canManage: boolean;
  canDelete?: boolean;
  showExcluded?: boolean;
  lapsedClientDays: number;
  initialSegment?: ClientSegment;
  /** Base indicators (strip on the computer, collapsible card on the phone). */
  indicators?: React.ReactNode;
  /** "Retornos previstos" card (owner and manager). */
  returnOpportunities?: React.ReactNode;
}) {
  const router = useRouter();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [visibilityTarget, setVisibilityTarget] = useState<ClientRow | null>(null);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const visibilityLock = useRef(false);
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<ClientSegment>(initialSegment);
  const [selectedDetail, setDetail] = useState<ClientRow | null>(null);
  const detail = selectedDetail ? clients.find(client => client.id === selectedDetail.id) ?? selectedDetail : null;
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequest = useRef(0);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [mergeCandidate, setMergeCandidate] = useState<{ source: ClientRow; target: ClientRow } | null>(null);

  async function saveVisibility() {
    if (!visibilityTarget || visibilityLock.current) return;
    visibilityLock.current = true;
    setSavingVisibility(true);
    try {
      await (showExcluded ? restoreClient : deleteClient)(visibilityTarget.id);
      // On the computer the profile stays beside the list: clear it, since the client leaves this list.
      if (selectedDetail?.id === visibilityTarget.id) setDetail(null);
      setVisibilityTarget(null);
      toast(showExcluded ? "Cliente restaurado à lista." : "Cliente excluído da lista. O acesso foi preservado.");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Não foi possível atualizar a lista.", "error");
    } finally {
      visibilityLock.current = false;
      setSavingVisibility(false);
    }
  }

  function requestVisibility(client: ClientRow) {
    setVisibilityTarget(client);
    // The phone profile is a sheet: it closes so the confirmation is the only window.
    if (!isDesktop) setDetail(null);
  }

  function importCsv() {
    startTransition(async () => {
      const result = await importClientsCsv(csv);
      if (!("success" in result)) toast(result.error, "error");
      else { toast(`${result.imported} clientes importados${result.skipped ? ` · ${result.skipped} duplicados ignorados` : ""}`); setCsv(""); setImportOpen(false); router.refresh(); }
    });
  }

  function redeem(client: ClientRow) {
    startTransition(async () => {
      const result = await redeemLoyaltyReward(client.id, LOYALTY_REWARD_COST, LOYALTY_REWARD_LABEL);
      if ("error" in result && result.error) toast(result.error, "error");
      else { toast(`Recompensa resgatada: ${LOYALTY_REWARD_LABEL}`); if (!isDesktop) setDetail(null); router.refresh(); }
    });
  }

  const openDetail = useCallback(async (c: ClientRow) => {
    const request = ++historyRequest.current;
    setDetail(c);
    setHistoryError(null);
    setHistory(null);
    setHistoryExpanded(false);
    setLoadingHist(true);
    try {
      const items = await fetchClientHistory(c.id);
      if (request === historyRequest.current) setHistory(items);
    } catch {
      if (request === historyRequest.current) setHistoryError("Não foi possível carregar os atendimentos.");
    } finally {
      if (request === historyRequest.current) setLoadingHist(false);
    }
  }, []);

  function merge(source: ClientRow, target: ClientRow) {
    startTransition(async () => {
      try {
        await mergeClients(source.id, target.id);
        toast(`Cadastros mesclados em ${target.name}.`);
        setMergeCandidate(null);
        // Computer: show the record that stayed; phone: close the sheet, as before.
        if (isDesktop) void openDetail(target);
        else setDetail(null);
        router.refresh();
      } catch (error) {
        toast(error instanceof Error ? error.message : "Não foi possível mesclar os cadastros.", "error");
      }
    });
  }

  const counts = useMemo(() => ({
    vip: clients.filter((c) => c.isVip).length,
    birthday: clients.filter((c) => c.birthdayThisMonth).length,
    lapsed: clients.filter((c) => c.isLapsed).length,
    recurring: clients.filter((c) => c.visits >= 2).length,
  }), [clients]);

  const shown = useMemo(() => {
    const q = search.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return clients.filter((c) => {
      if (segment === "vip" && !c.isVip) return false;
      if (segment === "birthday" && !c.birthdayThisMonth) return false;
      if (segment === "lapsed" && !c.isLapsed) return false;
      if (segment === "recurring" && c.visits < 2) return false;
      if (q && !c.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q) && !(q.replace(/\D/g, "") && (c.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "")))) return false;
      return true;
    });
  }, [clients, search, segment]);

  // Computer: the profile column is never empty while the list has clients (prototype v6 opens the first one).
  useEffect(() => {
    if (!isDesktop || selectedDetail || shown.length === 0) return;
    void openDetail(shown[0]);
  }, [isDesktop, selectedDetail, shown, openDetail]);

  const segments: { value: ClientSegment; label: string; count?: number }[] = [
    { value: "all", label: "Todos" },
    { value: "vip", label: "VIP", count: counts.vip },
    { value: "birthday", label: "Aniversariantes", count: counts.birthday },
    { value: "lapsed", label: `Sumidos ${lapsedClientDays}d+`, count: counts.lapsed },
    { value: "recurring", label: "Recorrentes", count: counts.recurring },
  ];

  const listMenu: SheetAction[] = [
    ...(canManage ? [{ key: "import", label: "Importar planilha", description: "CSV ou texto: nome, telefone, e-mail e aniversário", icon: FileUp, onSelect: () => setImportOpen(true) }] : []),
    ...(canDelete ? [{ key: "excluded", label: showExcluded ? "Ver clientes ativos" : "Ver clientes excluídos", icon: showExcluded ? Users : UserX, href: showExcluded ? "/clientes" : "/clientes?status=excluded" }] : []),
  ];
  const excludedHref = showExcluded ? "/clientes" : "/clientes?status=excluded";
  const excludedLabel = showExcluded ? "Ver clientes ativos" : "Ver clientes excluídos";
  const emptyTitle = showExcluded && !search.trim() && segment === "all" ? "Nenhum cliente excluído." : "Nenhum cliente neste filtro.";

  const profileProps = detail ? {
    client: detail,
    timezone,
    salonName,
    canManage,
    canDelete,
    showExcluded,
    history,
    loadingHist,
    historyError,
    historyExpanded,
    pending,
    onToggleHistory: () => setHistoryExpanded((open) => !open),
    onRetry: () => void openDetail(detail),
    onRedeem: () => redeem(detail),
    onMerge: setMergeCandidate,
    onVisibility: () => requestVisibility(detail),
  } : null;

  return (
    // Phone: one column (title, fixed search, groups, cards, list). Computer: header, indicators and returns span the
    // page; search, groups and list share the left column and the client's profile fills the right one.
    <div className="client-directory flex min-w-0 flex-col gap-3 pb-16 md:pb-0 lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-[repeat(7,auto)_1fr] lg:items-start lg:gap-x-[18px] lg:gap-y-0 xl:grid-cols-[390px_minmax(0,1fr)]">
      <div className="min-w-0 lg:col-span-2 lg:row-start-1 lg:mb-[18px]">
        <header className="flex flex-wrap items-end justify-between gap-2 md:gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">Clientes</h1>
              <p className="hidden text-sm text-muted-foreground lg:block">
                {showExcluded ? plural(clients.length, "cliente excluído", "clientes excluídos") : `${clients.length} cadastrados`}
              </p>
            </div>
            <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-muted px-[9px] text-xs font-medium tabular-nums text-muted-foreground lg:hidden">
              <span aria-hidden="true">{clients.length}</span>
              <span className="sr-only">{showExcluded ? plural(clients.length, "cliente excluído", "clientes excluídos") : plural(clients.length, "cliente", "clientes")}</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canManage && (
              <Button type="button" variant="outline" className="hidden lg:inline-flex" onClick={() => setImportOpen((open) => !open)}>
                <FileUp className="h-4 w-4" aria-hidden /> Importar planilha
              </Button>
            )}
            {canDelete && (
              <Button asChild variant="outline" className="hidden lg:inline-flex">
                <Link href={excludedHref}>{excludedLabel}</Link>
              </Button>
            )}
            {/* "Novo cliente": header button on the computer, floating button on the phone. */}
            {canManage && <ClientForm />}
          </div>
        </header>
      </div>

      <div className="sticky top-[3.25rem] z-20 -mx-4 -my-2 bg-background px-4 py-2 sm:-mx-5 sm:px-5 md:-mx-6 md:px-6 lg:static lg:z-auto lg:col-start-1 lg:row-start-6 lg:m-0 lg:mb-3 lg:bg-transparent lg:p-0">
        <div className="flex items-center gap-2">
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-border-strong bg-card px-3 text-muted-foreground transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25 lg:min-h-10 lg:rounded-[9px]">
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar cliente ou telefone" placeholder="Buscar por nome ou telefone" className="h-11 w-full min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none lg:h-10 lg:text-sm" />
          </label>
          {listMenu.length > 0 && (
            <button type="button" aria-label="Mais opções de clientes" title="Mais opções" onClick={() => setListMenuOpen(true)} className="press grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-border-strong text-foreground hover:bg-card-hover lg:hidden">
              <MoreHorizontal className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div role="group" aria-label="Grupos de clientes" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5 md:-mx-6 md:px-6 lg:col-start-1 lg:row-start-7 lg:mx-0 lg:mb-3 lg:flex-wrap lg:gap-1.5 lg:overflow-visible lg:px-0">
        {segments.map((item) => (
          <SegmentChip key={item.value} active={segment === item.value} onClick={() => setSegment(item.value)}>
            <span>{item.label}{item.count !== undefined && <> · <span className="tabular-nums">{item.count}</span></>}</span>
          </SegmentChip>
        ))}
      </div>

      {showExcluded && (
        <div className="flex flex-col gap-3 lg:col-span-2 lg:row-start-2 lg:mb-[18px]">
          <p role="note" className="rounded-xl border border-border-strong bg-card px-3.5 py-3 text-sm text-muted-foreground">Clientes excluídos da lista. O acesso e o histórico continuam preservados.</p>
          {canDelete && <Button asChild variant="outline" className="w-full lg:hidden"><Link href="/clientes">Ver clientes ativos</Link></Button>}
        </div>
      )}

      {indicators && <div className="min-w-0 lg:col-span-2 lg:row-start-3 lg:mb-[18px]">{indicators}</div>}
      {returnOpportunities && <div className="min-w-0 lg:col-span-2 lg:row-start-4 lg:mb-[18px]">{returnOpportunities}</div>}

      {importOpen && (
        <section aria-label="Importar clientes por CSV" className="space-y-3 rounded-[14px] border border-border bg-card p-4 lg:col-span-2 lg:row-start-5 lg:mb-[18px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Importar clientes por CSV</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Colunas aceitas: nome, telefone, email e aniversario. Duplicados são ignorados.</p>
            </div>
            <button type="button" onClick={() => setImportOpen(false)} aria-label="Fechar importação" className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card-hover hover:text-foreground lg:h-9 lg:w-9"><X className="h-4 w-4" aria-hidden /></button>
          </div>
          <input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setCsv); }} className="block w-full text-sm text-muted-foreground file:mr-3 file:min-h-11 file:rounded-[10px] file:border file:border-solid file:border-border-strong file:bg-transparent file:px-3 file:text-sm file:font-medium file:text-foreground lg:file:min-h-9" />
          <textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={4} placeholder={'nome,telefone,email,aniversario\nAna,11999990000,ana@email.com,1990-08-20'} className="w-full rounded-[10px] border border-border-strong bg-background px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 lg:text-sm" />
          <div className="flex justify-end">
            <Button type="button" onClick={importCsv} disabled={pending || !csv.trim()} className="w-full sm:w-auto">{pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Importar clientes</Button>
          </div>
        </section>
      )}

      <div aria-label="Lista de clientes" className="overflow-hidden rounded-[14px] border border-border bg-card lg:col-start-1 lg:row-start-8 lg:max-h-[640px] lg:overflow-y-auto">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground"><Users className="h-5 w-5" aria-hidden /></span>
            <p className="text-sm font-semibold">{emptyTitle}</p>
            <p className="text-sm text-muted-foreground">Busque pelo nome ou pelos números do telefone.</p>
          </div>
        ) : (
          shown.map((c) => {
            const selected = isDesktop && detail?.id === c.id;
            return (
              <div key={c.id} className={cn("flex items-center border-b border-border transition-colors last:border-b-0", selected ? "bg-[hsl(var(--border))]" : "hover:bg-card-hover")}>
                <button type="button" onClick={() => openDetail(c)} aria-current={selected ? "true" : undefined} className="press-row flex min-h-[54px] min-w-0 flex-1 items-center gap-3 py-2 pl-3.5 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:pr-3.5">
                  <Avatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="min-w-0 truncate text-sm font-medium" title={c.name}>{c.name}</p>
                      <GenderBadge gender={c.genderDisplay} source={c.genderSource} />
                      {c.isVip && <Crown role="img" aria-label="Cliente VIP" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      {c.birthdayThisMonth && <Cake role="img" aria-label="Aniversário neste mês" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    </div>
                    <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">{c.phone || "Sem telefone"}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {c.visits} {c.visits === 1 ? "atendimento" : "atendimentos"}{c.favoritePro ? ` · ${c.favoritePro.split(" ")[0]}` : ""}
                    </p>
                    {(c.isLapsed || c.possibleDuplicates.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.isLapsed && <Pill tone="danger">Sumido</Pill>}
                        {c.possibleDuplicates.length > 0 && <Pill tone="warning">Possível duplicata</Pill>}
                      </div>
                    )}
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-0.5 text-right lg:flex">
                    <span className="text-sm font-medium tabular-nums"><span className="sr-only">LTV </span>{formatWholeMoney(c.totalSpent)}</span>
                    <span className="text-xs tabular-nums text-muted-foreground"><span className="sr-only">Última visita: </span>{daysAgo(c.daysSince)}</span>
                  </div>
                </button>
                <button type="button" aria-label={`Ver detalhes de ${c.name}`} onClick={() => openDetail(c)} className="mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground lg:hidden"><ChevronRight size={16} aria-hidden /></button>
              </div>
            );
          })
        )}
      </div>

      <section aria-label="Ficha do cliente" className="hidden min-w-0 rounded-[14px] border border-border bg-card p-4 lg:col-start-2 lg:row-span-3 lg:row-start-6 lg:block xl:p-[22px]">
        {isDesktop && profileProps ? (
          <ClientProfile {...profileProps} inDialog={false} />
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground"><Users className="h-5 w-5" aria-hidden /></span>
            <p className="text-sm font-semibold">Nenhum cliente selecionado</p>
            <p className="text-sm text-muted-foreground">Escolha um cliente na lista para ver a ficha.</p>
          </div>
        )}
      </section>

      {/* Phone and tablet: the profile opens as a sheet over the list. */}
      <Dialog open={!isDesktop && !!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-lg grid-cols-[minmax(0,1fr)] sm:max-w-xl">
          {!isDesktop && profileProps && <ClientProfile {...profileProps} inDialog />}
        </DialogContent>
      </Dialog>

      <ActionSheet open={listMenuOpen} onOpenChange={setListMenuOpen} title="Clientes" actions={listMenu} />

      <Dialog open={!!visibilityTarget} onOpenChange={(open) => { if (!open && !visibilityLock.current) setVisibilityTarget(null); }}>
        <DialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader><DialogTitle>{showExcluded ? "Restaurar cliente à lista?" : "Excluir cliente da lista?"}</DialogTitle></DialogHeader>
          <p className="break-words text-sm text-muted-foreground">{visibilityTarget?.name}: {showExcluded ? "voltará a aparecer na lista ativa." : "deixará de aparecer na lista ativa e poderá ser restaurado."} A conta de acesso, os agendamentos, os pagamentos e o histórico serão preservados.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={savingVisibility} onClick={() => setVisibilityTarget(null)}>Cancelar</Button>
            <Button type="button" disabled={savingVisibility} onClick={() => void saveVisibility()}>{savingVisibility ? "Salvando…" : showExcluded ? "Confirmar restauração" : "Confirmar exclusão da lista"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!mergeCandidate} onOpenChange={(open) => !open && setMergeCandidate(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitMerge className="h-4 w-4 text-muted-foreground" aria-hidden /> Confirmar mesclagem</DialogTitle>
          </DialogHeader>
          {mergeCandidate && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                O histórico de <strong className="font-semibold text-foreground">{mergeCandidate.source.name}</strong> será incorporado a <strong className="font-semibold text-foreground">{mergeCandidate.target.name}</strong>. O cadastro de origem ficará preservado como mesclado e não aparecerá mais na lista.
              </p>
              <div className="space-y-2 rounded-xl border border-border p-3.5 text-sm">
                <p className="font-semibold">Cadastro que ficará: {mergeCandidate.target.name}</p>
                <p className="break-all text-muted-foreground">{mergeCandidate.target.email ?? "Sem e-mail"}</p>
                <AccountBadge registered={mergeCandidate.target.accountStatus === "registered"} />
                <p className="pt-2 font-semibold">Cadastro incorporado: {mergeCandidate.source.name}</p>
                <p className="break-all text-muted-foreground">{mergeCandidate.source.email ?? "Sem e-mail"}</p>
                <AccountBadge registered={mergeCandidate.source.accountStatus === "registered"} />
              </div>
              <div className="rounded-xl border border-warning/35 bg-warning/15 px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                Agendamentos, pacotes, assinaturas e pontos serão mantidos. Essa ação fica registrada na auditoria.
              </div>
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setMergeCandidate(null)}>Cancelar</Button>
                <Button type="button" onClick={() => merge(mergeCandidate.source, mergeCandidate.target)} disabled={pending}>
                  <GitMerge className="h-4 w-4" aria-hidden /> {pending ? "Mesclando…" : "Confirmar mesclagem"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TAB_TRIGGER = "press inline-flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:bg-[hsl(var(--border))] data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-border-strong lg:min-h-[34px]";
const ICON_ACTION = "press inline-grid min-h-11 min-w-11 flex-1 place-items-center rounded-[10px] border border-border-strong text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-9 lg:min-h-9 lg:w-9 lg:min-w-9 lg:flex-none lg:rounded-[9px]";
const SECTION_TITLE = "text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground";

function ClientProfile({
  client: detail,
  inDialog,
  timezone,
  salonName,
  canManage,
  canDelete,
  showExcluded,
  history,
  loadingHist,
  historyError,
  historyExpanded,
  pending,
  onToggleHistory,
  onRetry,
  onRedeem,
  onMerge,
  onVisibility,
}: {
  client: ClientRow;
  /** Phone sheet (narrow, one column) or the computer's profile column (wide). */
  inDialog: boolean;
  timezone: string;
  salonName: string;
  canManage: boolean;
  canDelete: boolean;
  showExcluded: boolean;
  history: HistoryItem[] | null;
  loadingHist: boolean;
  historyError: string | null;
  historyExpanded: boolean;
  pending: boolean;
  onToggleHistory: () => void;
  onRetry: () => void;
  onRedeem: () => void;
  onMerge: (pair: { source: ClientRow; target: ClientRow }) => void;
  onVisibility: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wide = !inDialog;
  const Title: React.ElementType = inDialog ? DialogTitle : "h2";
  const Head: React.ElementType = inDialog ? DialogHeader : "div";
  const since = formatInTimeZone(new Date(detail.createdAt), timezone, "MMM yyyy", { locale: ptBR });
  const showDuplicates = detail.possibleDuplicates.length > 0 && canManage;
  const historyState = historyError
    ? <div role="alert" className="space-y-2 rounded-[14px] border border-border bg-card p-3.5 text-sm"><p>{historyError}</p><Button type="button" variant="outline" onClick={onRetry}>Tentar novamente</Button></div>
    : null;

  const next = (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-[14px] border border-border bg-card px-3.5 py-2 text-sm">
      <span className="text-muted-foreground">Próximo agendamento</span>
      {detail.nextAppointmentAt ? (
        <span className="flex flex-col items-end text-right">
          <span className="whitespace-nowrap font-medium">{formatInTimeZone(new Date(detail.nextAppointmentAt), timezone, "EEE, d MMM · HH:mm", { locale: ptBR })}</span>
          {detail.upcomingCount > 1 && <span className="whitespace-nowrap text-xs text-muted-foreground">{detail.upcomingCount} próximos</span>}
        </span>
      ) : (
        <span className="font-medium">Nenhum agendamento futuro</span>
      )}
    </div>
  );

  const stats = (
    <div className={cn("grid grid-cols-2 gap-2.5", wide && "xl:grid-cols-4")}>
      <Stat label="LTV total" value={formatWholeMoney(detail.totalSpent)} />
      <Stat label="Ticket médio" value={formatWholeMoney(detail.avgTicket)} />
      <Stat label="Visitas" value={detail.visits.toString()} />
      <Stat label="Última visita" value={daysAgo(detail.daysSince)} />
    </div>
  );

  const info = (
    <div className="rounded-[14px] border border-border bg-card px-3.5 py-1">
      <KeyValue label="Profissional favorito" value={detail.favoritePro ?? "—"} />
      <KeyValue label="Serviço favorito" value={detail.favoriteService ?? "—"} />
      <KeyValue label="Aniversário" value={detail.birthday ? format(new Date(detail.birthday), "d 'de' MMMM", { locale: ptBR }) : "—"} />
      <KeyValue label="Pacotes/assinaturas" value={`${plural(detail.activePackages, "pacote", "pacotes")} · ${plural(detail.activeSubscriptions, "plano", "planos")}`} />
    </div>
  );

  const loyalty = (
    <div className="space-y-2.5 rounded-[14px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm">
        <span className="whitespace-nowrap font-semibold">Fidelidade · {detail.loyaltyPoints} pontos</span>
        <span className="whitespace-nowrap text-muted-foreground">
          {detail.nextLoyaltyTier ? `${detail.loyaltyRemaining} para ${detail.nextLoyaltyTier}` : "Nível máximo"}
        </span>
      </div>
      <div role="progressbar" aria-label="Progresso na fidelidade" aria-valuemin={0} aria-valuemax={100} aria-valuenow={detail.loyaltyProgressPct} className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-muted-foreground transition-all" style={{ width: `${detail.loyaltyProgressPct}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">
        Faixa {detail.loyaltyTier}. Cada atendimento concluído vale 1 ponto.{detail.loyaltyRedeemedPoints ? ` Já resgatados: ${detail.loyaltyRedeemedPoints} pontos.` : ""}
      </p>
      {canManage && (
        <div className="space-y-1.5">
          <Button type="button" variant="secondary" className="w-full" onClick={onRedeem} disabled={pending || !detail.canRedeemLoyaltyReward}><Gift className="h-4 w-4" aria-hidden /> Resgatar recompensa</Button>
          <p className="text-xs text-muted-foreground">{LOYALTY_REWARD_COST} pontos = {LOYALTY_REWARD_LABEL.replace("R$ ", "R$\u00a0")}.</p>
        </div>
      )}
    </div>
  );

  const lastVisits = (
    <section className="space-y-2">
      <h3 className={SECTION_TITLE}>Últimos atendimentos</h3>
      {historyState ?? (loadingHist ? (
        <p role="status" className="text-sm text-muted-foreground">Carregando…</p>
      ) : history?.length ? (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          {history.slice(0, 3).map((item) => (
            <div key={item.id} className="flex min-h-14 items-center gap-3 border-b border-border px-3.5 py-2 text-sm last:border-b-0">
              <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{formatInTimeZone(new Date(item.startAt), timezone, "dd/MM/yyyy")}</span>
              <span className="min-w-0 flex-1 break-words">{item.serviceName}</span>
              <span className="shrink-0 whitespace-nowrap font-medium tabular-nums">{formatMoney(item.priceCents)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sem atendimentos registrados.</p>
      ))}
    </section>
  );

  const duplicates = showDuplicates ? (
    <div role="region" aria-label="Possível cadastro duplicado" className="space-y-3 rounded-xl border border-warning/35 bg-warning/15 p-3.5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warning" aria-hidden />
        <div>
          <p className="text-sm font-semibold">Possível cadastro duplicado</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            A coincidência de telefone ou e-mail não confirma que seja a mesma pessoa. Escolha o cadastro que deve permanecer e preserve o histórico.
          </p>
        </div>
      </div>
      <div className="space-y-1 rounded-xl border border-border bg-card p-3.5">
        <p className={SECTION_TITLE}>Cadastro aberto</p>
        <p className="break-words text-sm font-semibold">{detail.name}</p>
        <p className="break-all text-sm text-muted-foreground">{detail.email ?? "Sem e-mail"}</p>
        <p className="text-sm text-muted-foreground">Cliente desde {since} · {detail.visits} atendimentos</p>
        <AccountBadge registered={detail.accountStatus === "registered"} />
      </div>
      <p className="text-xs text-muted-foreground">Se apenas um cadastro tem conta criada, prefira mantê-lo para conservar o mesmo acesso.</p>
      {detail.possibleDuplicates.map((candidate) => (
        <div key={candidate.id} className="space-y-2 rounded-xl border border-border bg-card p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-[1_1_180px]">
              <p className="break-words text-sm font-semibold">{candidate.name}</p>
              <p className="text-sm text-muted-foreground">
                {candidate.phone ?? "Sem telefone"} · {candidate.visits} {candidate.visits === 1 ? "atendimento" : "atendimentos"}
              </p>
              <p className="break-all text-sm text-muted-foreground">{candidate.email ?? "Sem e-mail"}</p>
            </div>
            <Pill tone="warning" className="shrink-0">{candidate.matchReasons.map(duplicateReasonLabel).join(" + ")}</Pill>
          </div>
          <AccountBadge registered={candidate.hasAccount} />
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" className="h-auto whitespace-normal py-2 text-center leading-snug" onClick={() => onMerge({ source: candidateToRow(candidate, detail), target: detail })}>
              Manter cadastro aberto{detail.accountStatus === "registered" && !candidate.hasAccount ? " (recomendado)" : ""}
            </Button>
            <Button type="button" variant="secondary" className="h-auto whitespace-normal py-2 text-center leading-snug" onClick={() => onMerge({ source: detail, target: candidateToRow(candidate, detail) })}>
              Manter esta duplicata{candidate.hasAccount && detail.accountStatus !== "registered" ? " (recomendado)" : ""}
            </Button>
          </div>
        </div>
      ))}
    </div>
  ) : null;

  const hasCare = detail.allergies || detail.preferences || detail.consentGiven;
  const visibleHistory = history ? (historyExpanded ? history : history.slice(0, HISTORY_PREVIEW_COUNT)) : [];

  return (
    <div className="min-w-0 space-y-4">
      <Head className="flex flex-row items-start gap-3.5 text-left">
        <Avatar name={detail.name} large />
        <div className="min-w-0 flex-1">
          <Title className="flex flex-wrap items-center gap-1.5 text-lg font-semibold leading-tight tracking-tight">
            <span className="min-w-0 break-words">{detail.name}</span>
            <GenderBadge gender={detail.genderDisplay} source={detail.genderSource} />
            {detail.isVip && <Crown role="img" aria-label="Cliente VIP" className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </Title>
          <p className="mt-1 break-all text-sm tabular-nums text-muted-foreground">{detail.phone ?? detail.email ?? "sem contato"}</p>
          {detail.phone && detail.email && <p className="break-all text-sm text-muted-foreground">{detail.email}</p>}
          <p className="text-sm text-muted-foreground">Cliente desde {since} · {detail.visits} atendimentos</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AccountBadge registered={detail.accountStatus === "registered"} />
            {detail.isVip && <Pill tone="selection">VIP</Pill>}
            {detail.birthdayThisMonth && <Pill tone="neutral">Aniversário neste mês</Pill>}
            {detail.isLapsed && <Pill tone="danger">Sumido</Pill>}
            {showDuplicates && <Pill tone="warning">Possível duplicata</Pill>}
            {showExcluded && <Pill tone="neutral">Excluído da lista</Pill>}
          </div>
        </div>
      </Head>

      <div className="flex flex-wrap gap-2">
        {canManage && !showExcluded && (
          <Button asChild className="min-w-24 flex-[100_1_96px] lg:flex-none">
            <Link href={`/agenda?client=${encodeURIComponent(detail.id)}`}>Agendar</Link>
          </Button>
        )}
        {canManage && (
          <ClientForm
            triggerClassName="min-w-24 flex-[100_1_96px] lg:flex-none"
            client={{
              id: detail.id,
              name: detail.name,
              phone: detail.phone,
              email: detail.email,
              birthday: detail.birthday ? new Date(detail.birthday) : null,
              gender: detail.gender,
              notes: detail.notes,
              allergies: detail.allergies,
              preferences: detail.preferences,
              consentGiven: detail.consentGiven,
            }}
          />
        )}
        {(detail.phone || canDelete) && (
          <div className="flex min-w-[148px] flex-1 gap-2 lg:min-w-0 lg:flex-none">
            {detail.phone && (
              <a href={waLink(detail.phone, detail.name.split(" ")[0], salonName)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp de ${detail.name}`} title="WhatsApp" className={ICON_ACTION}>
                <MessageCircle className="h-4 w-4" aria-hidden />
              </a>
            )}
            {detail.phone && (
              <a href={`tel:${detail.phone}`} aria-label={`Ligar para ${detail.name}`} title="Ligar" className={ICON_ACTION}>
                <Phone className="h-4 w-4" aria-hidden />
              </a>
            )}
            {canDelete && (
              <button type="button" aria-label="Mais ações do cliente" title="Mais ações" onClick={() => setMenuOpen(true)} className={ICON_ACTION}>
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
      {canDelete && (
        <ActionSheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          title={detail.name}
          actions={[{
            key: "visibility",
            label: showExcluded ? "Restaurar à lista" : "Excluir da lista",
            icon: showExcluded ? Undo2 : UserX,
            tone: showExcluded ? "default" : "danger",
            onSelect: onVisibility,
          }]}
        />
      )}

      <Tabs key={detail.id} defaultValue="summary">
        <TabsList aria-label="Seções do cliente" className="flex w-full gap-[3px] overflow-x-auto rounded-[11px] border border-border-strong bg-card p-[3px] scrollbar-none">
          <TabsTrigger value="summary" className={TAB_TRIGGER}>Resumo</TabsTrigger>
          <TabsTrigger value="history" className={TAB_TRIGGER}>Histórico</TabsTrigger>
          <TabsTrigger value="preferences" className={TAB_TRIGGER}>Preferências</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4 space-y-3 focus-visible:outline-none">
          {duplicates}
          {next}
          {stats}
          {wide ? (
            <>
              <div className="grid gap-3 xl:grid-cols-2 xl:items-start">{info}{loyalty}</div>
              {lastVisits}
            </>
          ) : (
            <>
              {lastVisits}
              {info}
              {loyalty}
            </>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-2.5 focus-visible:outline-none">
          <div className="flex min-h-11 items-center justify-between gap-3 lg:min-h-9">
            <h3 className={SECTION_TITLE}>Histórico de atendimentos</h3>
            {history && history.length > HISTORY_PREVIEW_COUNT && (
              <button type="button" onClick={onToggleHistory} className="min-h-11 rounded-lg px-2 text-sm font-medium text-foreground underline-offset-4 hover:underline lg:min-h-9">
                {historyExpanded ? "Ver menos" : `Ver todos (${history.length})`}
              </button>
            )}
          </div>
          {historyState ?? (loadingHist ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando…</div>
          ) : history && history.length > 0 ? (
            <div className="overflow-hidden rounded-[14px] border border-border bg-card">
              {visibleHistory.map((h) => (
                <a key={h.id} href={`/agenda?date=${formatInTimeZone(new Date(h.startAt), timezone, "yyyy-MM-dd")}&appointment=${h.id}`} className="flex min-h-14 items-center gap-3 border-b border-border px-3.5 py-2 transition-colors last:border-b-0 hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span aria-hidden="true" className="my-1 w-1 self-stretch rounded-full" style={{ background: h.serviceColor ?? "#2ECC8B" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{h.serviceName}</span>
                    <span className="block text-sm text-muted-foreground">{formatInTimeZone(new Date(h.startAt), timezone, "d MMM yyyy · HH:mm", { locale: ptBR })} · {h.proName.split(" ")[0]}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                    <span className="text-sm font-medium tabular-nums">{formatMoney(h.priceCents)}</span>
                    <span className="text-xs text-muted-foreground underline-offset-4">Ver visita</span>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">Sem atendimentos registrados.</p>
          ))}
        </TabsContent>

        <TabsContent value="preferences" className="mt-4 space-y-3 focus-visible:outline-none">
          {!detail.allergies && !detail.preferences && !detail.consentGiven && !detail.notes && (
            <p className="text-sm text-muted-foreground">Nenhuma preferência registrada.{canManage ? " Use Editar para complementar o cadastro." : ""}</p>
          )}
          {hasCare && (
            <div className="rounded-[14px] border border-border bg-card px-3.5 py-1">
              {detail.allergies && <CareItem label="Alergias e restrições">{detail.allergies}</CareItem>}
              {detail.preferences && <CareItem label="Preferências">{detail.preferences}</CareItem>}
              <CareItem label="Consentimento para dados de atendimento">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />{detail.consentGiven ? "Registrado" : "Não registrado"}</span>
              </CareItem>
            </div>
          )}
          {detail.notes && (
            <div className="space-y-1 rounded-[14px] border border-border bg-card p-4">
              <p className={SECTION_TITLE}>Observações</p>
              <p className="whitespace-pre-wrap break-words text-sm">{detail.notes}</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function candidateToRow(candidate: ClientRow["possibleDuplicates"][number], current: ClientRow): ClientRow {
  return {
    ...current,
    id: candidate.id,
    name: candidate.name,
    phone: candidate.phone,
    email: candidate.email,
    visits: candidate.visits,
    totalSpent: candidate.totalSpent,
    accountStatus: candidate.hasAccount ? "registered" : "guest",
    possibleDuplicates: [],
  };
}

function AccountBadge({ registered }: { registered: boolean }) {
  return <Pill tone={registered ? "selection" : "neutral"}>{registered ? "Conta criada · acesso ao aplicativo" : "Sem conta criada"}</Pill>;
}

function duplicateReasonLabel(reason: "email" | "phone"): string {
  return reason === "email" ? "e-mail" : "telefone";
}

/** Group filter: a large chip that scrolls sideways on the phone; a compact filter chip on the computer. */
function SegmentChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "press inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-[10px] border px-[13px] text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8 lg:rounded-lg lg:px-3",
        active
          ? "border-primary bg-primary font-semibold text-primary-foreground lg:border-muted-foreground/45 lg:bg-muted lg:text-foreground"
          : "border-border-strong font-medium text-foreground hover:bg-card-hover lg:text-muted-foreground lg:hover:bg-transparent lg:hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[14px] border border-border bg-card px-3.5 py-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="truncate text-lg font-semibold tabular-nums" title={value}>{value}</span>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 border-b border-border py-1.5 text-sm last:border-b-0">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 max-w-full text-right [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

function CareItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap break-words text-sm">{children}</span>
    </div>
  );
}
