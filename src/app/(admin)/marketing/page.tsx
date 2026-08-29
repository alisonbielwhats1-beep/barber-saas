import { formatInTimeZone } from "date-fns-tz";
import {
  ArrowRight,
  Cake,
  Clock,
  Copy,
  Crown,
  History,
  Megaphone,
  MessageCircle,
  Sparkles,
  Star,
  UserPlus,
} from "lucide-react";
import { getClientList } from "@/lib/crm";
import { getMarketingSettings } from "@/lib/marketing-settings";
import { summarizeCampaignDeliveries } from "@/lib/operational-flows";
import { withTenant } from "@/lib/prisma-tenant";
import { MARKETING_ROLES } from "@/lib/role-permissions";
import { requireRole } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { canUsePlanFeature } from "@/lib/plan-entitlements";
import { MarketingCampaigns } from "./marketing-campaigns";
import { MarketingSettingsForm } from "./marketing-settings-form";

export default async function MarketingPage() {
  const ctx = await requireRole(MARKETING_ROLES);
  const { clients, salon, history, settings } = await withTenant(ctx, async (tx) => {
    const settings = await getMarketingSettings(tx, ctx.salonId);
    const clients = await getClientList(tx, ctx.salonId, {
      lapsedClientDays: settings.lapsedClientDays,
    });
      const salon = await tx.salon.findUnique({
        where: { id: ctx.salonId },
      select: { name: true, timezone: true, slug: true, plan: true },
    });
    const history = await tx.auditLog.findMany({
      where: {
        salonId: ctx.salonId,
        action: "MARKETING_INTERACTION",
        entityType: "ClientProfile",
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, actorName: true, createdAt: true, metadata: true },
    });
    return { clients, salon, history, settings };
  });

  const toTarget = (client: (typeof clients)[number]) => ({
    id: client.id,
    name: client.name,
    phone: client.phone,
    daysSince: client.daysSince,
    favoriteService: client.favoriteService,
  });
  const birthdays = clients.filter((client) => client.birthdayThisMonth).map(toTarget);
  const lapsedClients = clients.filter((client) => client.isLapsed);
  const lapsed = lapsedClients.map(toTarget);
  const vips = clients.filter((client) => client.isVip).map(toTarget);
  const attended = clients.filter((client) => client.visits > 0).map(toTarget);
  const estimatedReturn = lapsedClients.reduce((sum, client) => sum + client.avgTicket, 0);
  const interactions = history.flatMap((item) => {
    const metadata = item.metadata as Record<string, unknown> | null;
    return typeof metadata?.campaignKey === "string"
      && typeof metadata.clientId === "string"
      && (metadata.status === "OPENED" || metadata.status === "COPIED")
      ? [{
          campaignKey: metadata.campaignKey,
          clientId: metadata.clientId,
          status: metadata.status as "OPENED" | "COPIED",
        }]
      : [];
  });
  const summary = summarizeCampaignDeliveries(interactions);
  const marketingEnabled = canUsePlanFeature(salon?.plan, "MARKETING");

  return (
    <div className="space-y-6">
      <header>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Crescimento</p>
        <h1 className="text-[26px] font-semibold tracking-tight">Marketing</h1>
        <p className="mt-1 max-w-2xl text-[12px] text-muted-foreground">Transforme sua base atual em retorno, avaliações e indicações — com mensagens pessoais, sem disparo automático.</p>
      </header>

      {!marketingEnabled && (
        <section className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <Crown className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-[12px] font-semibold">Marketing fica disponível no plano Fundador</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Você continua vendo sua base e histórico. Ao fazer upgrade, poderá preparar campanhas e abrir mensagens pelo WhatsApp.
            </p>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <Kpi icon={Cake} accent="#EC4899" label="Aniversariantes" value={birthdays.length.toString()} />
        <Kpi icon={Clock} accent="#EF4444" label={`Sumidos · ${settings.lapsedClientDays}d+`} value={lapsed.length.toString()} />
        <Kpi icon={Crown} accent="#F4C430" label="VIPs" value={vips.length.toString()} />
      </section>

      <section className="overflow-hidden rounded-3xl border border-primary/25 bg-card">
        <div className="grid lg:grid-cols-[1.45fr_1fr]">
          <div className="border-b border-border p-5 sm:p-7 lg:border-b-0 lg:border-r">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Foco da semana
            </span>
            <h2 className="mt-4 max-w-xl text-xl font-semibold tracking-tight sm:text-2xl">
              Reative {lapsed.length} {lapsed.length === 1 ? "cliente que já conhece" : "clientes que já conhecem"} seu trabalho.
            </h2>
            <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
              Eles estão há pelo menos {settings.lapsedClientDays} dias sem voltar. Se cada um repetir uma visita no ticket médio anterior, a oportunidade estimada é de <strong className="text-foreground">{formatMoney(estimatedReturn)}</strong>.
            </p>
            <a href="#campanhas" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-[12px] font-semibold text-primary-foreground">
              Preparar resgate <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-1">
            <GrowthIdea icon={Star} title="Reputação local" text={settings.googleReviewUrl ? `${attended.length} clientes atendidos podem receber seu link do Google.` : "Cadastre o link do Google para pedir avaliações depois do atendimento."} />
            <GrowthIdea icon={UserPlus} title="Indicação" text={`${vips.length} clientes VIP podem compartilhar seu link de agendamento com amigos.`} divider />
          </div>
        </div>
      </section>

      {ctx.role === "OWNER" ? (
        <MarketingSettingsForm
          lapsedClientDays={settings.lapsedClientDays}
          googleReviewUrl={settings.googleReviewUrl}
          disabled={!marketingEnabled}
        />
      ) : (
        <div className="rounded-2xl border border-border bg-card px-4 py-3 text-[11px] text-muted-foreground">
          O dono definiu clientes sumidos após <strong className="text-foreground">{settings.lapsedClientDays} dias</strong>.
        </div>
      )}

      <div className="flex items-start gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-[12px] text-muted-foreground">Escolha uma campanha, revise a mensagem e abra o WhatsApp do destinatário. O sistema registra a preparação para você acompanhar a execução.</p>
      </div>

      <div id="campanhas" className="scroll-mt-4">
        <MarketingCampaigns
          allClients={clients.map(toTarget)}
          birthdays={birthdays}
          lapsed={lapsed}
          vips={vips}
          attended={attended}
          salonName={salon?.name ?? "nosso salão"}
          bookingUrl={`${(process.env.NEXTAUTH_URL ?? "https://salon-saas-ruby.vercel.app").replace(/\/$/, "")}/book/${salon?.slug ?? ""}`}
          googleReviewUrl={settings.googleReviewUrl}
          lapsedClientDays={settings.lapsedClientDays}
          enabled={marketingEnabled}
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-[14px] font-semibold"><History className="h-4 w-4 text-primary" /> Histórico de campanhas</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Registra a preparação manual; não afirma que a mensagem foi entregue pelo WhatsApp.</p>
          </div>
          <div className="flex gap-2 text-[10px]">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">{summary.uniqueClients} clientes</span>
            <span className="rounded-full bg-surface-1 px-2.5 py-1 text-muted-foreground">{summary.openedWhatsApp} aberturas</span>
            <span className="rounded-full bg-surface-1 px-2.5 py-1 text-muted-foreground">{summary.copied} cópias</span>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="p-8 text-center text-[12px] text-muted-foreground">O histórico aparecerá depois da primeira interação.</p>
        ) : history.slice(0, 12).map((item) => {
          const metadata = item.metadata as Record<string, unknown> | null;
          const opened = metadata?.status === "OPENED";
          return (
            <div key={item.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:px-5">
              <span className={`grid h-8 w-8 place-items-center rounded-lg ${opened ? "bg-[#25D366]/10 text-[#25D366]" : "bg-primary/10 text-primary"}`}>
                {opened ? <MessageCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">{String(metadata?.clientName ?? "Cliente")}</p>
                <p className="text-[10px] text-muted-foreground">{String(metadata?.campaignKey ?? "campanha")} · por {item.actorName}</p>
              </div>
              <p className="text-[10px] text-muted-foreground">{formatInTimeZone(item.createdAt, salon?.timezone ?? "America/Sao_Paulo", "dd/MM · HH:mm")}</p>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Kpi({ icon: Icon, accent, label, value }: { icon: React.ComponentType<{ className?: string }>; accent: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0"><p className="text-lg font-semibold leading-none tracking-tight">{value}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p></div>
    </div>
  );
}

function GrowthIdea({ icon: Icon, title, text, divider = false }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; divider?: boolean }) {
  return (
    <div className={`p-5 ${divider ? "border-t border-border sm:border-l sm:border-t-0 lg:border-l-0 lg:border-t" : ""}`}>
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-3 text-[13px] font-semibold">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}
