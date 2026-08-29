"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, MessageCircle, Crown, Cake, Clock, Star, Scissors, User,
  CircleDollarSign, Repeat, Layers, Loader2, ShieldCheck, HeartPulse, FileUp, Gift, X, GitMerge, AlertTriangle,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { ClientForm } from "./client-form";
import { fetchClientHistory, importClientsCsv, mergeClients, redeemLoyaltyReward } from "./actions";
import { toast } from "@/components/ui/toast";
import type { ClientRow } from "@/lib/crm";

type Segment = "all" | "vip" | "birthday" | "lapsed" | "recurring";
type HistoryItem = { id: string; startAt: string; priceCents: number; status: string; serviceName: string; serviceColor: string | null; proName: string };
const HISTORY_PREVIEW_COUNT = 3;

const GENDER_COLOR = { MALE: "#3B9EFF", FEMALE: "#E85D9E" } as const;

function GenderBadge({ gender, source }: { gender: "MALE" | "FEMALE" | "OTHER" | null; source: "confirmed" | "inferred" | null }) {
  if (gender !== "MALE" && gender !== "FEMALE") return null;
  const letter = gender === "MALE" ? "M" : "F";
  const color = GENDER_COLOR[gender];
  const label = gender === "MALE" ? "Masculino" : "Feminino";
  return (
    <span
      title={source === "inferred" ? `${label} (estimado pelo nome, confira em Editar)` : label}
      className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[8px] font-bold leading-none"
      style={{
        color,
        background: `${color}20`,
        border: source === "inferred" ? `1px dashed ${color}90` : `1px solid transparent`,
      }}
    >
      {letter}
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
  lapsedClientDays,
}: {
  clients: ClientRow[];
  salonName: string;
  timezone: string;
  canManage: boolean;
  lapsedClientDays: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  const [detail, setDetail] = useState<ClientRow | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [mergeCandidate, setMergeCandidate] = useState<{ source: ClientRow; target: ClientRow } | null>(null);

  function importCsv() {
    startTransition(async () => {
      const result = await importClientsCsv(csv);
      if (!("success" in result)) toast(result.error, "error");
      else { toast(`${result.imported} clientes importados${result.skipped ? ` · ${result.skipped} duplicados ignorados` : ""}`); setCsv(""); setImportOpen(false); router.refresh(); }
    });
  }

  function redeem(client: ClientRow) {
    startTransition(async () => {
      const result = await redeemLoyaltyReward(client.id, 5, "R$ 10 de desconto");
      if ("error" in result && result.error) toast(result.error, "error");
      else { toast("Recompensa resgatada: R$ 10 de desconto"); setDetail(null); router.refresh(); }
    });
  }

  function merge(source: ClientRow, target: ClientRow) {
    startTransition(async () => {
      try {
        await mergeClients(source.id, target.id);
        toast(`Cadastros mesclados em ${target.name}.`);
        setMergeCandidate(null);
        setDetail(null);
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
    setHistoryExpanded(false);
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
        <Seg active={segment === "lapsed"} onClick={() => setSegment("lapsed")} icon={Clock} accent="#EF4444">Sumidos {lapsedClientDays}d+ ({counts.lapsed})</Seg>
        <Seg active={segment === "recurring"} onClick={() => setSegment("recurring")} icon={Repeat} accent="#A855F7">Recorrentes ({counts.recurring})</Seg>
        {canManage && <button onClick={() => setImportOpen((open) => !open)} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[12px] font-medium text-muted-foreground"><FileUp className="h-3.5 w-3.5" /> Importar planilha</button>}
      </div>

      {importOpen && <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4"><div className="mb-3 flex items-start justify-between"><div><p className="text-[13px] font-semibold">Importar clientes por CSV</p><p className="text-[11px] text-muted-foreground">Colunas aceitas: nome, telefone, email e aniversario. Duplicados são ignorados.</p></div><button onClick={() => setImportOpen(false)} aria-label="Fechar importação"><X className="h-4 w-4 text-muted-foreground" /></button></div><input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setCsv); }} className="mb-3 block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-card file:px-3 file:py-2 file:text-[11px] file:font-medium" /><textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={4} placeholder={'nome,telefone,email,aniversario\nAna,11999990000,ana@email.com,1990-08-20'} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[12px] outline-none" /><button onClick={importCsv} disabled={pending || !csv.trim()} className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-[12px] font-semibold text-primary-foreground disabled:opacity-50">{pending && <Loader2 className="h-4 w-4 animate-spin" />} Importar clientes</button></div>}

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
                    <GenderBadge gender={c.genderDisplay} source={c.genderSource} />
                    {c.isVip && <Crown className="h-3 w-3 shrink-0 text-[#F4C430]" />}
                    {c.birthdayThisMonth && <Cake className="h-3 w-3 shrink-0 text-[#EC4899]" />}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {c.visits} {c.visits === 1 ? "atendimento" : "atendimentos"}{c.favoritePro ? ` · ${c.favoritePro.split(" ")[0]}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {c.accountStatus === "registered" ? "Conta criada" : "Sem conta"}
                    </span>
                    {c.upcomingCount > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                        {c.upcomingCount === 1 ? "Próximo agendamento" : `${c.upcomingCount} próximos`}
                      </span>
                    )}
                    {c.possibleDuplicates.length > 0 && (
                      <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-300">
                        Possível duplicata
                      </span>
                    )}
                  </div>
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
        <DialogContent className="max-h-[88dvh] max-w-lg overflow-y-auto">
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
                      <GenderBadge gender={detail.genderDisplay} source={detail.genderSource} />
                      {detail.isVip && <Crown className="h-4 w-4 text-[#F4C430]" />}
                    </DialogTitle>
                    <p className="text-[12px] text-muted-foreground">
                      {detail.phone ?? detail.email ?? "sem contato"} · {detail.accountStatus === "registered" ? "conta criada" : "sem conta"}
                    </p>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex items-center gap-2">
                {detail.phone && (
                  <a href={waLink(detail.phone, detail.name.split(" ")[0], salonName)} target="_blank" rel="noopener noreferrer" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#25D366]/15 px-3 py-2 text-[13px] font-medium text-[#25D366] transition hover:bg-[#25D366]/25">
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                )}
                {canManage && (
                  <ClientForm
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
              </div>

              <div className="grid grid-cols-2 gap-2">
                <DStat icon={CircleDollarSign} label="LTV total" value={formatMoney(detail.totalSpent)} />
                <DStat icon={Star} label="Ticket médio" value={formatMoney(detail.avgTicket)} />
                <DStat icon={Repeat} label="Visitas" value={detail.visits.toString()} />
                <DStat icon={Clock} label="Último atendimento" value={detail.daysSince == null ? "nunca" : `${detail.daysSince}d atrás`} />
                <DStat icon={Clock} label="Próximo agendamento" value={detail.nextAppointmentAt ? formatInTimeZone(new Date(detail.nextAppointmentAt), timezone, "dd/MM · HH:mm") : "nenhum"} />
              </div>

              {detail.possibleDuplicates.length > 0 && canManage && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <div>
                      <p className="text-[12px] font-semibold text-amber-200">Possível cadastro duplicado</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        A coincidência de telefone ou e-mail não confirma que seja a mesma pessoa. Escolha o cadastro que deve permanecer e preserve o histórico.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {detail.possibleDuplicates.map((candidate) => (
                      <div key={candidate.id} className="rounded-lg border border-border bg-card px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold">{candidate.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {candidate.phone ?? candidate.email ?? "sem contato"} · {candidate.visits} {candidate.visits === 1 ? "atendimento" : "atendimentos"} · {candidate.hasAccount ? "conta criada" : "sem conta"}
                            </p>
                          </div>
                          <span className="shrink-0 text-[10px] text-amber-300">{candidate.matchReasons.map(duplicateReasonLabel).join(" + ")}</span>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setMergeCandidate({ source: candidateToRow(candidate, detail), target: detail })}
                            className="min-h-9 flex-1 rounded-lg border border-border px-2 text-[11px] font-medium hover:border-primary/60"
                          >
                            Manter este cadastro
                          </button>
                          <button
                            type="button"
                            onClick={() => setMergeCandidate({ source: detail, target: candidateToRow(candidate, detail) })}
                            className="min-h-9 flex-1 rounded-lg bg-primary/10 px-2 text-[11px] font-semibold text-primary hover:bg-primary/20"
                          >
                            Usar o outro
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <Info icon={User} label="Profissional favorito" value={detail.favoritePro ?? "—"} />
                <Info icon={Scissors} label="Serviço favorito" value={detail.favoriteService ?? "—"} />
                <Info icon={Cake} label="Aniversário" value={detail.birthday ? format(new Date(detail.birthday), "d 'de' MMMM", { locale: ptBR }) : "—"} />
                <Info icon={Layers} label="Pacotes/assinaturas" value={`${detail.activePackages} pac · ${detail.activeSubscriptions} plano`} />
              </div>

              <div className="rounded-xl border border-border bg-surface-1 p-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold">Fidelidade · {detail.loyaltyPoints} pontos</span>
                  <span className="text-muted-foreground">
                    {detail.nextLoyaltyTier
                      ? `${detail.loyaltyRemaining} para ${detail.nextLoyaltyTier}`
                      : "Nível máximo"}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${detail.loyaltyProgressPct}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2"><p className="text-[10px] text-muted-foreground">Cada atendimento concluído vale 1 ponto.</p>{canManage && <button onClick={() => redeem(detail)} disabled={pending || !detail.canRedeemLoyaltyReward} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary/10 px-2.5 text-[10px] font-semibold text-primary disabled:opacity-40"><Gift className="h-3.5 w-3.5" /> Resgatar recompensa</button>}</div>
              </div>

              {(detail.allergies || detail.preferences || detail.consentGiven) && (
                <div className="space-y-2 rounded-xl border border-border bg-card px-3 py-3 text-[12px]">
                  {detail.allergies && <Info icon={HeartPulse} label="Alergias e restrições" value={detail.allergies} wrap />}
                  {detail.preferences && <Info icon={Star} label="Preferências" value={detail.preferences} wrap />}
                  <Info
                    icon={ShieldCheck}
                    label="Consentimento para dados de atendimento"
                    value={detail.consentGiven ? "Registrado" : "Não registrado"}
                    wrap
                  />
                </div>
              )}

              {detail.notes && (
                <div className="rounded-xl bg-surface-1 px-3 py-2.5 text-[12px]">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Observações</p>
                  <p className="mt-0.5">{detail.notes}</p>
                </div>
              )}

              {/* Histórico */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[12px] font-semibold">Histórico de atendimentos</p>
                  {history && history.length > HISTORY_PREVIEW_COUNT && (
                    <button
                      type="button"
                      onClick={() => setHistoryExpanded((open) => !open)}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      {historyExpanded ? "Ver menos" : `Ver todos (${history.length})`}
                    </button>
                  )}
                </div>
                {loadingHist ? (
                  <div className="flex items-center gap-2 py-4 text-[12px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
                ) : history && history.length > 0 ? (
                  <div className="space-y-1.5">
                    {(historyExpanded ? history : history.slice(0, HISTORY_PREVIEW_COUNT)).map((h) => (
                      <div key={h.id} className="flex items-center gap-3 rounded-lg bg-surface-1 px-3 py-2">
                        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: h.serviceColor ?? "#2ECC8B" }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium">{h.serviceName}</p>
                          <p className="text-[10px] text-muted-foreground">{formatInTimeZone(new Date(h.startAt), timezone, "d MMM yyyy · HH:mm", { locale: ptBR })} · {h.proName.split(" ")[0]}</p>
                        </div>
                        <p className="text-[12px] font-semibold">{formatMoney(h.priceCents)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-2 text-[12px] text-muted-foreground">Sem atendimentos registrados.</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!mergeCandidate} onOpenChange={(open) => !open && setMergeCandidate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitMerge className="h-4 w-4 text-primary" /> Confirmar mesclagem</DialogTitle>
          </DialogHeader>
          {mergeCandidate && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                O histórico de <strong className="text-foreground">{mergeCandidate.source.name}</strong> será incorporado a <strong className="text-foreground">{mergeCandidate.target.name}</strong>. O cadastro de origem ficará preservado como mesclado e não aparecerá mais na lista.
              </p>
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
                Agendamentos, pacotes, assinaturas e pontos serão mantidos. Essa ação fica registrada na auditoria.
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setMergeCandidate(null)} className="min-h-10 rounded-lg border border-border px-4 text-sm">Cancelar</button>
                <button type="button" onClick={() => merge(mergeCandidate.source, mergeCandidate.target)} disabled={pending} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  <GitMerge className="h-4 w-4" /> {pending ? "Mesclando…" : "Confirmar mesclagem"}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
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

function duplicateReasonLabel(reason: "email" | "phone"): string {
  return reason === "email" ? "e-mail" : "telefone";
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

function Info({ icon: Icon, label, value, wrap = false }: { icon: typeof Star; label: string; value: string; wrap?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className={`${wrap ? "whitespace-pre-wrap" : "truncate"} font-medium`}>{value}</p>
      </div>
    </div>
  );
}
