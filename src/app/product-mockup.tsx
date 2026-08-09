import { LayoutDashboard, CalendarDays, Users, Wallet, Bell } from "lucide-react";
import { getBusinessExperience } from "@/config/business-experience";
import { getSegment, type SegmentId } from "@/lib/segments";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: CalendarDays, label: "Agenda" },
  { icon: Users, label: "Clientes" },
  { icon: Wallet, label: "Financeiro" },
];

const AGENDA_TIMES = ["09:00", "10:30", "13:00"] as const;

/**
 * Mockup ilustrativo do painel — não é screenshot real (nenhuma credencial
 * de banco disponível para capturar uma) e não exibe nenhum número/estatística
 * como se fosse dado real. Só comunica a forma do produto (sidebar, KPIs,
 * agenda) até existir uma captura de tela de verdade para substituir isto.
 */
export function ProductMockup({ segmentId }: { segmentId: SegmentId }) {
  const segment = getSegment(segmentId);
  const experience = getBusinessExperience(segmentId);
  const agendaRows = AGENDA_TIMES.map((time, index) => ({
    time,
    label: `${segment.exampleServices[index]?.name ?? experience.terminology.service} · ${experience.terminology.professional} ${index + 1}`,
  }));

  return (
    <div className="marketing-product-mockup overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
      {/* Barra de título */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-1 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-3 rounded-full bg-background/60 px-3 py-1 text-[11px] text-muted-foreground">
          app.salonsaas.com/dashboard
        </span>
      </div>

      <div className="flex">
        {/* Mini sidebar */}
        <div className="hidden w-36 shrink-0 space-y-1 border-r border-border p-3 sm:block">
          {NAV.map((n) => (
            <div
              key={n.label}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] ${
                n.active ? "border border-border bg-foreground/[0.055] text-foreground" : "text-muted-foreground"
              }`}
            >
              <n.icon className="h-3.5 w-3.5" />
              {n.label}
            </div>
          ))}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{experience.dashboard.eyebrow}</p>
              <p className="mt-0.5 text-sm font-semibold">Hoje</p>
            </div>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </div>

          {/* KPIs — sem número, só forma */}
          <div className="grid grid-cols-3 gap-2.5">
            {["Agendamentos", "Faturamento", "Ocupação"].map((label) => (
              <div key={label} className="rounded-xl border border-border bg-background/40 p-3">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <div className="mt-2 h-2 w-3/4 rounded-full bg-foreground/15" />
              </div>
            ))}
          </div>

          {/* Agenda do dia — genérico, sem cliente real */}
          <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
            {agendaRows.map((row) => (
              <div
                key={row.time}
                className="flex items-center gap-3 border-b border-border/60 pb-2 text-[11px] last:border-0 last:pb-0"
              >
                <span className="font-semibold text-foreground">{row.time}</span>
                <span className="text-muted-foreground">{row.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
