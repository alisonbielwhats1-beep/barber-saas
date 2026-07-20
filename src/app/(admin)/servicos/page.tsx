import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
import { formatMoney, formatDuration } from "@/lib/utils";
import { ServiceForm } from "./service-form";

export default async function ServicosPage() {
  const { salonId } = await getTenantContext();
  const services = await prisma.service.findMany({
    where: { salonId },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Catálogo
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Serviços</h1>
        </div>
        <ServiceForm />
      </header>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => (
          <Card key={s.id} className="card-glow flex flex-col p-5">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: s.colorHex ?? "hsl(var(--primary))" }}
                />
                <h3 className="text-[13px] font-medium">{s.name}</h3>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  s.active
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {s.active ? "Ativo" : "Pausado"}
              </span>
            </div>
            {s.description && (
              <p className="mb-3 line-clamp-2 text-[12px] text-muted-foreground">
                {s.description}
              </p>
            )}
            <div className="mt-auto flex items-center justify-between gap-2">
              <span className="text-[12px] text-muted-foreground">{formatDuration(s.durationMin)}</span>
              <span className="text-[13px] font-semibold">{formatMoney(s.priceCents)}</span>
            </div>
            <div className="mt-3 flex justify-end border-t border-border/50 pt-3">
              <ServiceForm
                service={{
                  id: s.id,
                  name: s.name,
                  description: s.description,
                  durationMin: s.durationMin,
                  priceCents: s.priceCents,
                  colorHex: s.colorHex,
                }}
              />
            </div>
          </Card>
        ))}
        {services.length === 0 && (
          <Card className="col-span-full p-12 text-center text-[13px] text-muted-foreground">
            Nenhum serviço cadastrado ainda.
          </Card>
        )}
      </div>
    </div>
  );
}
