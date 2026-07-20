import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
          <h1 className="font-display text-3xl md:text-4xl">Profissionais</h1>
          <p className="text-sm text-muted-foreground">
            Equipe, comissão, horários e vínculo com serviços
          </p>
        </div>
        <ProfessionalForm services={services} />
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {pros.map((p) => (
          <Card key={p.id} className="flex items-start gap-4 p-6">
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-lg font-medium text-white"
              style={{ background: p.colorHex ?? "hsl(var(--primary))" }}
            >
              {p.user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{p.user.name}</h3>
                  <p className="text-sm text-muted-foreground">{p.user.email}</p>
                </div>
                {p.active ? (
                  <Badge variant="success">Ativo</Badge>
                ) : (
                  <Badge variant="outline">Inativo</Badge>
                )}
              </div>
              {p.bio && <p className="mt-2 text-sm text-muted-foreground">{p.bio}</p>}
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>Comissão: <strong>{Number(p.commissionPct)}%</strong></span>
                <span>Atendimentos: <strong>{p._count.appointments}</strong></span>
                <span>Serviços: <strong>{p.services.length}</strong></span>
                <span>Dias/semana: <strong>{p.workingHours.length}</strong></span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-1">
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
          <Card className="col-span-full p-12 text-center text-muted-foreground">
            Sem profissionais cadastrados.
          </Card>
        )}
      </div>
    </div>
  );
}
