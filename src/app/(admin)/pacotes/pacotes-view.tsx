"use client";
import { useFormOperation } from "../use-form-operation";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Power, Trash2, ShoppingBag, MinusCircle,
  Snowflake, RefreshCw, Ban, MoreVertical, Loader2, Check,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatMoney } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PackageForm } from "./package-form";
import { PlanForm } from "./plan-form";
import {
  togglePackageActive, deletePackage, sellPackage, usePackageSession as consumePackageSession, setPurchaseStatus, renewPurchase,
  togglePlanActive, deletePlan, subscribeClient, cancelSubscription,
} from "./actions";

type PackageRow = { id: string; name: string; description: string | null; serviceId: string | null; serviceName: string | null; sessions: number; priceCents: number; validityDays: number; active: boolean; soldCount: number };
type PurchaseRow = { id: string; clientName: string; packageName: string; sessionsUsed: number; sessionsTotal: number; expiresAt: string; status: string; priceCents: number };
type PlanRow = { id: string; name: string; description: string | null; priceCents: number; interval: "MONTHLY" | "ANNUAL"; discountPct: number; benefits: string | null; active: boolean; subCount: number };
type SubRow = { id: string; clientName: string; planName: string; interval: string; priceCents: number; renewsAt: string; status: string };

/* Situação: neutro = ativo/confirmado, lilás = congelado, âmbar = em atraso, vermelho = cancelado, cinza = encerrado. */
const PKG_STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "Ativo", tone: "bg-muted text-foreground" },
  FROZEN: { label: "Congelado", tone: "bg-info/15 text-info" },
  EXPIRED: { label: "Expirado", tone: "bg-muted text-muted-foreground" },
  COMPLETED: { label: "Concluído", tone: "bg-muted text-muted-foreground" },
  CANCELLED: { label: "Cancelado", tone: "bg-danger/10 text-danger" },
};
const SUB_STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "Ativa", tone: "bg-muted text-foreground" },
  CANCELLED: { label: "Cancelada", tone: "bg-danger/10 text-danger" },
  PAST_DUE: { label: "Em atraso", tone: "bg-warning/15 text-warning" },
};
const FILTERS: Array<[string, string]> = [["all", "Todos"], ["expiring", "Vencem em 7 dias"], ["low", "Até 2 sessões restantes"], ["expired", "Vencidos"]];

/** Grade das tabelas do computador: as colunas vêm das variáveis --cols-lg e --cols-xl. */
const GRID_COLS = "lg:[grid-template-columns:var(--cols-lg)] xl:[grid-template-columns:var(--cols-xl)]";
// Cliente · Pacote · (Vence) · Sessões · Situação · Ações — entre 1024 e 1279 px a data desce para baixo do pacote.
const PURCHASE_COLUMNS = {
  "--cols-lg": "minmax(0,1fr) minmax(0,1.2fr) 120px 104px 168px",
  "--cols-xl": "minmax(140px,1fr) minmax(170px,1.3fr) 104px 140px 104px 168px",
} as React.CSSProperties;
// Cliente · Plano · Valor · (Renova) · Situação · ⋮
const SUB_COLUMNS = {
  "--cols-lg": "minmax(0,1fr) minmax(0,1.1fr) 140px 104px 44px",
  "--cols-xl": "minmax(140px,1fr) minmax(170px,1.2fr) 128px 112px 104px 44px",
} as React.CSSProperties;

const shortDate = (iso: string) => format(new Date(iso), "d MMM yyyy", { locale: ptBR });

