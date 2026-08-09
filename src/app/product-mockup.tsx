import { LayoutDashboard, CalendarDays, Users, Wallet, Bell } from "lucide-react";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: CalendarDays, label: "Agenda" },
  { icon: Users, label: "Clientes" },
  { icon: Wallet, label: "Financeiro" },
];

const AGENDA_ROWS = [
  { time: "09:00", label: "Serviço · Profissional A" },
  { time: "10:30", label: "Serviço · Profissional B" },
  { time: "13:00", label: "Serviço · Profissional A" },
];

/**
 * Mockup ilustrativo do painel — não é screenshot real (nenhuma credencial
 * de banco disponível para capturar uma) e não exibe nenhum número/estatística
 * como se fosse dado real. Só comunica a forma do produto (sidebar, KPIs,
 * agenda) até existir uma captura de tela de verdade para substituir isto.
 */
export function ProductMockup() {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-card shadow-2xl">
      {/* Barra de título */}
      <div className="flex items-center gap-2 border-b border-white/5 bg-surface-1 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-3 rounded-full bg-background/60 px-3 py-1 text-[11px] text-muted-foreground">
          app.salonsaas.com/dashboard
        </span>
      </div>

      <div className="flex">
        {/* Mini sidebar */}
        <div className="hidden w-36 shrink-0 space-y-1 border-r border-white/5 p-3 sm:block">
          {NAV.map((n) => (
            <div
              key={n.label}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] ${
                n.active ? "bg-primary/10 text-primary" : "text-muted-foreground"
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
            <p className="text-sm font-semibold">Hoje</p>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </div>

          {/* KPIs — sem número, só forma */}
          <div className="grid grid-cols-3 gap-2.5">
            {["Agendamentos", "Faturamento", "Ocupação"].map((label) => (
              <div key={label} className="rounded-xl border border-border bg-background/40 p-3">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <div className="mt-2 h-2 w-3/4 rounded-full bg-primary/30" />
              </div>
            ))}
          </div>

          {/* Agenda do dia — genérico, sem cliente real */}
          <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
            {AGENDA_ROWS.map((row) => (
              <div
                key={row.time}
                className="flex items-center gap-3 border-b border-border/60 pb-2 text-[11px] last:border-0 last:pb-0"
              >
                <span className="font-semibold text-primary">{row.time}</span>
                <span className="text-muted-foreground">{row.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
