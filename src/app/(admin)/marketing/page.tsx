import { featureEntitlement } from "@/lib/billing/plan-grants";
import { formatInTimeZone } from "date-fns-tz";
import {
  ArrowRight,
  Cake,
  ChevronDown,
  Clock,
  Copy,
  Crown,
  History,
  Megaphone,
  MessageCircle,
  SlidersHorizontal,
  Sparkles,
  Star,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getClientList } from "@/lib/crm";
import { getMarketingSettings } from "@/lib/marketing-settings";
import { getPublicBookingUrl } from "@/lib/public-booking-url";
import { summarizeCampaignDeliveries } from "@/lib/operational-flows";
import { withTenant } from "@/lib/prisma-tenant";
import { MARKETING_ROLES } from "@/lib/role-permissions";
import { requireRole } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { canUsePlanFeature } from "@/lib/plan-entitlements";
import { PlanUpgradeAction } from "@/components/plan-upgrade-action";
import { MarketingCampaigns } from "./marketing-campaigns";
import { MarketingSettingsForm } from "./marketing-settings-form";

/** Names shown in the history; the record keeps only the campaign key. */
const CAMPAIGN_TITLES: Record<string, string> = {
  all: "Todos os clientes",
  lapsed: "Lembrete de sumidos",
  birthday: "Aniversariantes do mês",
  review: "Pedir avaliação",
  referral: "Programa de indicação",
  vip: "Novidades para VIPs",
};

