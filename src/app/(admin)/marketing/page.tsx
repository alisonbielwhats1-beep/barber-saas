import { formatInTimeZone } from "date-fns-tz";
import { Cake, Clock, Copy, Crown, History, Megaphone, MessageCircle } from "lucide-react";
import { getClientList } from "@/lib/crm";
import { summarizeCampaignDeliveries } from "@/lib/operational-flows";
import { withTenant } from "@/lib/prisma-tenant";
import { MARKETING_ROLES } from "@/lib/role-permissions";
import { requireRole } from "@/lib/tenant";
import { MarketingCampaigns } from "./marketing-campaigns";

export default async function MarketingPage() {
  const ctx = await requireRole(MARKETING_ROLES);
  const { clients, salon, history } = await withTenant(ctx, async (tx) => {
    const clients = await getClientList(tx, ctx.salonId);
    const salon = await tx.salon.findUnique({ where: { id: ctx.salonId }, select: { name: true, timezone: true } });
    const history = await tx.auditLog.findMany({
      where: { salonId: ctx.salonId, action: "MARKETING_INTERACTION", entityType: "ClientProfile" },
      orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, actorName: true, createdAt: true, metadata: true },
    });
    return { clients, salon, history };
  });

  const toTarget = (client: { id: string; name: string; phone: string | null }) => ({ id: client.id, name: client.name, phone: client.phone });
  const birthdays = clients.filter((client) => client.birthdayThisMonth).map(toTarget);
  const lapsed = clients.filter((client) => client.isLapsed).map(toTarget);
  const vips = clients.filter((client) => client.isVip).map(toTarget);
  const attended = clients.filter((client) => client.visits > 0).map(toTarget);
  const interactions = history.flatMap((item) => {
    const metadata = item.metadata as Record<string, unknown> | null;
    return typeof metadata?.campaignKey === "string" && typeof metadata.clientId === "string" && (metadata.status === "OPENED" || metadata.status === "COPIED")
      ? [{ campaignKey: metadata.campaignKey, clientId: metadata.clientId, status: metadata.status as "OPENED" | "COPIED" }]
      : [];
  });
  const summary = summarizeCampaignDeliveries(interactions);

  return (
    <div className="space-y-6">
      <header><p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Crescimento</p><h1 className="text-[26px] font-semibold tracking-tight">Marketing</h1></header>
      <section className="grid grid-cols-3 gap-3">
        <Kpi icon={Cake} accent="#EC4899" label="Aniversariantes" value={birthdays.length.toString()} />
        <Kpi icon={Clock} accent="#EF4444" label="Sumidos p/ resgate" value={lapsed.length.toString()} />
        <Kpi icon={Crown} accent="#F4C430" label="VIPs" value={vips.length.toString()} />
      </section>
      <div className="flex items-start gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-4"><Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="text-[12px] text-muted-foreground">Escolha uma campanha, selecione os destinatários e abra o WhatsApp com a mensagem personalizada. O sistema registra a preparação para você acompanhar o trabalho.</p></div>
      <MarketingCampaigns allClients={clients.map(toTarget)} birthdays={birthdays} lapsed={lapsed} vips={vips} attended={attended} salonName={salon?.name ?? "nosso salão"} />

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="flex items-center gap-2 text-[14px] font-semibold"><History className="h-4 w-4 text-primary" /> Histórico de campanhas</h2><p className="mt-0.5 text-[11px] text-muted-foreground">Registra a preparação manual; não afirma que a mensagem foi entregue pelo WhatsApp.</p></div>
          <div className="flex gap-2 text-[10px]"><span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">{summary.uniqueClients} clientes</span><span className="rounded-full bg-surface-1 px-2.5 py-1 text-muted-foreground">{summary.openedWhatsApp} aberturas</span><span className="rounded-full bg-surface-1 px-2.5 py-1 text-muted-foreground">{summary.copied} cópias</span></div>
        </div>
        {history.length === 0 ? <p className="p-8 text-center text-[12px] text-muted-foreground">O histórico aparecerá depois da primeira interação.</p> : history.slice(0, 12).map((item) => {
          const metadata = item.metadata as Record<string, unknown> | null;
          const opened = metadata?.status === "OPENED";
          return <div key={item.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:px-5"><span className={`grid h-8 w-8 place-items-center rounded-lg ${opened ? "bg-[#25D366]/10 text-[#25D366]" : "bg-primary/10 text-primary"}`}>{opened ? <MessageCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">{String(metadata?.clientName ?? "Cliente")}</p><p className="text-[10px] text-muted-foreground">{String(metadata?.campaignKey ?? "campanha")} · por {item.actorName}</p></div><p className="text-[10px] text-muted-foreground">{formatInTimeZone(item.createdAt, salon?.timezone ?? "America/Sao_Paulo", "dd/MM · HH:mm")}</p></div>;
        })}
      </section>
    </div>
  );
}

function Kpi({ icon: Icon, accent, label, value }: { icon: React.ComponentType<{ className?: string }>; accent: string; label: string; value: string }) {
  return <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}><Icon className="h-4 w-4" /></span><div className="min-w-0"><p className="text-lg font-semibold leading-none tracking-tight">{value}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p></div></div>;
}
