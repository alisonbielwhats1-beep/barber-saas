import { requireRole } from "@/lib/tenant";
import { MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { emailInvitesEnabled } from "@/lib/email-invites-feature";
import { Crown } from "lucide-react";
import { SalonSettingsForm } from "./salon-settings-form";
import { AccessManager, type Member } from "./access-manager";
import { BrandingForm } from "./branding-form";
import { ClosuresManager, type Closure } from "./closures-manager";
import { ProfileForm } from "./profile-form";

const PLAN_LABEL: Record<string, string> = {
  FREE: "Grátis",
  STARTER: "Starter",
  PRO: "Pro",
  ENTERPRISE: "Enterprise",
};

export default async function ConfiguracoesPage() {
  const ctx = await requireRole(MANAGEMENT_ROLES);
  const { salonId, userId, role } = ctx;
  const invitesEnabled = emailInvitesEnabled();

  const { salon, profile, memberships, pendingInvites, closures } = await withTenant(ctx, async (tx) => {
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
    return { salon, profile, memberships, pendingInvites, closures };
  });

  if (!salon || !profile) return null;

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

      {/* Plano atual */}
      <div className="flex items-center justify-between rounded-2xl border border-primary/25 bg-primary/5 p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <Crown className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[13px] font-semibold">Plano {PLAN_LABEL[salon.plan] ?? salon.plan}</p>
            <p className="text-[11px] text-muted-foreground">
              {salon.plan === "FREE" ? "Faça upgrade para desbloquear mais recursos." : "Assinatura ativa."}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
          Gerenciar assinatura em breve
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <ProfileForm profile={profile} />
          <SalonSettingsForm salon={salon} />
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
        </div>
        <div className="lg:col-span-2">
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
        </div>
      </div>

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
  );
}
