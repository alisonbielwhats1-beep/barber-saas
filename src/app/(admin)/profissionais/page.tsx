import { ProfessionalList, ProfessionalAvatar, ActiveBadge } from "./professional-list";
import { ProfessionalProfileTabs } from "./professional-profile-tabs";
import { emailInvitesEnabled } from "@/lib/email-invites-feature";
import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getTeamPerformance } from "@/lib/team";
import { weekdayInTimeZone } from "@/lib/time";
import { formatMoney, formatDuration, minutesToHHMM } from "@/lib/utils";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import {
  Users,
  Wallet,
  Receipt,
  CalendarCheck,
  Trophy,
  Target,
  Pencil,
  ChevronDown,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ProfessionalForm } from "./professional-form";
import Link from "next/link";
import { ToggleActiveButton } from "./toggle-active-button";
import { PendingInvites } from "./pending-invites";

const MEDAL = ["#F4C430", "#C0C0C0", "#CD7F32"]; // ouro, prata, bronze

export default async function ProfissionaisPage() {
  const ctx = await getTenantContext();
  const { salonId, role } = ctx;
  const invitesEnabled = emailInvitesEnabled();
  const canManageTeam = role === "OWNER" || role === "MANAGER";
  const canSeeFinancial = role === "OWNER" || role === "MANAGER" || role === "SUPER_ADMIN";
  const isProfessional = role === "PROFESSIONAL";

  const { perf, services, pendingInvites, timezone } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUniqueOrThrow({
      where: { id: salonId },
      select: { timezone: true },
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
    return { perf, services, pendingInvites, timezone: salon.timezone };
  });

  const monthLabel = formatInTimeZone(perf.period.from, timezone, "MMMM 'de' yyyy", { locale: ptBR });
  const periodEnd = new Date(perf.period.to.getTime() - 1);
  const periodLabel = `${formatInTimeZone(perf.period.from, timezone, "d", { locale: ptBR })}–${formatInTimeZone(periodEnd, timezone, "d", { locale: ptBR })} de ${monthLabel}`;
  // Expediente de hoje pela jornada semanal (dia da semana no fuso do estabelecimento).
  const todayWeekday = weekdayInTimeZone(new Date(), timezone);
  const inactiveCount = perf.pros.filter((p) => !p.active).length;

  const indicators = isProfessional ? undefined : (
    <div className={`grid grid-cols-2 gap-3 lg:gap-4 ${canSeeFinancial ? "lg:grid-cols-4" : "lg:max-w-[520px]"}`}>
      <Kpi key="team" icon={Users} label="Equipe ativa" value={perf.team.activeCount.toString()} hint={inactiveCount ? `${inactiveCount} ${inactiveCount === 1 ? "inativo" : "inativos"}` : "Todos ativos"} />
      {canSeeFinancial && (
        <Kpi key="revenue" icon={Wallet} label="Receita do período" value={wholeMoney(perf.team.revenue)} full={formatMoney(perf.team.revenue)} hint="Atendimentos finalizados" />
      )}
      <Kpi key="appointments" icon={CalendarCheck} label="Atendimentos" value={perf.team.appointments.toString()} hint="Finalizados no período" />
      {canSeeFinancial && (
        <Kpi key="ticket" icon={Receipt} label="Ticket médio" value={wholeMoney(perf.team.avgTicket)} full={formatMoney(perf.team.avgTicket)} hint="Por atendimento" />
      )}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3.5 lg:gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">
            {isProfessional ? "Meu perfil profissional" : "Colaboradores"}
          </h1>
          <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
            Equipe · {periodLabel}
          </p>
        </div>
        {/* No celular o "Adicionar" fica ao lado da busca; sem ninguém cadastrado, o botão daqui vale para todas as telas. */}
        {canManageTeam && (
          <ProfessionalForm
            services={services}
            invitesEnabled={invitesEnabled}
            triggerLabel="Adicionar profissional"
            triggerClassName={perf.pros.length > 0 ? "hidden lg:inline-flex" : undefined}
          />
        )}
      </div>

      {perf.pros.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {isProfessional
            ? "Seu perfil profissional não está ativo neste estabelecimento."
            : "Sem profissionais cadastrados. Adicione o primeiro no botão acima."}
        </div>
      ) : (
        <ProfessionalList
          canManage={canManageTeam}
          indicators={indicators}
          periodLabel={periodLabel}
          addAction={canManageTeam ? <ProfessionalForm key="add" services={services} invitesEnabled={invitesEnabled} triggerClassName="shrink-0 lg:hidden" /> : undefined}
          entries={perf.pros.map((p) => {
            const today = p.workingHours
              .filter((hours) => hours.weekday === todayWeekday)
              .sort((a, b) => a.startMinutes - b.startMinutes);
            return {
              id: p.id,
              name: p.name,
              subtitle: p.bio || `${p.serviceCount} serviços`,
              active: p.active,
              avatarUrl: p.avatarUrl,
              colorHex: p.colorHex,
              agendaHref: p.active ? `/agenda?professional=${encodeURIComponent(p.id)}` : null,
              card: (
                <div key={p.id} className="flex min-w-0 flex-col gap-3.5">
                  {canSeeFinancial && <GoalMeter key="goal" revenue={p.revenue} goalCents={p.goalCents} goalPct={p.goalPct} />}
                  <dl className="rounded-xl border border-border bg-background px-3.5">
                    <KvRow key="appointments" label="Atendimentos no período" value={`${p.appointments} ${p.appointments === 1 ? "atendimento" : "atendimentos"}`} />
                    {canSeeFinancial && <KvRow key="commission" label="Comissão" value={`${p.commissionPct}% · ${formatMoney(p.commissionCents)}`} />}
                    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border py-2.5 text-sm first:border-t-0 max-sm:flex-col max-sm:items-start" title="Pela jornada semanal">
                      <dt className="text-muted-foreground">Expediente de hoje</dt>
                      <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 font-medium tabular-nums sm:justify-end">
                        {today.length > 0
                          ? today.map((hours) => (
                              <span key={`${hours.startMinutes}-${hours.endMinutes}`} className="whitespace-nowrap">
                                {minutesToHHMM(hours.startMinutes)}–{minutesToHHMM(hours.endMinutes)}
                              </span>
                            ))
                          : <span className="font-normal text-muted-foreground">{p.workingDays > 0 ? "Sem expediente" : "Sem jornada definida"}</span>}
                      </dd>
                    </div>
                  </dl>
                </div>
              ),
              content: (
                <div key={p.id} className={`min-w-0 ${!p.active ? "text-muted-foreground" : ""}`}>
                  {/* Cabeçalho */}
                  <div className="professional-profile-heading flex flex-col items-center gap-3 text-center">
                    <div className="relative shrink-0">
                      <ProfessionalAvatar name={p.name} avatarUrl={p.avatarUrl} colorHex={p.colorHex} size={52} />
                      {canSeeFinancial && p.rank <= 3 && p.revenue > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 hidden h-6 w-6 place-items-center rounded-full text-xs font-semibold text-black md:grid" style={{ background: MEDAL[p.rank - 1] }} title={`${p.rank}º em receita no período`}>
                          {p.rank}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center justify-center gap-2">
                        <h3 className="break-words text-base font-semibold text-foreground">{p.name}</h3>
                        {canSeeFinancial && p.rank === 1 && p.revenue > 0 && <span className="hidden shrink-0 md:inline-flex"><Trophy aria-hidden="true" className="h-4 w-4 text-warning" /><span className="sr-only">1º em receita no período</span></span>}
                      </div>
                      <p className="break-words text-sm text-muted-foreground">{p.bio || p.email}</p>
                      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {canSeeFinancial && <span>Comissão <strong className="font-semibold text-foreground">{p.commissionPct}%</strong> <span aria-hidden="true">·</span></span>}
                        <span>{p.serviceCount} serviços</span>
                        <span aria-hidden="true">·</span>
                        <span>{p.workingDays} dias/sem</span>
                      </div>
                      <div className="mt-2 flex justify-center"><ActiveBadge active={p.active} /></div>
                    </div>
                  </div>

                  <ProfessionalProfileTabs
                    summary={<div className="flex flex-col gap-3.5">
                      {canSeeFinancial && <GoalMeter key="goal" revenue={p.revenue} goalCents={p.goalCents} goalPct={p.goalPct} />}
                      <dl className="rounded-xl border border-border bg-background px-3.5">
                        <KvRow key="appointments" label="Atendimentos" value={p.appointments.toString()} />
                        {canSeeFinancial && <KvRow key="ticket" label="Ticket médio" value={formatMoney(p.avgTicket)} />}
                        {canSeeFinancial && <KvRow key="commission" label={`Comissão (${p.commissionPct}%)`} value={formatMoney(p.commissionCents)} />}
                        <KvRow key="return" label="Taxa retorno" value={`${(p.returnRate * 100).toFixed(0)}%`} />
                        <KvRow key="duration" label="Tempo médio" value={formatDuration(p.avgDuration || 0)} />
                        <KvRow key="noshow" label="Faltas" value={p.noShow.toString()} danger={p.noShow > 0} />
                      </dl>
                      <p className="text-xs text-muted-foreground">Indicadores de {periodLabel}, só atendimentos finalizados.</p>
                    </div>}
                    services={<div className="rounded-xl border border-border bg-background px-3.5">{services.filter(service => p.serviceIds.includes(service.id)).map(service => <div key={service.id} className="flex min-h-11 items-center gap-2.5 border-t border-border py-2.5 text-sm first:border-t-0"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: service.colorHex ?? "hsl(var(--muted-foreground))" }} /><span className="min-w-0 break-words text-foreground">{service.name}</span></div>)}{p.serviceIds.length === 0 && <p className="py-3 text-sm text-muted-foreground">Nenhum serviço vinculado.</p>}</div>}
                    agenda={<div className="flex flex-col gap-3"><p className="text-sm text-muted-foreground">{p.workingDays} dias de trabalho por semana</p><Link href={`/agenda?professional=${encodeURIComponent(p.id)}`} className={buttonVariants({ className: "w-full" })}>Ver agenda</Link>{canManageTeam && <Link href={`/configuracoes?professional=${encodeURIComponent(p.id)}#jornadas`} className={buttonVariants({ variant: "outline", className: "w-full" })}>Jornada e pausas</Link>}</div>}
                  />
                  {/* Ações */}
                  {canManageTeam && <div className="mt-5 flex flex-col gap-2.5 border-t border-border pt-4">
                    <ProfessionalForm
                      trigger={<Button type="button" className="w-full lg:min-h-10"><Pencil aria-hidden="true" className="h-4 w-4" /> Editar profissional</Button>}
                      services={services}
                      invitesEnabled={invitesEnabled}
                      professional={{
                        id: p.id,
                        name: p.name,
                        email: p.email,
                        phone: p.phone,
                        bio: p.bio,
                        colorHex: p.colorHex,
                        avatarUrl: p.avatarUrl,
                        commissionPct: p.commissionPct,
                        monthlyGoalCents: p.goalCents,
                        serviceIds: p.serviceIds,
                      }}
                    />
                    <details className="group rounded-xl border border-border">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        Outras opções
                        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="flex flex-col gap-2 border-t border-border p-3.5">
                        <ToggleActiveButton id={p.id} active={p.active} />
                        <p className="text-xs text-muted-foreground">
                          {p.active
                            ? "Desativar tira o profissional da agenda. Os atendimentos já feitos continuam no histórico."
                            : "Ativar devolve o profissional para a agenda."}
                        </p>
                      </div>
                    </details>
                  </div>}
                </div>
              ),
            };
          })}
        />
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
    </div>
  );
}

