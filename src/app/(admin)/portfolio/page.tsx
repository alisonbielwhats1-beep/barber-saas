import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
import { PortfolioForm } from "./portfolio-form";
import { DeleteButton } from "./delete-button";

export default async function PortfolioPage() {
  const { salonId } = await getTenantContext();

  const [items, pros] = await Promise.all([
    prisma.portfolioItem.findMany({
      where: { salonId },
      include: {
        professional: { select: { user: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.professional.findMany({
      where: { salonId, active: true },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);

  const proOptions = pros.map((p) => ({ id: p.id, name: p.user.name }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Portfolio</h1>
          <p className="text-sm text-muted-foreground">
            Galeria pública de trabalhos — aparece no app do cliente
          </p>
        </div>
        <PortfolioForm professionals={proOptions} />
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {items.map((it) => (
          <Card key={it.id} className="group relative overflow-hidden">
            <div className="relative aspect-square w-full">
              <Image
                src={it.imageUrl}
                alt={it.caption ?? "Foto do portfolio"}
                fill
                sizes="(max-width: 768px) 45vw, 22vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 opacity-0 transition group-hover:opacity-100">
              <div className="text-xs text-white drop-shadow">
                {it.caption && <p className="line-clamp-2">{it.caption}</p>}
                {it.professional && (
                  <p className="opacity-70">por {it.professional.user.name}</p>
                )}
              </div>
              <DeleteButton id={it.id} />
            </div>
          </Card>
        ))}
        {items.length === 0 && (
          <Card className="col-span-full p-12 text-center text-muted-foreground">
            Nenhuma foto ainda. Adicione a primeira e o portfolio aparece no app.
          </Card>
        )}
      </div>
    </div>
  );
}
