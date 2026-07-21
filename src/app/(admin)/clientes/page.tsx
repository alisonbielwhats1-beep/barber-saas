import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { getClientList } from "@/lib/crm";
import { formatMoney } from "@/lib/utils";
import { Users, Crown, Cake, Clock } from "lucide-react";
import { ClientForm } from "./client-form";
import { ClientsCrm } from "./clients-crm";

export default async function ClientesPage() {
  const { salonId } = await getTenantContext();
  const [clients, salon] = await Promise.all([
    getClientList(salonId),
    prisma.salon.findUnique({ where: { id: salonId }, select: { name: true } }),
  ]);

  const vip = clients.filter((c) => c.isVip).length;
  const birthday = clients.filter((c) => c.birthdayThisMonth).length;
  const lapsed = clients.filter((c) => c.isLapsed).length;
  const totalLtv = clients.reduce((s, c) => s + c.totalSpent, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">CRM</p>
          <h1 className="text-[26px] font-semibold tracking-tight">Clientes</h1>
        </div>
        <ClientForm />
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Users} accent="#3B9EFF" label="Base de clientes" value={clients.length.toString()} hint={`${formatMoney(totalLtv)} em LTV`} />
        <Kpi icon={Crown} accent="#F4C430" label="Clientes VIP" value={vip.toString()} />
        <Kpi icon={Cake} accent="#EC4899" label="Aniversariantes do mês" value={birthday.toString()} />
        <Kpi icon={Clock} accent="#EF4444" label="Sumidos (60d+)" value={lapsed.toString()} />
      </section>

      <ClientsCrm clients={clients} salonName={salon?.name ?? "nosso salão"} />
    </div>
  );
}

function Kpi({ icon: Icon, accent, label, value, hint }: { icon: React.ComponentType<{ className?: string }>; accent: string; label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none tracking-tight">{value}</p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint ?? label}</p>
      </div>
    </div>
  );
}
