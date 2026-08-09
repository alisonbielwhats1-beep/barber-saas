import Image from "next/image";
import { emailInvitesEnabled } from "@/lib/email-invites-feature";
import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getTeamPerformance } from "@/lib/team";
import { formatMoney, formatDuration } from "@/lib/utils";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import {
  Users,
  CircleDollarSign,
  Receipt,
  CalendarCheck,
  Repeat,
  UserX,
  Timer,
  Trophy,
  Target,
} from "lucide-react";
import { ProfessionalForm } from "./professional-form";
import { WorkingHoursForm } from "./working-hours-form";
import { ToggleActiveButton } from "./toggle-active-button";
import { PendingInvites } from "./pending-invites";
import { PageHeader } from "@/components/page-header";
import { getBusinessExperience } from "@/config/business-experience";

const MEDAL = ["#F4C430", "#C0C0C0", "#CD7F32"]; // ouro, prata, bronze

export default async function ProfissionaisPage() {
  const ctx = await getTenantContext();
  const { salonId, role } = ctx;
  const invitesEnabled = emailInvitesEnabled();
  const canManageTeam = role === "OWNER" || role === "MANAGER";
  const canSeeFinancial = role === "OWNER" || role === "MANAGER" || role === "SUPER_ADMIN";
  const isProfessional = role === "PROFESSIONAL";

  const { perf, services, pendingInvites, timezone, segment } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUniqueOrThrow({
      where: { id: salonId },
      select: { timezone: true, segment: true },
    });
    const ownProfessional = isProfessional
      ? await tx.professional.findFirst({
          where: { salonId, userId: ctx.userId, active: true },
          select: { id: true },
        })
      : null;
    const perf = await getTeamPerformance(
      tx,
      salonId,
      salon.timezone,
      isProfessional ? (ownProfessional?.id ?? "__professional_not_found__") : undefined,
    );
    const services = await tx.service.findMany({
      where: { salonId, active: true },
      select: { id: true, name: true, colorHex: true },
      orderBy: { name: "asc" },
    });
    const pendingInvites =
      ["OWNER", "MANAGER"].includes(role) && invitesEnabled
        ? await tx.userInvite.findMany({
            where: {
              salonId,
              role: "PROFESSIONAL",
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
              createdAt: true,
              sentAt: true,
              expiresAt: true,
              revokedAt: true,
              deliveryStatus: true,
            },
            orderBy: { createdAt: "desc" },
          })
        : [];
    return {
      perf,
      services,
      pendingInvites,
      timezone: salon.timezone,
      segment: salon.segment,
    };
  });

  const monthLabel = formatInTimeZone(perf.period.from, timezone, "MMMM yyyy", { locale: ptBR });
  const experience = getBusinessExperience(segment);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={`Equipe · ${monthLabel}`}
        title={isProfessional ? "Meu perfil profissional" : experience.navigation.professionals}
        description={experience.pages.professionalsDescription}
      >
        {canManageTeam && <ProfessionalForm services={services} invitesEnabled={invitesEnabled} />}
      </PageHeader>

      {/* Overview da equipe */}
      {!isProfessional && (
        <section className={`stagger grid grid-cols-2 gap-3 ${canSeeFinancial ? "lg:grid-cols-4" : "lg:grid-cols-2"}`}>
          <Overview icon={Users} accent="#3B9EFF" label="Equipe ativa" value={perf.team.activeCount.toString()} />
          {canSeeFinancial && (
            <Overview icon={CircleDollarSign} accent="#2ECC8B" label="Receita no mês" value={formatMoney(perf.team.revenue)} />
          )}
          <Overview icon={CalendarCheck} accent="#A855F7" label="Atendimentos" value={perf.team.appointments.toString()} />
          {canSeeFinancial && (
            <Overview icon={Receipt} accent="#F59E0B" label="Ticket médio" value={formatMoney(perf.team.avgTicket)} />
          )}
        </section>
      )}

      <PendingInvites
        invites={pendingInvites.map((invite) => ({
          ...invite,
          createdAt: invite.createdAt.toISOString(),
          sentAt: invite.sentAt?.toISOString() ?? null,
          expiresAt: invite.expiresAt.toISOString(),
          revokedAt: invite.revokedAt?.toISOString() ?? null,
        }))}
      />

      {perf.pros.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-[13px] text-muted-foreground">
          {isProfessional
            ? "Seu perfil profissional não está ativo neste estabelecimento."
            : experience.emptyStates.professionals}
        </div>
      ) : (
        <div className="professional-grid grid gap-4 xl:grid-cols-2">
          {perf.pros.map((p) => (
            <div key={p.id} className={`professional-card experience-surface experience-card-interactive relative overflow-hidden p-5 sm:p-6 ${!p.active ? "opacity-60" : ""}`}>
              {/* Cabeçalho */}
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  {p.avatarUrl ? (
                    <Image src={p.avatarUrl} alt={p.name} width={60} height={60} className="rounded-full object-cover ring-2 ring-[hsl(var(--experience-accent)/0.25)]" style={{ height: 60, width: 60 }} />
                  ) : (
                    <div className="grid place-items-center rounded-full text-base font-semibold text-black/80 ring-2 ring-[hsl(var(--experience-accent)/0.25)]" style={{ height: 60, width: 60, background: p.colorHex ?? "#2ECC8B" }}>
                      {p.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                    </div>
                  )}
                  {canSeeFinancial && p.rank <= 3 && p.revenue > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold text-black shadow" style={{ background: MEDAL[p.rank - 1] }}>
                      {p.rank}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[15px] font-semibold">{p.name}</h3>
                    {canSeeFinancial && p.rank === 1 && p.revenue > 0 && <Trophy className="h-3.5 w-3.5 shrink-0 text-[#F4C430]" />}
                  </div>
                  <p className="truncate text-[12px] text-muted-foreground">{p.bio || p.email}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {canSeeFinancial && (
                      <>
                        <span>Comissão <strong className="text-foreground">{p.commissionPct}%</strong></span>
                        <span>·</span>
                      </>
                    )}
                    <span>{p.serviceCount} {experience.terminology.services}</span>
                    <span>·</span>
                    <span>{p.workingDays} dias/sem</span>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${p.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                  {p.active ? "Ativo" : "Inativo"}
                </span>
              </div>

              {/* Meta */}
              {canSeeFinancial && <div className="mt-5 rounded-xl border border-border/60 bg-surface-1/70 p-3.5">
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1 text-muted-foreground"><Target className="h-3 w-3" /> Meta do mês</span>
                  <span className="font-medium">
                    {formatMoney(p.revenue)} <span className="text-muted-foreground">/ {formatMoney(p.goalCents)}</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, p.goalPct * 100)}%`,
                      background: p.goalPct >= 1 ? "#2ECC8B" : p.goalPct >= 0.6 ? "#3B9EFF" : "#F59E0B",
                    }}
                  />
                </div>
                <p className="mt-1 text-right text-[10px] text-muted-foreground">
                  {(p.goalPct * 100).toFixed(0)}% da meta{p.goalPct >= 1 ? " · meta alcançada" : ""}
                </p>
              </div>}

              {/* Métricas */}
              <div className={`mt-3 grid gap-2 ${canSeeFinancial ? "grid-cols-3" : "grid-cols-2"}`}>
                <Stat icon={CalendarCheck} label="Atendimentos" value={p.appointments.toString()} />
                {canSeeFinancial && <Stat icon={Receipt} label="Ticket médio" value={formatMoney(p.avgTicket)} />}
                {canSeeFinancial && <Stat icon={CircleDollarSign} label="Comissão" value={formatMoney(p.commissionCents)} />}
                <Stat icon={Repeat} label="Taxa retorno" value={`${(p.returnRate * 100).toFixed(0)}%`} />
                <Stat icon={Timer} label="Tempo médio" value={formatDuration(p.avgDuration || 0)} />
                <Stat icon={UserX} label="No-show" value={p.noShow.toString()} accent={p.noShow > 0 ? "#EF4444" : undefined} />
              </div>

              {/* Ações */}
              {canManageTeam && <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-border pt-3">
                <ProfessionalForm
                  services={services}
                  invitesEnabled={invitesEnabled}
                  professional={{
                    id: p.id,
                    name: p.name,
                    email: p.email,
                    bio: p.bio,
                    colorHex: p.colorHex,
                    commissionPct: p.commissionPct,
                    monthlyGoalCents: p.goalCents,
                    serviceIds: p.serviceIds,
                  }}
                />
                <WorkingHoursForm professionalId={p.id} professionalName={p.name} current={p.workingHours} />
                <ToggleActiveButton id={p.id} active={p.active} />
              </div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type IconType = React.ComponentType<{ className?: string }>;

function Overview({ icon: Icon, accent, label, value }: { icon: IconType; accent: string; label: string; value: string }) {
  return (
    <div className="experience-kpi flex items-center gap-3 p-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none tracking-tight">{value}</p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }: { icon: IconType; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-surface-1/70 p-2.5">
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </span>
      <p className="mt-0.5 text-[14px] font-semibold" style={accent ? { color: accent } : undefined}>{value}</p>
    </div>
  );
}
