import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { Crown } from "lucide-react";
import { SalonSettingsForm } from "./salon-settings-form";
import { AccessManager, type Member } from "./access-manager";

const PLAN_LABEL: Record<string, string> = {
  FREE: "Grátis",
  STARTER: "Starter",
  PRO: "Pro",
  ENTERPRISE: "Enterprise",
};

export default async function ConfiguracoesPage() {
  const { salonId, userId, role } = await getTenantContext();

  const [salon, memberships] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        name: true, address: true, phone: true, timezone: true, currency: true,
        plan: true, openMinutes: true, closeMinutes: true,
        cancelPolicyHours: true, noShowFeeCents: true,
      },
    }),
    prisma.membership.findMany({
      where: { salonId },
      select: { role: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { role: "asc" },
    }),
  ]);

  if (!salon) return null;

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
        <div className="lg:col-span-3">
          <SalonSettingsForm salon={salon} />
        </div>
        <div className="lg:col-span-2">
          <AccessManager members={members} canManage={canManage} />
        </div>
      </div>
    </div>
  );
}
