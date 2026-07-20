import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
          <h1 className="font-display text-3xl md:text-4xl">Serviços</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo, preços e duração estimada
          </p>
        </div>
        <ServiceForm />
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => (
          <Card key={s.id} className="flex flex-col p-6">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: s.colorHex ?? "hsl(var(--primary))" }}
                />
                <h3 className="font-medium">{s.name}</h3>
              </div>
              {s.active ? (
                <Badge variant="success">Ativo</Badge>
              ) : (
                <Badge variant="outline">Pausado</Badge>
              )}
            </div>
            {s.description && (
              <p className="mb-4 text-sm text-muted-foreground">{s.description}</p>
            )}
            <div className="mt-auto flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{formatDuration(s.durationMin)}</span>
              <span className="font-medium">{formatMoney(s.priceCents)}</span>
            </div>
            <div className="mt-3 flex justify-end">
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
          <Card className="col-span-full p-12 text-center text-muted-foreground">
            Nenhum serviço cadastrado ainda.
          </Card>
        )}
      </div>
    </div>
  );
}