type IconType = React.ComponentType<{ className?: string }>;

const WHOLE_BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
/** Indicadores e metas sem centavos ("R$ 2.690"); o valor exato fica no title. */
function wholeMoney(cents: number) {
  return WHOLE_BRL.format(Math.round(cents / 100));
}

/** Cartão de indicador: rótulo 12 à esquerda, ícone de 28 px em lilás suave à direita, valor 24 e apoio 14. */
function Kpi({ icon: Icon, label, value, full, hint }: { icon: IconType; label: string; value: string; full?: string; hint?: string }) {
  return (
    <div className="flex min-h-24 min-w-0 flex-col gap-1.5 rounded-[14px] border border-border bg-card p-3.5 lg:gap-2 lg:p-4">
      <div className="flex min-h-[34px] items-start justify-between gap-2">
        <p className="min-w-0 text-xs font-medium leading-snug text-muted-foreground">{label}</p>
        <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-info/15 text-info">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-auto overflow-hidden text-ellipsis whitespace-nowrap text-lg font-semibold leading-tight tracking-tight tabular-nums min-[380px]:text-2xl" title={full ?? value}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground lg:text-sm">{hint}</p>}
    </div>
  );
}

/** Meta do período: "R$ 2.690 / R$ 9.000" nunca se parte; sem espaço, o valor desce inteiro. */
function GoalMeter({ revenue, goalCents, goalPct }: { revenue: number; goalCents: number; goalPct: number }) {
  const pct = Math.round(goalPct * 100);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground"><Target key="icon" aria-hidden="true" className="h-3.5 w-3.5" /><span key="label">Meta do período</span></span>
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
          {goalCents > 0 ? <span><strong className="font-semibold text-foreground">{wholeMoney(revenue)}</strong> / {wholeMoney(goalCents)}</span> : "Meta não definida"}
        </span>
      </div>
      {goalCents > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Meta do período" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)}>
          <div className={`h-full rounded-full ${goalPct >= 1 ? "bg-success" : "bg-[hsl(var(--selection-solid))]"}`} style={{ width: `${Math.min(100, goalPct * 100)}%` }} />
        </div>
      )}
      <p className="text-right text-xs text-muted-foreground">
        {goalCents > 0 ? `${pct}% da meta${goalPct >= 1 ? " · atingida" : ""}` : "Defina uma meta ao editar o profissional"}
      </p>
    </div>
  );
}

function KvRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border py-2.5 text-sm first:border-t-0">
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className={`shrink-0 text-right font-medium tabular-nums ${danger ? "text-danger" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}
