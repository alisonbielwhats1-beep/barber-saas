import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { getClientList } from "@/lib/crm";
import { Cake, Clock, Crown, Megaphone } from "lucide-react";
import { MarketingCampaigns } from "./marketing-campaigns";

export default async function MarketingPage() {
  const { salonId } = await getTenantContext();
  const [clients, salon] = await Promise.all([
    getClientList(salonId),
    prisma.salon.findUnique({ where: { id: salonId }, select: { name: true } }),
  ]);

  const toTarget = (c: { id: string; name: string; phone: string | null }) => ({ id: c.id, name: c.name, phone: c.phone });
  const birthdays = clients.filter((c) => c.birthdayThisMonth).map(toTarget);
  const lapsed = clients.filter((c) => c.isLapsed).map(toTarget);
  const vips = clients.filter((c) => c.isVip).map(toTarget);

  return (
    <div className="space-y-6">
      <header>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Crescimento</p>
        <h1 className="text-[26px] font-semibold tracking-tight">Marketing</h1>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <Kpi icon={Cake} accent="#EC4899" label="Aniversariantes" value={birthdays.length.toString()} />
        <Kpi icon={Clock} accent="#EF4444" label="Sumidos p/ resgate" value={lapsed.length.toString()} />
        <Kpi icon={Crown} accent="#F4C430" label="VIPs" value={vips.length.toString()} />
      </section>

      <div className="flex items-start gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-[12px] text-muted-foreground">
          Escolha uma campanha, ajuste a mensagem (com cupom) e dispare pelo WhatsApp — um clique por cliente, com a mensagem já personalizada.
        </p>
      </div>

      <MarketingCampaigns birthdays={birthdays} lapsed={lapsed} vips={vips} salonName={salon?.name ?? "nosso salão"} />
    </div>
  );
}

function Kpi({ icon: Icon, accent, label, value }: { icon: React.ComponentType<{ className?: string }>; accent: string; label: string; value: string }) {
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
