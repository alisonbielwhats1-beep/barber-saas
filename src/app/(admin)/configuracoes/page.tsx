import Link from "next/link";
import { requireRole } from "@/lib/tenant";
import { MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { emailInvitesEnabled } from "@/lib/email-invites-feature";
import { ArrowRight, Bell, Check, Circle, Crown, ListChecks } from "lucide-react";
import { SalonSettingsForm } from "./salon-settings-form";
import { AccessManager, type Member } from "./access-manager";
import { BrandingForm } from "./branding-form";
import { ClosuresManager, type Closure } from "./closures-manager";
import { ProfileForm } from "./profile-form";
import { getPlanEntitlement } from "@/lib/plan-entitlements";
import { SettingsSectionNav } from "./settings-section-nav";

const PLAN_LABEL: Record<string, string> = {
  FREE: "Grátis",
  STARTER: "Fundador",
  PRO: "Pro",
  ENTERPRISE: "Equipe",
};

export default async function ConfiguracoesPage() {
  const ctx = await requireRole(MANAGEMENT_ROLES);
  const { salonId, userId, role } = ctx;
  const invitesEnabled = emailInvitesEnabled();

  const { salon, profile, memberships, pendingInvites, closures, setupCounts } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: {
        name: true, address: true, phone: true, timezone: true, currency: true,
        plan: true, openMinutes: true, closeMinutes: true,
        cancelPolicyHours: true, noShowFeeCents: true,
        minBookingLeadMinutes: true, maxBookingLeadDays: true, bufferMinutes: true,
        // Personalização da vitrine
        slug: true, segment: true, description: true, coverUrl: true, logoUrl: true,
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
    const serviceCount = await tx.service.count({ where: { salonId, active: true } });
    const professionalCount = await tx.professional.count({ where: { salonId, active: true } });
    const clientCount = await tx.clientProfile.count({ where: { salonId } });
    const productCount = await tx.product.count({ where: { salonId, active: true } });
    return { salon, profile, memberships, pendingInvites, closures, setupCounts: { serviceCount, professionalCount, clientCount, productCount } };
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
    <div className="space-y-6">
      <header>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Ajustes
        </p>
        <h1 className="text-[26px] font-semibold tracking-tight">Configurações</h1>
      </header>

      <SetupChecklist items={[
        { label: "Cadastrar serviços e preços", done: setupCounts.serviceCount > 0 },
        { label: "Cadastrar ao menos um profissional", done: setupCounts.professionalCount > 0 },
        { label: "Adicionar ou importar clientes", done: setupCounts.clientCount > 0 },
        { label: "Cadastrar produtos e estoque", done: setupCounts.productCount > 0 },
        { label: "Completar marca e WhatsApp", done: Boolean(salon.logoUrl && salon.whatsapp && salon.description) },
      ]} />

      <SettingsSectionNav />

      <div className="space-y-6">
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
              logoUrl: salon.logoUrl,
              themeColorHex: salon.themeColorHex,
              instagram: salon.instagram,
              whatsapp: salon.whatsapp,
              paymentMethods: salon.paymentMethods,
              importantInfo: salon.importantInfo,
            }}
          />
        </section>

        <section id="agenda" className="scroll-mt-24">
          <SalonSettingsForm salon={salon} />
          <div className="mt-6">
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
          </div>
        </section>

        <section id="notificacoes" aria-labelledby="settings-notifications-title" className="scroll-mt-24 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
                <Bell aria-hidden="true" className="h-5 w-5" />
              </span>
              <div>
                <h2 id="settings-notifications-title" className="text-[14px] font-semibold">Notificações</h2>
                <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
                  Confirmações, reagendamentos e cancelamentos são organizados automaticamente. Abra a central para revisar avisos e marcar itens como lidos.
                </p>
              </div>
            </div>
            <Link href="/notificacoes" className="group inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border px-3.5 text-[12px] font-semibold transition-colors hover:border-border-strong hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Abrir central
              <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-5">
          <section id="seguranca" aria-labelledby="settings-security-title" className="scroll-mt-24 lg:col-span-3">
            <h2 id="settings-security-title" className="sr-only">Segurança e acessos</h2>
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

          <section id="plano" aria-labelledby="settings-plan-title" className="scroll-mt-24 lg:col-span-2">
            <div className="flex h-full flex-col justify-between rounded-2xl border border-primary/25 bg-primary/5 p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                  <Crown aria-hidden="true" className="h-5 w-5" />
                </span>
                <div>
                  <h2 id="settings-plan-title" className="text-[13px] font-semibold">Plano {PLAN_LABEL[salon.plan] ?? salon.plan}</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {salon.plan === "FREE"
                      ? `1 agenda · até ${entitlement.monthlyAppointments} agendamentos por mês`
                      : `${entitlement.maxProfessionals} agendas incluídas · sem taxa por cliente`}
                  </p>
                  {salon.plan !== "FREE" && entitlement.priceCents > 0 && (
                    <p className="mt-1 text-[11px] font-medium text-primary">
                      R$ {(entitlement.priceCents / 100).toFixed(2).replace(".", ",")}/mês
                    </p>
                  )}
                </div>
              </div>
              <p className="mt-5 rounded-xl border border-border bg-card/70 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                A gestão do plano e da assinatura fica protegida e será liberada somente quando o faturamento estiver configurado.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SetupChecklist({ items }: { items: Array<{ label: string; done: boolean }> }) {
  const completed = items.filter((item) => item.done).length;
  return <section className="rounded-2xl border border-border bg-card p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-[14px] font-semibold"><ListChecks className="h-4 w-4 text-primary" /> Checklist de configuração</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{completed} de {items.length} etapas concluídas</p></div><div className="h-2 w-full max-w-52 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((completed / items.length) * 100)}%` }} /></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{items.map((item) => <div key={item.label} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] ${item.done ? "border-success/20 bg-success/5 text-foreground" : "border-border bg-surface-1 text-muted-foreground"}`}>{item.done ? <Check className="h-3.5 w-3.5 shrink-0 text-success" /> : <Circle className="h-3.5 w-3.5 shrink-0" />}<span>{item.label}</span></div>)}</div></section>;
}
