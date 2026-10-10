import Link from "next/link";
import { requireRole } from "@/lib/tenant";
import { MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { emailInvitesEnabled } from "@/lib/email-invites-feature";
import { Check, ChevronRight, Circle, Crown, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BookingPreferencesPanel } from "./booking-preferences-panel";
import { SalonSettingsForm } from "./salon-settings-form";
import { AccessManager, type Member } from "./access-manager";
import { BrandingForm } from "./branding-form";
import { ClosuresManager, type Closure } from "./closures-manager";
import { ProfileForm } from "./profile-form";
import { getPlanEntitlement } from "@/lib/plan-entitlements";
import { SettingsSectionNav } from "./settings-section-nav";
import { PricingRulesManager } from "./pricing-rules-manager";
import { TeamHoursManager } from "./team-hours-manager";
import { billingEnabled } from "@/lib/billing/config";

const PLAN_LABEL: Record<string, string> = {
  FREE: "Grátis",
  STARTER: "Fundador",
  PRO: "Essencial",
  ENTERPRISE: "Equipe",
};

export default async function ConfiguracoesPage() {
  const ctx = await requireRole(MANAGEMENT_ROLES);
  const { salonId, userId, role } = ctx;
  const invitesEnabled = emailInvitesEnabled();

  const { salon, profile, memberships, pendingInvites, closures, pricingRules, setupCounts, teamHours } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: {
        name: true, address: true, phone: true, timezone: true, currency: true,
        plan: true, openMinutes: true, closeMinutes: true,
        cancelPolicyHours: true, noShowFeeCents: true,
        minBookingLeadMinutes: true, maxBookingLeadDays: true, bufferMinutes: true,
        // Personalização da vitrine
        slug: true, segment: true, description: true, coverUrl: true, coverShowName: true, logoUrl: true,
        themeColorHex: true, instagram: true, whatsapp: true,
        paymentMethods: true, importantInfo: true,
      },
    });
    const memberships = await tx.membership.findMany({
      where: { salonId },
      select: { role: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { role: "asc" },
    });
    const profile = await tx.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, phone: true, avatarUrl: true },
    });
    const pendingInvites =
      role === "OWNER" && invitesEnabled
        ? await tx.userInvite.findMany({
            where: {
              salonId,
              usedAt: null,
              createdAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000),
              },
            },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              deliveryStatus: true,
              sentAt: true,
              expiresAt: true,
              revokedAt: true,
            },
            orderBy: { createdAt: "desc" },
          })
        : [];
    const closures = await tx.salonClosure.findMany({
      where: { salonId, endAt: { gte: new Date() } },
      select: { id: true, startAt: true, endAt: true, reason: true },
      orderBy: { startAt: "asc" },
      take: 50,
    });
    const pricingRules = await tx.servicePricingRule.findMany({
      where: { salonId },
      orderBy: [{ targetType: "asc" }, { weekday: "asc" }, { date: "asc" }],
      select: {
        id: true,
        targetType: true,
        weekday: true,
        date: true,
        label: true,
        adjustmentType: true,
        adjustmentValue: true,
        active: true,
      },
    });
    const serviceCount = await tx.service.count({ where: { salonId, active: true } });
    const professionalCount = await tx.professional.count({ where: { salonId, active: true } });
    const clientCount = await tx.clientProfile.count({ where: { salonId } });
    const productCount = await tx.product.count({ where: { salonId, active: true } });
    const teamHours = await tx.professional.findMany({ where: { salonId, active: true }, select: { id: true, user: { select: { name: true } }, workingHours: { select: { weekday: true, startMinutes: true, endMinutes: true }, orderBy: [{ weekday: "asc" }, { startMinutes: "asc" }] } }, orderBy: { user: { name: "asc" } } });
    return { salon, profile, memberships, pendingInvites, closures, pricingRules, teamHours, setupCounts: { serviceCount, professionalCount, clientCount, productCount } };
  });

  if (!salon || !profile) return null;
  const entitlement = getPlanEntitlement(salon.plan);

  const members: Member[] = memberships.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    isSelf: m.user.id === userId,
  }));
  const canManage = role === "OWNER";

  return (
    <div className="space-y-5 lg:space-y-6">
      <div>
        <PageHeader title="Configurações" />
        <p className="mt-1 hidden max-w-2xl text-sm text-muted-foreground lg:block">
          Organize o estabelecimento, a agenda e os acessos da equipe por área.
        </p>
      </div>

      <SettingsSectionNav>
      <section id="primeiros-passos" className="scroll-mt-24"><SetupChecklist items={[
        { label: "Cadastrar serviços e preços", done: setupCounts.serviceCount > 0 },
        { label: "Cadastrar ao menos um profissional", done: setupCounts.professionalCount > 0 },
        { label: "Adicionar ou importar clientes", done: setupCounts.clientCount > 0 },
        { label: "Cadastrar produtos e estoque", done: setupCounts.productCount > 0 },
        { label: "Completar marca e WhatsApp", done: Boolean(salon.logoUrl && salon.whatsapp && salon.description) },
      ]} /></section>


        <section id="perfil" className="scroll-mt-24">
          <ProfileForm profile={profile} />
        </section>

        <section id="aparencia" className="scroll-mt-24">
          <BrandingForm
            branding={{
              slug: salon.slug,
              segment: salon.segment,
              description: salon.description,
              coverUrl: salon.coverUrl,
              coverShowName: salon.coverShowName,
              logoUrl: salon.logoUrl,
              themeColorHex: salon.themeColorHex,
              instagram: salon.instagram,
              whatsapp: salon.whatsapp,
              paymentMethods: salon.paymentMethods,
              importantInfo: salon.importantInfo,
            }}
          />
        </section>

        <section id="horarios" className="scroll-mt-24">
          <TeamHoursManager openMinutes={salon.openMinutes} closeMinutes={salon.closeMinutes} professionals={teamHours.map(p => ({ id: p.id, name: p.user.name, workingHours: p.workingHours }))} />
        </section>
        <section id="agenda" className="scroll-mt-24 space-y-4"><SalonSettingsForm salon={salon} /><BookingPreferencesPanel /></section>
        <section id="precos" className="scroll-mt-24">
            <PricingRulesManager
              canManage={role === "OWNER" || role === "MANAGER"}
              rules={pricingRules.map((rule) => ({
                ...rule,
                targetType: rule.targetType as "WEEKDAY" | "DATE",
                adjustmentType: rule.adjustmentType as "PERCENTAGE" | "FIXED_CENTS",
                date: rule.date?.toISOString() ?? null,
              }))}
            />
        </section>
        <section id="fechamentos" className="scroll-mt-24">
            <ClosuresManager
              timezone={salon.timezone}
              closures={closures.map((c): Closure => ({
                id: c.id,
                startAt: c.startAt.toISOString(),
                endAt: c.endAt.toISOString(),
                reason: c.reason,
              }))}
              canManage={role === "OWNER" || role === "MANAGER"}
            />
        </section>

        <section id="notificacoes" aria-labelledby="settings-notifications-title" className="scroll-mt-24 space-y-3.5 rounded-[14px] border border-border bg-card p-4">
          <h3 id="settings-notifications-title" className="sr-only">Notificações</h3>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Confirmações, reagendamentos e cancelamentos são organizados automaticamente. Abra a central para revisar avisos e marcar itens como lidos.
          </p>
          <Link href="/notificacoes" className={cn(buttonVariants({ variant: "outline" }), "group")}>
            Abrir central
            <ChevronRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </section>

          <section id="seguranca" aria-labelledby="settings-security-title" className="scroll-mt-24">
            <h3 id="settings-security-title" className="sr-only">Segurança e acessos</h3>
            <AccessManager
            members={members}
            canManage={canManage}
            invitesEnabled={invitesEnabled}
            pendingInvites={pendingInvites.map((invite) => ({
              ...invite,
              sentAt: invite.sentAt?.toISOString() ?? null,
              expiresAt: invite.expiresAt.toISOString(),
              revokedAt: invite.revokedAt?.toISOString() ?? null,
              }))}
            />
          </section>

          <section id="plano" aria-labelledby="settings-plan-title" className="scroll-mt-24 space-y-3.5 rounded-[14px] border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-muted text-foreground">
                <Crown aria-hidden="true" className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h3 id="settings-plan-title" className="text-sm font-semibold">{billingEnabled() ? "Plano e assinatura" : `Plano ${PLAN_LABEL[salon.plan] ?? salon.plan}`}</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {billingEnabled() ? "Consulte seu plano, pagamentos e período de acesso. Você pode cancelar a renovação a qualquer momento, sem perder o período já pago." : salon.plan === "FREE"
                    ? `1 agenda · até ${entitlement.monthlyAppointments} agendamentos por mês`
                    : `${entitlement.maxProfessionals} agendas incluídas · sem taxa por cliente`}
                </p>
                {!billingEnabled() && salon.plan !== "FREE" && entitlement.priceCents > 0 && (
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {"R$\u00a0"}{(entitlement.priceCents / 100).toFixed(2).replace(".", ",")}/mês
                  </p>
                )}
              </div>
            </div>
            {billingEnabled() && role === "OWNER"
              ? <Link className={buttonVariants()} href="/assinatura">Gerenciar ou cancelar assinatura</Link>
              : <p className="rounded-xl border border-border-strong bg-background px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">A gestão do plano e da assinatura fica protegida e será liberada somente quando o faturamento estiver configurado.</p>}
          </section>
      </SettingsSectionNav>
    </div>
  );
}

function SetupChecklist({ items }: { items: Array<{ label: string; done: boolean }> }) {
  const completed = items.filter((item) => item.done).length;
  return <div className="space-y-3.5 rounded-[14px] border border-border bg-card p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ListChecks aria-hidden="true" className="h-4 w-4 text-muted-foreground" />Checklist de configuração</h3>
        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{completed} de {items.length} etapas concluídas</p>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted sm:max-w-52"><div className="h-full rounded-full bg-[hsl(var(--selection-solid))]" style={{ width: `${Math.round((completed / items.length) * 100)}%` }} /></div>
    </div>
    <ul className="grid gap-2 sm:grid-cols-2">{items.map((item) => <li key={item.label} className={`flex min-h-11 items-center gap-2.5 rounded-xl border border-border px-3.5 py-2.5 text-sm ${item.done ? "bg-background text-foreground" : "text-muted-foreground"}`}>
      {item.done ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-success" /> : <Circle aria-hidden="true" className="h-4 w-4 shrink-0" />}
      <span className="min-w-0">{item.label}<span className="sr-only">{item.done ? " · concluído" : " · pendente"}</span></span>
    </li>)}</ul>
  </div>;
}
