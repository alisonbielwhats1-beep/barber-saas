"use client";
import { useFormOperation } from "../use-form-operation";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Layers, BadgePercent, Power, Trash2, ShoppingCart, MinusCircle,
  Snowflake, RefreshCw, Ban, MoreVertical, Loader2, Check,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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

const PKG_STATUS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Ativo", color: "#2ECC8B" },
  FROZEN: { label: "Congelado", color: "#3B9EFF" },
  EXPIRED: { label: "Expirado", color: "#94A3B8" },
  COMPLETED: { label: "Concluído", color: "#A855F7" },
  CANCELLED: { label: "Cancelado", color: "#EF4444" },
};
const SUB_STATUS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Ativa", color: "#2ECC8B" },
  CANCELLED: { label: "Cancelada", color: "#EF4444" },
  PAST_DUE: { label: "Em atraso", color: "#F59E0B" },
};

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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface-1 p-1 w-fit">
        <TabBtn active={tab === "packages"} onClick={() => setTab("packages")} icon={Layers} label="Pacotes" />
        <TabBtn active={tab === "plans"} onClick={() => setTab("plans")} icon={BadgePercent} label="Planos" />
      </div>

      {success && <p role="status" className="text-sm text-success">{success}</p>}
      {error && !picker && !confirmation && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}

      {tab === "packages" ? (
        <>
          {/* Ofertas de pacote */}
          <SectionHead title="Ofertas de pacote" action={enabled ? <PackageForm services={services} /> : undefined} />
          {packages.length === 0 ? (
            <Empty title="Nenhum pacote criado. Crie a primeira oferta." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {packages.map((p) => (
                <div key={p.id} className={`card-interactive rounded-2xl border border-border bg-card p-5 ${!p.active ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[14px] font-semibold">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">{p.serviceName ?? "Genérico"} · {p.soldCount} {p.soldCount === 1 ? "vendido" : "vendidos"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${p.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {p.active ? "Ativo" : "Pausado"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-semibold tracking-tight">{formatMoney(p.priceCents)}</p>
                      <p className="text-[11px] text-muted-foreground">{p.sessions} sessões · {p.validityDays} dias</p>
                    </div>
                    <p className="text-right text-[11px] text-muted-foreground">
                      {formatMoney(Math.round(p.priceCents / p.sessions))}<br />por sessão
                    </p>
                  </div>
                  <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                    <button
                      disabled={!enabled}
                      onClick={() => setPicker({ title: `Vender "${p.name}"`, summary: `${formatMoney(p.priceCents)} · ${p.sessions} sessões · validade ${p.validityDays} dias`, onConfirm: (cid) => sellPackage(p.id, cid) })}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground transition hover:opacity-90"
                    >
                      <ShoppingCart className="h-3.5 w-3.5" /> Vender
                    </button>
                    {enabled && <OfferMenu
                      onEdit={<PackageForm services={services} pkg={p} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}>Editar</DropdownMenuItem>} />}
                      onToggle={() => run(() => togglePackageActive(p.id))}
                      active={p.active}
                      onDelete={() => setConfirmation({ title: "Excluir oferta", summary: p.name, action: () => deletePackage(p.id) })}
                      pending={pending}
                    />}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pacotes vendidos */}
          <SectionHead title="Pacotes vendidos" />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar pacotes vendidos">{[["all", "Todos"], ["expiring", "Vencem em 7 dias"], ["low", "Até 2 sessões restantes"], ["expired", "Vencidos"]].map(([value, label]) => <button key={value} type="button" aria-pressed={purchaseFilter === value} onClick={() => setPurchaseFilter(value!)} className={`min-h-11 rounded-lg border px-3 text-xs ${purchaseFilter === value ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{label}</button>)}</div>
          {filteredPurchases.length === 0 ? (
            <Empty title="Nenhum pacote neste filtro." />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              {filteredPurchases.map((pur) => {
                const cfg = PKG_STATUS[pur.status] ?? PKG_STATUS.ACTIVE;
                const remaining = pur.sessionsTotal - pur.sessionsUsed;
                return (
                  <div key={pur.id} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{pur.clientName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{pur.packageName} · vence {format(new Date(pur.expiresAt), "d MMM yyyy", { locale: ptBR })}</p>
                      <p className="mt-1 text-xs font-medium text-success">{remaining} de {pur.sessionsTotal} sessões restantes</p>
                    </div>
                    <div className="hidden w-28 sm:block">
                      <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>{remaining} restantes</span><span>{pur.sessionsUsed}/{pur.sessionsTotal}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(pur.sessionsUsed / pur.sessionsTotal) * 100}%` }} />
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${cfg.color}1f`, color: cfg.color }}>{cfg.label}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button aria-label="Ações" disabled={!enabled} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
                          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setConfirmation({ title: "Confirmar uso de sessão", summary: `${pur.clientName} · ${pur.packageName} · ${remaining} sessões restantes`, action: () => consumePackageSession(pur.id) })} disabled={remaining <= 0 || pur.status !== "ACTIVE"}>
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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {plans.map((p) => (
                <div key={p.id} className={`card-interactive rounded-2xl border border-border bg-card p-5 ${!p.active ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[14px] font-semibold">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">{p.subCount} {p.subCount === 1 ? "assinante" : "assinantes"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${p.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {p.active ? "Ativo" : "Pausado"}
                    </span>
                  </div>
                  <p className="mt-3 text-2xl font-semibold tracking-tight">
                    {formatMoney(p.priceCents)}<span className="text-[12px] font-normal text-muted-foreground">/{p.interval === "ANNUAL" ? "ano" : "mês"}</span>
                  </p>
                  {p.benefits && <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{p.benefits}</p>}
                  <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                    <button
                      disabled={!enabled}
                      onClick={() => setPicker({ title: `Assinar "${p.name}"`, summary: `${formatMoney(p.priceCents)}/${p.interval === "ANNUAL" ? "ano" : "mês"} · ${p.benefits ?? ""}`, onConfirm: (cid) => subscribeClient(p.id, cid) })}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground transition hover:opacity-90"
                    >
                      <ShoppingCart className="h-3.5 w-3.5" /> Assinar
                    </button>
                    {enabled && <OfferMenu
                      onEdit={<PlanForm plan={p} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}>Editar</DropdownMenuItem>} />}
                      onToggle={() => run(() => togglePlanActive(p.id))}
                      active={p.active}
                      onDelete={() => setConfirmation({ title: "Excluir plano", summary: p.name, action: () => deletePlan(p.id) })}
                      pending={pending}
                    />}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Assinantes */}
          <SectionHead title="Assinantes" />
          {subscriptions.length === 0 ? (
            <Empty title="Nenhum assinante ainda." />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              {subscriptions.map((s) => {
                const cfg = SUB_STATUS[s.status] ?? SUB_STATUS.ACTIVE;
                return (
                  <div key={s.id} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{s.clientName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{s.planName} · renova {format(new Date(s.renewsAt), "d MMM yyyy", { locale: ptBR })}</p>
                    </div>
                    <p className="hidden text-[12px] text-muted-foreground sm:block">{formatMoney(s.priceCents)}/{s.interval === "ANNUAL" ? "ano" : "mês"}</p>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${cfg.color}1f`, color: cfg.color }}>{cfg.label}</span>
                    {s.status === "ACTIVE" && (
                      <button onClick={() => setConfirmation({ title: "Cancelar assinatura", summary: `${s.clientName} · ${s.planName}. O histórico será preservado.`, action: () => cancelSubscription(s.id) })} disabled={!enabled || pending} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-danger" title="Cancelar assinatura">
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                    )}
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

function ClientPicker({ open, title, summary, clients, pending, error, onClose, onConfirm }: { open: boolean; title: string; summary: string; clients: { id: string; name: string }[]; pending: boolean; error: string | null; onClose: () => void; onConfirm: (clientId: string) => void }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = clients.filter(c => normalize(c.name).includes(normalize(q))).slice(0, 30);
  return <Dialog open={open} onOpenChange={o => !o && onClose()}>
    <DialogContent className="max-h-[80dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{summary}</DialogDescription></DialogHeader>
      <input aria-label="Buscar cliente" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente…" disabled={pending} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm" autoFocus />
      <div className="max-h-72 space-y-1 overflow-y-auto" role="group" aria-label="Selecionar cliente">
        {filtered.map(c => <button type="button" key={c.id} disabled={pending} aria-pressed={selected === c.id} onClick={() => setSelected(c.id)} className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring">{c.name}{selected === c.id && <Check aria-hidden className="h-4 w-4 text-primary" />}</button>)}
        {filtered.length === 0 && <p role="status" className="py-4 text-sm">Nenhum cliente encontrado.</p>}
      </div>
      {selected && <p role="status" className="text-sm">Cliente: <strong>{clients.find(c => c.id === selected)?.name}</strong>. Confira os dados antes de confirmar.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <DialogFooter><DialogClose asChild><Button variant="outline" type="button" disabled={pending}>Voltar</Button></DialogClose><Button type="button" disabled={!selected || pending} onClick={() => selected && onConfirm(selected)}>{pending ? "Processando…" : "Confirmar operação"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function OfferMenu({ onEdit, onToggle, active, onDelete, pending }: { onEdit: React.ReactNode; onToggle: () => void; active: boolean; onDelete: () => void; pending: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
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

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Layers; label: string }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between pt-1">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {action}
    </div>
  );
}

function Empty({ title }: { title: string }) {
  return <div className="rounded-2xl border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">{title}</div>;
}
