"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Layers, BadgePercent, Power, Trash2, ShoppingCart, MinusCircle,
  Snowflake, RefreshCw, Ban, MoreVertical, Loader2, Check,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PackageForm } from "./package-form";
import { PlanForm } from "./plan-form";
import {
  togglePackageActive, deletePackage, sellPackage, usePackageSession, setPurchaseStatus, renewPurchase,
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
  packages, purchases, plans, subscriptions, clients, services,
}: {
  packages: PackageRow[];
  purchases: PurchaseRow[];
  plans: PlanRow[];
  subscriptions: SubRow[];
  clients: { id: string; name: string }[];
  services: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<"packages" | "plans">("packages");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picker, setPicker] = useState<{ title: string; onConfirm: (clientId: string) => Promise<void> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface-1 p-1 w-fit">
        <TabBtn active={tab === "packages"} onClick={() => setTab("packages")} icon={Layers} label="Pacotes" />
        <TabBtn active={tab === "plans"} onClick={() => setTab("plans")} icon={BadgePercent} label="Planos" />
      </div>

      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}

      {tab === "packages" ? (
        <>
          {/* Ofertas de pacote */}
          <SectionHead title="Ofertas de pacote" action={<PackageForm services={services} />} />
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
                      onClick={() => setPicker({ title: `Vender "${p.name}"`, onConfirm: (cid) => sellPackage(p.id, cid) })}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground transition hover:opacity-90"
                    >
                      <ShoppingCart className="h-3.5 w-3.5" /> Vender
                    </button>
                    <OfferMenu
                      onEdit={<PackageForm services={services} pkg={p} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}>Editar</DropdownMenuItem>} />}
                      onToggle={() => run(() => togglePackageActive(p.id))}
                      active={p.active}
                      onDelete={() => run(() => deletePackage(p.id))}
                      pending={pending}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pacotes vendidos */}
          <SectionHead title="Pacotes vendidos" />
          {purchases.length === 0 ? (
            <Empty title="Nenhum pacote vendido ainda." />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              {purchases.map((pur) => {
                const cfg = PKG_STATUS[pur.status] ?? PKG_STATUS.ACTIVE;
                const remaining = pur.sessionsTotal - pur.sessionsUsed;
                return (
                  <div key={pur.id} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{pur.clientName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{pur.packageName} · vence {format(new Date(pur.expiresAt), "d MMM yyyy", { locale: ptBR })}</p>
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
                        <button className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-card-hover hover:text-foreground">
                          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => run(() => usePackageSession(pur.id))} disabled={remaining <= 0 || pur.status !== "ACTIVE"}>
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
                        <DropdownMenuItem onSelect={() => run(() => renewPurchase(pur.id))}>
                          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Renovar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => run(() => setPurchaseStatus(pur.id, "CANCELLED"))} className="text-danger focus:text-danger">
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
          <SectionHead title="Planos de assinatura" action={<PlanForm />} />
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
                      onClick={() => setPicker({ title: `Assinar "${p.name}"`, onConfirm: (cid) => subscribeClient(p.id, cid) })}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground transition hover:opacity-90"
                    >
                      <ShoppingCart className="h-3.5 w-3.5" /> Assinar
                    </button>
                    <OfferMenu
                      onEdit={<PlanForm plan={p} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}>Editar</DropdownMenuItem>} />}
                      onToggle={() => run(() => togglePlanActive(p.id))}
                      active={p.active}
                      onDelete={() => run(() => deletePlan(p.id))}
                      pending={pending}
                    />
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
                      <button onClick={() => run(() => cancelSubscription(s.id))} disabled={pending} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-danger" title="Cancelar assinatura">
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
      <ClientPicker
        open={!!picker}
        title={picker?.title ?? ""}
        clients={clients}
        onClose={() => setPicker(null)}
        onConfirm={(cid) => {
          const p = picker;
          setPicker(null);
          if (p) run(() => p.onConfirm(cid));
        }}
      />
    </div>
  );
}

function ClientPicker({ open, title, clients, onClose, onConfirm }: { open: boolean; title: string; clients: { id: string; name: string }[]; onClose: () => void; onConfirm: (clientId: string) => void }) {
  const [q, setQ] = useState("");
  const filtered = clients.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-hidden">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none" autoFocus />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {filtered.map((c) => (
            <button key={c.id} onClick={() => onConfirm(c.id)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-card-hover">
              {c.name}<Check className="h-4 w-4 text-muted-foreground opacity-0" />
            </button>
          ))}
          {filtered.length === 0 && <p className="py-6 text-center text-[13px] text-muted-foreground">Nenhum cliente.</p>}
        </div>
        <DialogFooter><DialogClose asChild><Button variant="outline" type="button">Fechar</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
