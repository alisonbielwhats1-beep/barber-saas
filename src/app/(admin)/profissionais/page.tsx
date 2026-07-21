import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { getTeamPerformance } from "@/lib/team";
import { formatMoney, formatDuration } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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

const MEDAL = ["#F4C430", "#C0C0C0", "#CD7F32"]; // ouro, prata, bronze

export default async function ProfissionaisPage() {
  const { salonId } = await getTenantContext();

  const [perf, services] = await Promise.all([
    getTeamPerformance(salonId),
    prisma.service.findMany({
      where: { salonId, active: true },
      select: { id: true, name: true, colorHex: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const monthLabel = format(perf.period.from, "MMMM yyyy", { locale: ptBR });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Equipe · <span className="capitalize">{monthLabel}</span>
          </p>
          <h1 className="text-[26px] font-semibold tracking-tight">Profissionais</h1>
        </div>
        <ProfessionalForm services={services} />
      </header>

      {/* Overview da equipe */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Overview icon={Users} accent="#3B9EFF" label="Equipe ativa" value={perf.team.activeCount.toString()} />
        <Overview icon={CircleDollarSign} accent="#2ECC8B" label="Receita no mês" value={formatMoney(perf.team.revenue)} />
        <Overview icon={CalendarCheck} accent="#A855F7" label="Atendimentos" value={perf.team.appointments.toString()} />
        <Overview icon={Receipt} accent="#F59E0B" label="Ticket médio" value={formatMoney(perf.team.avgTicket)} />
      </section>

      {perf.pros.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-[13px] text-muted-foreground">
          Sem profissionais cadastrados. Adicione o primeiro no botão acima.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {perf.pros.map((p) => (
            <div key={p.id} className={`card-interactive rounded-2xl border border-border bg-card p-5 ${!p.active ? "opacity-60" : ""}`}>
              {/* Cabeçalho */}
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  {p.avatarUrl ? (
                    <Image src={p.avatarUrl} alt={p.name} width={52} height={52} className="rounded-full object-cover" style={{ height: 52, width: 52 }} />
                  ) : (
                    <div className="grid place-items-center rounded-full text-base font-semibold text-black/80" style={{ height: 52, width: 52, background: p.colorHex ?? "#2ECC8B" }}>
                      {p.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                    </div>
                  )}
                  {p.rank <= 3 && p.revenue > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold text-black shadow" style={{ background: MEDAL[p.rank - 1] }}>
                      {p.rank}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[15px] font-semibold">{p.name}</h3>
                    {p.rank === 1 && p.revenue > 0 && <Trophy className="h-3.5 w-3.5 shrink-0 text-[#F4C430]" />}
                  </div>
                  <p className="truncate text-[12px] text-muted-foreground">{p.bio || p.email}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>Comissão <strong className="text-foreground">{p.commissionPct}%</strong></span>
                    <span>·</span>
                    <span>{p.serviceCount} serviços</span>
                    <span>·</span>
                    <span>{p.workingDays} dias/sem</span>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${p.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                  {p.active ? "Ativo" : "Inativo"}
                </span>
              </div>

              {/* Meta */}
              <div className="mt-4 rounded-xl bg-surface-1 p-3">
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
                  {(p.goalPct * 100).toFixed(0)}% da meta{p.goalPct >= 1 ? " · batida! 🎉" : ""}
                </p>
              </div>

              {/* Métricas */}
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Stat icon={CalendarCheck} label="Atendimentos" value={p.appointments.toString()} />
                <Stat icon={Receipt} label="Ticket médio" value={formatMoney(p.avgTicket)} />
                <Stat icon={CircleDollarSign} label="Comissão" value={formatMoney(p.commissionCents)} />
                <Stat icon={Repeat} label="Taxa retorno" value={`${(p.returnRate * 100).toFixed(0)}%`} />
                <Stat icon={Timer} label="Tempo médio" value={formatDuration(p.avgDuration || 0)} />
                <Stat icon={UserX} label="No-show" value={p.noShow.toString()} accent={p.noShow > 0 ? "#EF4444" : undefined} />
              </div>

              {/* Ações */}
              <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-border pt-3">
                <ProfessionalForm
                  services={services}
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
              </div>
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
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
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
    <div className="rounded-lg bg-surface-1 p-2.5">
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </span>
      <p className="mt-0.5 text-[14px] font-semibold" style={accent ? { color: accent } : undefined}>{value}</p>
    </div>
  );
}