export function PacotesView({
  packages, purchases, plans, subscriptions, clients, services, enabled = true, initialFilter = "all",
}: {
  packages: PackageRow[];
  purchases: PurchaseRow[];
  plans: PlanRow[];
  subscriptions: SubRow[];
  clients: { id: string; name: string }[];
  services: { id: string; name: string }[];
  enabled?: boolean;
  initialFilter?: "all" | "expiring";
}) {
  const [tab, setTab] = useState<"packages" | "plans">("packages");
  const router = useRouter();
  const [pending, startTransition] = useFormOperation();
  const [picker, setPicker] = useState<{ title: string; summary: string; onConfirm: (clientId: string) => Promise<void> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(false);
  const [confirmation, setConfirmation] = useState<{ title: string; summary: string; action: () => Promise<void> } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [purchaseFilter, setPurchaseFilter] = useState<string>(initialFilter);
  const now = Date.now();
  const filteredPurchases = purchases.filter(p => purchaseFilter === "all" || (purchaseFilter === "expiring" && p.status === "ACTIVE" && p.sessionsUsed < p.sessionsTotal && +new Date(p.expiresAt) >= now && +new Date(p.expiresAt) <= now + 7 * 86400000) || (purchaseFilter === "low" && p.status === "ACTIVE" && p.sessionsTotal - p.sessionsUsed > 0 && p.sessionsTotal - p.sessionsUsed <= 2) || (purchaseFilter === "expired" && (p.status === "EXPIRED" || (p.status === "ACTIVE" && +new Date(p.expiresAt) < now))));
  const activeSubs = subscriptions.filter(s => s.status === "ACTIVE").length;

  function run(fn: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setError(null); setSuccess(null);
    startTransition(async () => {
      try { await fn(); setConfirmation(null); setPicker(null); setSuccess("Operação concluída."); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir. Tente novamente."); }
      finally { operation.current = false; }
    });
  }

  const askUseSession = (pur: PurchaseRow) => setConfirmation({ title: "Confirmar uso de sessão", summary: `${pur.clientName} · ${pur.packageName} · ${pur.sessionsTotal - pur.sessionsUsed} sessões restantes`, action: () => consumePackageSession(pur.id) });

  return (
    <div className="flex min-w-0 flex-col gap-3.5 lg:gap-4">
      <SegmentedControl
        ariaLabel="Pacotes ou planos"
        value={tab}
        onChange={setTab}
        className="w-full lg:w-fit"
        options={[{ value: "packages", label: "Pacotes" }, { value: "plans", label: "Planos" }]}
      />

      {success && <p role="status" className="text-sm text-success">{success}</p>}
      {error && !picker && !confirmation && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p>}

      {tab === "packages" ? (
        <>
          {/* Ofertas de pacote */}
          <SectionHead title="Ofertas de pacote" action={enabled ? <PackageForm services={services} /> : undefined} />
          {packages.length === 0 ? (
            <Empty title="Nenhum pacote criado. Crie a primeira oferta." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:gap-3.5 xl:grid-cols-3">
              {packages.map((p) => (
                <OfferCard
                  key={p.id}
                  name={p.name}
                  subtitle={`${p.serviceName ?? "Genérico"} · ${p.soldCount} ${p.soldCount === 1 ? "vendido" : "vendidos"}`}
                  active={p.active}
                  price={
                    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                      <div>
                        <p className="whitespace-nowrap text-2xl font-semibold leading-tight tracking-tight tabular-nums">{formatMoney(p.priceCents)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{p.sessions} sessões · {p.validityDays} dias</p>
                      </div>
                      <p className="text-right text-xs tabular-nums text-muted-foreground">
                        {formatMoney(Math.round(p.priceCents / p.sessions))}<br />por sessão
                      </p>
                    </div>
                  }
                  primary={
                    <Button
                      type="button"
                      className="flex-1"
                      disabled={!enabled}
                      onClick={() => setPicker({ title: `Vender "${p.name}"`, summary: `${formatMoney(p.priceCents)} · ${p.sessions} sessões · validade ${p.validityDays} dias`, onConfirm: (cid) => sellPackage(p.id, cid) })}
                    >
                      <ShoppingBag aria-hidden="true" className="h-4 w-4" /> Vender
                    </Button>
                  }
                  menu={enabled ? <OfferMenu
                    label={`Mais ações de ${p.name}`}
                    onEdit={<PackageForm services={services} pkg={p} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}>Editar</DropdownMenuItem>} />}
                    onToggle={() => run(() => togglePackageActive(p.id))}
                    active={p.active}
                    onDelete={() => setConfirmation({ title: "Excluir oferta", summary: p.name, action: () => deletePackage(p.id) })}
                    pending={pending}
                  /> : null}
                />
              ))}
            </div>
          )}

          {/* Pacotes vendidos */}
          <SectionHead
            title="Pacotes vendidos"
            sub={filteredPurchases.length === purchases.length ? `${purchases.length} ${purchases.length === 1 ? "venda" : "vendas"}` : `${filteredPurchases.length} de ${purchases.length}`}
          />
          <div className="scrollbar-none -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5 md:-mx-6 md:px-6 lg:mx-0 lg:flex-wrap lg:gap-1.5 lg:overflow-visible lg:px-0" role="group" aria-label="Filtrar pacotes vendidos">
            {FILTERS.map(([value, label]) => <FilterChip key={value} active={purchaseFilter === value} onClick={() => setPurchaseFilter(value)}>{label}</FilterChip>)}
          </div>
          {filteredPurchases.length === 0 ? (
            <Empty title="Nenhum pacote neste filtro." />
          ) : (
            <div className="min-w-0 overflow-hidden rounded-[14px] border border-border bg-card">
              <div aria-hidden="true" className={`hidden min-h-9 items-center gap-3 border-b border-border px-4 text-xs font-medium text-muted-foreground lg:grid ${GRID_COLS}`} style={PURCHASE_COLUMNS}>
                <span>Cliente</span><span>Pacote</span><span className="hidden xl:block">Vence</span><span>Sessões</span><span>Situação</span><span className="text-right">Ações</span>
              </div>
              {filteredPurchases.map((pur) => {
                const cfg = PKG_STATUS[pur.status] ?? PKG_STATUS.ACTIVE;
                const remaining = pur.sessionsTotal - pur.sessionsUsed;
                const usedPct = Math.min(100, (pur.sessionsUsed / Math.max(1, pur.sessionsTotal)) * 100);
                const canUse = remaining > 0 && pur.status === "ACTIVE";
                return (
                  <div key={pur.id} className={`flex min-h-[56px] items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0 lg:grid lg:min-h-[52px] lg:px-4 lg:py-2 ${GRID_COLS}`} style={PURCHASE_COLUMNS}>
                    <div className="min-w-0 flex-1 lg:contents">
                      <p className="break-words text-sm font-medium lg:line-clamp-2" title={pur.clientName}>{pur.clientName}</p>
                      <p className="break-words text-sm text-muted-foreground lg:line-clamp-2" title={pur.packageName}>
                        {pur.packageName}<span className="xl:hidden"> · vence {shortDate(pur.expiresAt)}</span>
                      </p>
                      <p className="hidden text-sm tabular-nums text-muted-foreground xl:block">{shortDate(pur.expiresAt)}</p>
                      <div className="mt-1.5 lg:mt-0">
                        <p className="text-xs font-medium tabular-nums text-foreground lg:font-normal lg:text-muted-foreground">{remaining} de {pur.sessionsTotal} {remaining === 1 ? "restante" : "restantes"}</p>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`Sessões usadas por ${pur.clientName}`} aria-valuemin={0} aria-valuemax={pur.sessionsTotal} aria-valuenow={pur.sessionsUsed}>
                          <div className="h-full rounded-full bg-[hsl(var(--selection-solid))]" style={{ width: `${usedPct}%` }} />
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 lg:contents">
                      <span className="lg:block"><StatusBadge {...cfg} /></span>
                      <div className="flex items-center gap-1.5 lg:justify-end">
                        <Button type="button" variant="outline" size="sm" className="hidden lg:inline-flex" disabled={!enabled || !canUse} onClick={() => askUseSession(pur)}>
                          Usar sessão
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" aria-label={`Ações de ${pur.clientName}`} disabled={!enabled} className="-mr-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 lg:mr-0 lg:h-9 lg:w-9 lg:rounded-[9px]">
                              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => askUseSession(pur)} disabled={!canUse}>
                              <MinusCircle className="mr-2 h-3.5 w-3.5" /> Usar sessão
                            </DropdownMenuItem>
                            {pur.status === "FROZEN" ? (
                              <DropdownMenuItem onSelect={() => run(() => setPurchaseStatus(pur.id, "ACTIVE"))}>
                                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Reativar
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => run(() => setPurchaseStatus(pur.id, "FROZEN"))}>
                                <Snowflake className="mr-2 h-3.5 w-3.5" /> Congelar
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => setConfirmation({ title: "Confirmar renovação", summary: `${pur.clientName} · ${pur.packageName}`, action: () => renewPurchase(pur.id) })}>
                              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Renovar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setConfirmation({ title: "Cancelar pacote", summary: `${pur.clientName} · ${pur.packageName}. O histórico será preservado.`, action: () => setPurchaseStatus(pur.id, "CANCELLED") })} className="text-danger focus:text-danger">
                              <Ban className="mr-2 h-3.5 w-3.5" /> Cancelar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Planos */}
          <SectionHead title="Planos de assinatura" action={enabled ? <PlanForm /> : undefined} />
          {plans.length === 0 ? (
            <Empty title="Nenhum plano criado. Crie a primeira assinatura." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:gap-3.5 xl:grid-cols-3">
              {plans.map((p) => (
                <OfferCard
                  key={p.id}
                  name={p.name}
                  subtitle={`${p.subCount} ${p.subCount === 1 ? "assinante" : "assinantes"}`}
                  active={p.active}
                  price={
                    <div className="space-y-2">
                      <p className="text-2xl font-semibold leading-tight tracking-tight tabular-nums">
                        <span className="whitespace-nowrap">{formatMoney(p.priceCents)}</span><span className="text-sm font-normal text-muted-foreground">/{p.interval === "ANNUAL" ? "ano" : "mês"}</span>
                      </p>
                      {p.benefits && <p className="line-clamp-2 break-words text-sm text-muted-foreground">{p.benefits}</p>}
                    </div>
                  }
                  primary={
                    <Button
                      type="button"
                      className="flex-1"
                      disabled={!enabled}
                      onClick={() => setPicker({ title: `Assinar "${p.name}"`, summary: `${formatMoney(p.priceCents)}/${p.interval === "ANNUAL" ? "ano" : "mês"} · ${p.benefits ?? ""}`, onConfirm: (cid) => subscribeClient(p.id, cid) })}
                    >
                      <ShoppingBag aria-hidden="true" className="h-4 w-4" /> Assinar
                    </Button>
                  }
                  menu={enabled ? <OfferMenu
                    label={`Mais ações de ${p.name}`}
                    onEdit={<PlanForm plan={p} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}>Editar</DropdownMenuItem>} />}
                    onToggle={() => run(() => togglePlanActive(p.id))}
                    active={p.active}
                    onDelete={() => setConfirmation({ title: "Excluir plano", summary: p.name, action: () => deletePlan(p.id) })}
                    pending={pending}
                  /> : null}
                />
              ))}
            </div>
          )}

          {/* Assinantes */}
          <SectionHead title="Assinantes" sub={`${activeSubs} ${activeSubs === 1 ? "ativo" : "ativos"}`} />
          {subscriptions.length === 0 ? (
            <Empty title="Nenhum assinante ainda." />
          ) : (
            <div className="min-w-0 overflow-hidden rounded-[14px] border border-border bg-card">
              <div aria-hidden="true" className={`hidden min-h-9 items-center gap-3 border-b border-border px-4 text-xs font-medium text-muted-foreground lg:grid ${GRID_COLS}`} style={SUB_COLUMNS}>
                <span>Cliente</span><span>Plano</span><span>Valor</span><span className="hidden xl:block">Renova</span><span>Situação</span><span />
              </div>
              {subscriptions.map((s) => {
                const cfg = SUB_STATUS[s.status] ?? SUB_STATUS.ACTIVE;
                const value = `${formatMoney(s.priceCents)}/${s.interval === "ANNUAL" ? "ano" : "mês"}`;
                return (
                  <div key={s.id} className={`flex min-h-[56px] items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0 lg:grid lg:min-h-[52px] lg:px-4 lg:py-2 ${GRID_COLS}`} style={SUB_COLUMNS}>
                    <div className="min-w-0 flex-1 lg:contents">
                      <p className="break-words text-sm font-medium lg:line-clamp-2" title={s.clientName}>{s.clientName}</p>
                      <p className="break-words text-sm text-muted-foreground lg:line-clamp-2" title={s.planName}>{s.planName}<span className="lg:hidden"> · renova {shortDate(s.renewsAt)}</span></p>
                      <div className="min-w-0">
                        <p className="whitespace-nowrap text-xs tabular-nums text-muted-foreground lg:text-sm">{value}</p>
                        <p className="hidden text-xs tabular-nums text-muted-foreground lg:block xl:hidden">renova {shortDate(s.renewsAt)}</p>
                      </div>
                      <p className="hidden text-sm tabular-nums text-muted-foreground xl:block">{shortDate(s.renewsAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 lg:contents">
                      <span className="lg:block"><StatusBadge {...cfg} /></span>
                      <span className="flex justify-end">
                        {s.status === "ACTIVE" && (
                          <button type="button" onClick={() => setConfirmation({ title: "Cancelar assinatura", summary: `${s.clientName} · ${s.planName}. O histórico será preservado.`, action: () => cancelSubscription(s.id) })} disabled={!enabled || pending} aria-label={`Cancelar assinatura de ${s.clientName}`} title="Cancelar assinatura" className="-mr-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-elevated hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 lg:mr-0 lg:h-9 lg:w-9 lg:rounded-[9px]">
                            <Ban aria-hidden="true" className="h-4 w-4" />
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Seletor de cliente para vender/assinar */}
      {picker && <ClientPicker
        open title={picker.title} summary={picker.summary} clients={clients} pending={pending} error={error}
        onClose={() => { if (!operation.current) { setPicker(null); setError(null); } }}
        onConfirm={(cid) => run(() => picker.onConfirm(cid))}
      />}
      <Dialog open={!!confirmation} onOpenChange={next => { if (!next && !operation.current) { setConfirmation(null); setError(null); } }}>
        <DialogContent><DialogHeader><DialogTitle>{confirmation?.title}</DialogTitle><DialogDescription>{confirmation?.summary}</DialogDescription></DialogHeader>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmation(null)}>Voltar</Button><Button type="button" disabled={pending} onClick={() => confirmation && run(confirmation.action)}>{pending ? "Processando…" : "Confirmar operação"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OfferCard({ name, subtitle, active, price, primary, menu }: { name: string; subtitle: string; active: boolean; price: React.ReactNode; primary: React.ReactNode; menu: React.ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4 ${active ? "" : "text-muted-foreground"}`}>
      <div className="flex items-start justify-between gap-3 lg:min-h-[68px]">
        <div className="min-w-0">
          <p className={`line-clamp-3 break-words text-base font-semibold leading-snug ${active ? "text-foreground" : ""}`} title={name}>{name}</p>
          <p className="mt-0.5 break-words text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <StatusBadge label={active ? "Ativo" : "Pausado"} tone={active ? "bg-muted text-foreground" : "bg-muted text-muted-foreground"} />
      </div>
      <div className="mt-auto">{price}</div>
      <div className="flex items-center gap-2 border-t border-border pt-3">
        {primary}
        {menu}
      </div>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: string }) {
  return <span className={`inline-flex min-h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${tone}`}>{label}</span>;
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

function ClientPicker({ open, title, summary, clients, pending, error, onClose, onConfirm }: { open: boolean; title: string; summary: string; clients: { id: string; name: string }[]; pending: boolean; error: string | null; onClose: () => void; onConfirm: (clientId: string) => void }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = clients.filter(c => normalize(c.name).includes(normalize(q))).slice(0, 30);
  return <Dialog open={open} onOpenChange={o => !o && onClose()}>
    <DialogContent className="max-h-[80dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{summary}</DialogDescription></DialogHeader>
      <input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" aria-label="Buscar cliente" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente…" disabled={pending} className="min-h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-base focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 lg:min-h-10 lg:text-sm" autoFocus />
      <div className="max-h-72 space-y-1 overflow-y-auto" role="group" aria-label="Selecionar cliente">
        {filtered.map(c => <button type="button" key={c.id} disabled={pending} aria-pressed={selected === c.id} onClick={() => setSelected(c.id)} className="flex min-h-11 w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-[hsl(var(--selection))] aria-pressed:text-[hsl(var(--selection-foreground))]">{c.name}{selected === c.id && <Check aria-hidden className="h-4 w-4 text-[hsl(var(--selection-foreground))]" />}</button>)}
        {filtered.length === 0 && <p role="status" className="py-4 text-sm">Nenhum cliente encontrado.</p>}
      </div>
      {selected && <p role="status" className="text-sm">Cliente: <strong>{clients.find(c => c.id === selected)?.name}</strong>. Confira os dados antes de confirmar.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <DialogFooter><DialogClose asChild><Button variant="outline" type="button" disabled={pending}>Voltar</Button></DialogClose><Button type="button" disabled={!selected || pending} onClick={() => selected && onConfirm(selected)}>{pending ? "Processando…" : "Confirmar operação"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function OfferMenu({ label, onEdit, onToggle, active, onDelete, pending }: { label: string; onEdit: React.ReactNode; onToggle: () => void; active: boolean; onDelete: () => void; pending: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-border-strong text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-9 lg:w-9 lg:rounded-[9px]">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onEdit}
        <DropdownMenuItem onSelect={onToggle}><Power className="mr-2 h-3.5 w-3.5" /> {active ? "Pausar" : "Ativar"}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-danger focus:text-danger"><Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SectionHead({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function Empty({ title }: { title: string }) {
  return <div className="rounded-[14px] border border-border bg-card p-10 text-center text-sm text-muted-foreground">{title}</div>;
}
