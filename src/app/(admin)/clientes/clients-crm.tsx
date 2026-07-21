"use client";

import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, MessageCircle, Crown, Cake, Clock, Star, Scissors, User,
  CircleDollarSign, Repeat, Layers, Loader2,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ClientForm } from "./client-form";
import { fetchClientHistory } from "./actions";
import type { ClientRow } from "@/lib/crm";

type Segment = "all" | "vip" | "birthday" | "lapsed" | "recurring";
type HistoryItem = { id: string; startAt: string; priceCents: number; status: string; serviceName: string; serviceColor: string | null; proName: string };

function waLink(phone: string | null, first: string, salonName: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const full = digits.length <= 11 ? `55${digits}` : digits;
  const msg = `Olá ${first}! Aqui é do ${salonName}. Tudo bem? 💈`;
  return `https://wa.me/${full}?text=${encodeURIComponent(msg)}`;
}

export function ClientsCrm({ clients, salonName }: { clients: ClientRow[]; salonName: string }) {
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  const [detail, setDetail] = useState<ClientRow | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);

  const counts = useMemo(() => ({
    vip: clients.filter((c) => c.isVip).length,
    birthday: clients.filter((c) => c.birthdayThisMonth).length,
    lapsed: clients.filter((c) => c.isLapsed).length,
    recurring: clients.filter((c) => c.visits >= 2).length,
  }), [clients]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (segment === "vip" && !c.isVip) return false;
      if (segment === "birthday" && !c.birthdayThisMonth) return false;
      if (segment === "lapsed" && !c.isLapsed) return false;
      if (segment === "recurring" && c.visits < 2) return false;
      if (q && !c.name.toLowerCase().includes(q) && !(c.phone ?? "").includes(q)) return false;
      return true;
    });
  }, [clients, search, segment]);

  async function openDetail(c: ClientRow) {
    setDetail(c);
    setHistory(null);
    setLoadingHist(true);
    try {
      setHistory(await fetchClientHistory(c.id));
    } finally {
      setLoadingHist(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente ou telefone…" className="w-48 bg-transparent text-[13px] placeholder:text-muted-foreground focus:outline-none" />
        </div>
        <Seg active={segment === "all"} onClick={() => setSegment("all")}>Todos ({clients.length})</Seg>
        <Seg active={segment === "vip"} onClick={() => setSegment("vip")} icon={Crown} accent="#F4C430">VIP ({counts.vip})</Seg>
        <Seg active={segment === "birthday"} onClick={() => setSegment("birthday")} icon={Cake} accent="#EC4899">Aniversariantes ({counts.birthday})</Seg>
        <Seg active={segment === "lapsed"} onClick={() => setSegment("lapsed")} icon={Clock} accent="#EF4444">Sumidos ({counts.lapsed})</Seg>
        <Seg active={segment === "recurring"} onClick={() => setSegment("recurring")} icon={Repeat} accent="#A855F7">Recorrentes ({counts.recurring})</Seg>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {shown.length === 0 ? (
          <div className="p-12 text-center text-[13px] text-muted-foreground">Nenhum cliente neste filtro.</div>
        ) : (
          shown.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-card-hover">
              <button onClick={() => openDetail(c)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-black/80" style={{ background: c.loyaltyColor }}>
                  {c.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[13px] font-medium">{c.name}</p>
                    {c.isVip && <Crown className="h-3 w-3 shrink-0 text-[#F4C430]" />}
                    {c.birthdayThisMonth && <Cake className="h-3 w-3 shrink-0 text-[#EC4899]" />}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {c.loyaltyTier} · {c.visits} visitas{c.favoritePro ? ` · ${c.favoritePro.split(" ")[0]}` : ""}
                  </p>
                </div>
              </button>
              <div className="hidden w-24 text-right sm:block">
                <p className="text-[13px] font-semibold">{formatMoney(c.totalSpent)}</p>
                <p className="text-[10px] text-muted-foreground">LTV</p>
              </div>
              <div className="hidden w-24 text-right md:block">
                <p className="text-[12px] text-muted-foreground">
                  {c.daysSince == null ? "nunca" : c.daysSince === 0 ? "hoje" : `${c.daysSince}d atrás`}
                </p>
                <p className="text-[10px] text-muted-foreground">última visita</p>
              </div>
              {c.isLapsed && <span className="hidden shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger lg:inline">Sumido</span>}
              {c.phone && (
                <a href={waLink(c.phone, c.name.split(" ")[0], salonName)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#25D366]/15 text-[#25D366] transition hover:bg-[#25D366]/25" title="WhatsApp">
                  <MessageCircle className="h-4 w-4" />
                </a>
              )}
            </div>
          ))
        )}
      </div>

      {/* Drawer de detalhe */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-semibold text-black/80" style={{ background: detail.loyaltyColor }}>
                    {detail.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <DialogTitle className="flex items-center gap-2 text-lg">
                      {detail.name}
                      {detail.isVip && <Crown className="h-4 w-4 text-[#F4C430]" />}
                    </DialogTitle>
                    <p className="text-[12px] text-muted-foreground">
                      {detail.phone ?? detail.email ?? "sem contato"} · {detail.loyaltyTier}
                    </p>
                  </div>
                </div>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-2">
                <DStat icon={CircleDollarSign} label="LTV total" value={formatMoney(detail.totalSpent)} />
                <DStat icon={Star} label="Ticket médio" value={formatMoney(detail.avgTicket)} />
                <DStat icon={Repeat} label="Visitas" value={detail.visits.toString()} />
                <DStat icon={Clock} label="Última visita" value={detail.daysSince == null ? "nunca" : `${detail.daysSince}d atrás`} />
              </div>

              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <Info icon={User} label="Profissional favorito" value={detail.favoritePro ?? "—"} />
                <Info icon={Scissors} label="Serviço favorito" value={detail.favoriteService ?? "—"} />
                <Info icon={Cake} label="Aniversário" value={detail.birthday ? format(new Date(detail.birthday), "d 'de' MMMM", { locale: ptBR }) : "—"} />
                <Info icon={Layers} label="Pacotes/assinaturas" value={`${detail.activePackages} pac · ${detail.activeSubscriptions} plano`} />
              </div>

              {detail.notes && (
                <div className="rounded-xl bg-surface-1 px-3 py-2.5 text-[12px]">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Observações</p>
                  <p className="mt-0.5">{detail.notes}</p>
                </div>
              )}

              {/* Histórico */}
              <div>
                <p className="mb-2 text-[12px] font-semibold">Histórico de atendimentos</p>
                {loadingHist ? (
                  <div className="flex items-center gap-2 py-4 text-[12px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
                ) : history && history.length > 0 ? (
                  <div className="space-y-1.5">
                    {history.map((h) => (
                      <div key={h.id} className="flex items-center gap-3 rounded-lg bg-surface-1 px-3 py-2">
                        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: h.serviceColor ?? "#2ECC8B" }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium">{h.serviceName}</p>
                          <p className="text-[10px] text-muted-foreground">{format(new Date(h.startAt), "d MMM yyyy", { locale: ptBR })} · {h.proName.split(" ")[0]}</p>
                        </div>
                        <p className="text-[12px] font-semibold">{formatMoney(h.priceCents)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-2 text-[12px] text-muted-foreground">Sem atendimentos registrados.</p>
                )}
              </div>

              <div className="flex items-center gap-2 border-t border-border pt-3">
                {detail.phone && (
                  <a href={waLink(detail.phone, detail.name.split(" ")[0], salonName)} target="_blank" rel="noopener noreferrer" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#25D366]/15 px-3 py-2 text-[13px] font-medium text-[#25D366] transition hover:bg-[#25D366]/25">
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                )}
                <ClientForm
                  client={{ id: detail.id, name: detail.name, phone: detail.phone, email: detail.email, birthday: detail.birthday ? new Date(detail.birthday) : null, notes: detail.notes }}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Seg({ active, onClick, children, icon: Icon, accent }: { active: boolean; onClick: () => void; children: React.ReactNode; icon?: typeof Crown; accent?: string }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${active ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`} style={active && accent ? { borderColor: `${accent}66`, color: accent, background: `${accent}14` } : undefined}>
      {Icon && <Icon className="h-3.5 w-3.5" />} {children}
    </button>
  );
}

function DStat({ icon: Icon, label, value }: { icon: typeof Star; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-1 p-3">
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Icon className="h-3 w-3" /> {label}</span>
      <p className="mt-0.5 text-[15px] font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Star; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="truncate font-medium">{value}</p>
      </div>
    </div>
  );
}