export default async function MarketingPage() {
  const ctx = await requireRole(MARKETING_ROLES);
  const { clients, salon, history, settings, plan } = await withTenant(ctx, async (tx) => {
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
    return { clients, salon, history, settings, plan: await featureEntitlement(tx, ctx.salonId, salon?.plan) };
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
  const marketingEnabled = canUsePlanFeature(plan, "MARKETING");

  return (
    <div className="space-y-4 lg:space-y-6">
      <div>
        <PageHeader title="Marketing" />
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Transforme sua base atual em retorno, avaliações e indicações — com mensagens pessoais, sem disparo automático.</p>
      </div>

      {!marketingEnabled && (
        <section className="flex items-start gap-2.5 rounded-xl border border-border-strong bg-card px-3.5 py-3">
          <Crown aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Marketing fica disponível nos planos pagos</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Você continua vendo sua base e histórico. Ao contratar um plano pago, poderá preparar campanhas e abrir mensagens pelo WhatsApp.
            </p>
            <PlanUpgradeAction role={ctx.role} className="text-sm" />
          </div>
        </section>
      )}

      <section aria-label="Indicadores de marketing" className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
        <Kpi icon={Cake} tone="brand" label="Aniversariantes" value={birthdays.length.toString()} className="col-span-2 lg:col-span-1" />
        <Kpi icon={Clock} tone="warning" label={`Sumidos · ${settings.lapsedClientDays}d+`} value={lapsed.length.toString()} />
        <Kpi icon={Crown} tone="brand" label="VIPs" value={vips.length.toString()} />
      </section>

      <section aria-label="Foco da semana" className="space-y-3 rounded-[14px] border border-border bg-card p-4">
        <span className="inline-flex min-h-[22px] items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" /> Foco da semana
        </span>
        <h2 className="max-w-2xl text-base font-semibold leading-snug tracking-[-0.01em]">
          {lapsed.length > 0 ? <>Reative {lapsed.length} {lapsed.length === 1 ? "cliente que já conhece" : "clientes que já conhecem"} seu trabalho.</> : "Nenhum cliente precisa de resgate agora."}
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {lapsed.length > 0 ? <>Eles estão há pelo menos {settings.lapsedClientDays} dias sem voltar. Se cada um repetir uma visita no ticket médio anterior, a oportunidade estimada é de <strong className="whitespace-nowrap font-semibold text-foreground tabular-nums">{formatMoney(estimatedReturn)}</strong>.</> : <>Não há clientes na faixa de {settings.lapsedClientDays} dias sem retorno. Confira as campanhas de aniversário, avaliações e indicações.</>}
        </p>
        <a href="#campanhas" className={buttonVariants()}>
          {lapsed.length > 0 ? "Preparar resgate" : "Ver campanhas"} <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </a>
        <div className="grid gap-2.5 border-t border-border pt-3 sm:grid-cols-2 sm:gap-[18px]">
          <GrowthIdea icon={Star} title="Reputação local" text={settings.googleReviewUrl ? `${attended.length} clientes atendidos podem receber seu link do Google.` : "Cadastre o link do Google para pedir avaliações depois do atendimento."} />
          <GrowthIdea icon={UserPlus} title="Indicação" text={`${vips.length} clientes VIP podem compartilhar seu link de agendamento com amigos.`} />
        </div>
      </section>

      <div id="campanhas" className="scroll-mt-4">
        <MarketingCampaigns
          allClients={clients.map(toTarget)}
          birthdays={birthdays}
          lapsed={lapsed}
          vips={vips}
          attended={attended}
          salonName={salon?.name ?? "nosso salão"}
          bookingUrl={getPublicBookingUrl(salon?.slug ?? "")}
          googleReviewUrl={settings.googleReviewUrl}
          lapsedClientDays={settings.lapsedClientDays}
          enabled={marketingEnabled}
        />
      </div>

      <details className="group space-y-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2.5 rounded-[14px] border border-border bg-card px-3.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-10 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2.5"><SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-muted-foreground" />Regras e orientações</span>
          <ChevronDown aria-hidden="true" className="h-[18px] w-[18px] text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4">
          {ctx.role === "OWNER" ? (
            <MarketingSettingsForm
              lapsedClientDays={settings.lapsedClientDays}
              googleReviewUrl={settings.googleReviewUrl}
              disabled={!marketingEnabled}
            />
          ) : (
            <div className="rounded-xl border border-border-strong bg-card px-3.5 py-3 text-sm text-muted-foreground">
              O dono definiu clientes sumidos após <strong className="font-semibold text-foreground">{settings.lapsedClientDays} dias</strong>.
            </div>
          )}

          <div className="flex items-start gap-2.5 rounded-xl border border-border-strong bg-card px-3.5 py-3">
            <Megaphone aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm leading-relaxed text-muted-foreground">Escolha uma campanha, revise a mensagem e abra o WhatsApp do destinatário. O sistema registra a preparação para você acompanhar a execução.</p>
          </div>
        </div>
      </details>

      <section aria-labelledby="marketing-history-title" className="overflow-hidden rounded-[14px] border border-border bg-card">
        <div className={cn("space-y-2.5 px-4 py-3.5", history.length > 0 && "border-b border-border")}>
          <div>
            <h2 id="marketing-history-title" className="flex items-center gap-2 text-sm font-semibold"><History aria-hidden="true" className="h-4 w-4 text-muted-foreground" /> Histórico de campanhas</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Registra a preparação manual; não afirma que a mensagem foi entregue pelo WhatsApp.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs tabular-nums">
            <span className="inline-flex min-h-[22px] items-center rounded-full bg-muted px-2.5 font-medium text-foreground">{summary.uniqueClients} clientes</span>
            <span className="inline-flex min-h-[22px] items-center rounded-full bg-muted px-2.5 font-medium text-muted-foreground">{summary.openedWhatsApp} aberturas</span>
            <span className="inline-flex min-h-[22px] items-center rounded-full bg-muted px-2.5 font-medium text-muted-foreground">{summary.copied} cópias</span>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="p-7 text-center text-sm text-muted-foreground">O histórico aparecerá depois da primeira interação.</p>
        ) : history.slice(0, 12).map((item) => {
          const metadata = item.metadata as Record<string, unknown> | null;
          const opened = metadata?.status === "OPENED";
          const campaignKey = String(metadata?.campaignKey ?? "campanha");
          const when = formatInTimeZone(item.createdAt, salon?.timezone ?? "America/Sao_Paulo", "dd/MM · HH:mm");
          return (
            <div key={item.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
              <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-muted text-foreground">
                {opened ? <MessageCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">{String(metadata?.clientName ?? "Cliente")}</p>
                <p className="text-xs text-muted-foreground">{CAMPAIGN_TITLES[campaignKey] ?? campaignKey} · por {item.actorName}</p>
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground sm:hidden">{when}</p>
              </div>
              <p className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">{when}</p>
            </div>
          );
        })}
      </section>
    </div>
  );
}

const KPI_TONE = {
  brand: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  neutral: "bg-muted text-muted-foreground",
} as const;

function Kpi({ icon: Icon, tone, label, value, className }: { icon: LucideIcon; tone: keyof typeof KPI_TONE; label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex min-h-24 flex-col gap-1.5 rounded-[14px] border border-border bg-card px-3.5 py-3 lg:gap-2 lg:p-4", className)}>
      <p className="flex items-start justify-between gap-1.5 text-xs font-medium leading-snug text-muted-foreground">
        {label}
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", KPI_TONE[tone])}><Icon aria-hidden="true" className="h-4 w-4" /></span>
      </p>
      <p className="mt-auto whitespace-nowrap text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function GrowthIdea({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-muted text-foreground"><Icon aria-hidden="true" className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{text}</span>
      </span>
    </div>
  );
}
