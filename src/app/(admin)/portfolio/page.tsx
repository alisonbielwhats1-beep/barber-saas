import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { Card } from "@/components/ui/card";
import { PortfolioForm } from "./portfolio-form";
import { DeleteButton } from "./delete-button";
import { PORTFOLIO_POOL, resolvePortfolioImage } from "@/lib/images";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";

export default async function PortfolioPage() {
  const ctx = await getTenantContext();
  const { salonId, role, userId } = ctx;

  const { items, pros, ownProfessional } = await withTenant(ctx, async (tx) => {
    const ownProfessional =
      role === "PROFESSIONAL"
        ? await tx.professional.findFirst({
            where: { salonId, userId, active: true },
            select: { id: true, user: { select: { name: true } } },
          })
        : null;
    const items =
      role === "PROFESSIONAL" && !ownProfessional
        ? []
        : await tx.portfolioItem.findMany({
            where: {
              salonId,
              ...(role === "PROFESSIONAL" ? { professionalId: ownProfessional!.id } : {}),
            },
            include: {
              professional: { select: { user: { select: { name: true } } } },
            },
            orderBy: { createdAt: "desc" },
          });
    const pros = await tx.professional.findMany({
      where: {
        salonId,
        active: true,
        ...(role === "PROFESSIONAL" ? { userId } : {}),
      },
      select: { id: true, user: { select: { name: true } } },
    });
    return { items, pros, ownProfessional };
  });

  const proOptions = pros.map((p) => ({ id: p.id, name: p.user.name }));
  const canManage = role === "OWNER" || role === "MANAGER";
  const lockedProfessional =
    role === "PROFESSIONAL" && ownProfessional
      ? { id: ownProfessional.id, name: ownProfessional.user.name }
      : undefined;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Galeria
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        </div>
        {(canManage || lockedProfessional) && (
          <PortfolioForm
            professionals={proOptions}
            lockedProfessional={lockedProfessional}
          />
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {items.map((it, index) => (
          <Card key={it.id} className="group relative overflow-hidden">
            <div className="relative aspect-square w-full bg-muted">
              <ImageWithFallback
                src={resolvePortfolioImage(it.imageUrl, index)}
                fallbackSrc={PORTFOLIO_POOL[index % PORTFOLIO_POOL.length]}
                alt={it.caption ?? "Foto do portfolio"}
                fill
                sizes="(max-width: 768px) 45vw, 22vw"
                className="object-cover transition duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition duration-200 group-hover:opacity-100" />
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 opacity-0 transition duration-200 group-hover:opacity-100">
              <div className="text-[11px] text-white drop-shadow">
                {it.caption && <p className="line-clamp-2 font-medium">{it.caption}</p>}
                {it.professional && (
                  <p className="opacity-70">por {it.professional.user.name}</p>
                )}
              </div>
              {canManage && <DeleteButton id={it.id} />}
            </div>
          </Card>
        ))}
        {items.length === 0 && (
          <Card className="col-span-full p-12 text-center text-[13px] text-muted-foreground">
            {role === "PROFESSIONAL" && !ownProfessional
              ? "Seu usuário ainda não possui um perfil profissional ativo neste estabelecimento."
              : "Nenhuma foto ainda. Adicione a primeira e o portfolio aparece no app."}
          </Card>
        )}
      </div>
    </div>
  );
}
