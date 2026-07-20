import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
import { ProfessionalForm } from "./professional-form";
import { WorkingHoursForm } from "./working-hours-form";
import { ToggleActiveButton } from "./toggle-active-button";

export default async function ProfissionaisPage() {
  const { salonId } = await getTenantContext();

  const [pros, services] = await Promise.all([
    prisma.professional.findMany({
      where: { salonId },
      select: {
        id: true,
        bio: true,
        colorHex: true,
        commissionPct: true,
        active: true,
        user: { select: { name: true, email: true } },
        services: { select: { serviceId: true } },
        workingHours: {
          select: { weekday: true, startMinutes: true, endMinutes: true },
        },
        _count: { select: { appointments: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.service.findMany({
      where: { salonId, active: true },
      select: { id: true, name: true, colorHex: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Equipe
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Profissionais</h1>
        </div>
        <ProfessionalForm services={services} />
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {pros.map((p) => (
          <Card key={p.id} className="card-glow flex gap-4 p-5">
            <div
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
              style={{ background: p.colorHex ?? "hsl(var(--primary))" }}
            >
              {p.user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-[13px] font-medium">{p.user.name}</h3>
                  <p className="text-[12px] text-muted-foreground">{p.user.email}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    p.active
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {p.active ? "Ativo" : "Inativo"}
                </span>
              </div>
              {p.bio && (
                <p className="mt-1.5 line-clamp-2 text-[12px] text-muted-foreground">{p.bio}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span>
                  Comissão <strong className="text-foreground">{Number(p.commissionPct)}%</strong>
                </span>
                <span>
                  Atend. <strong className="text-foreground">{p._count.appointments}</strong>
                </span>
                <span>
                  Serviços <strong className="text-foreground">{p.services.length}</strong>
                </span>
                <span>
                  Dias/sem <strong className="text-foreground">{p.workingHours.length}</strong>
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border/50 pt-3">
                <ProfessionalForm
                  services={services}
                  professional={{
                    id: p.id,
                    name: p.user.name,
                    email: p.user.email,
                    bio: p.bio,
                    colorHex: p.colorHex,
                    commissionPct: Number(p.commissionPct),
                    serviceIds: p.services.map((s) => s.serviceId),
                  }}
                />
                <WorkingHoursForm
                  professionalId={p.id}
                  professionalName={p.user.name}
                  current={p.workingHours}
                />
                <ToggleActiveButton id={p.id} active={p.active} />
              </div>
            </div>
          </Card>
        ))}
        {pros.length === 0 && (
          <Card className="col-span-full p-12 text-center text-[13px] text-muted-foreground">
            Sem profissionais cadastrados.
          </Card>
        )}
      </div>
    </div>
  );
}
