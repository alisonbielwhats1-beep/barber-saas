import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { PortfolioForm } from "./portfolio-form";
import { DeleteButton } from "./delete-button";
import { ImageOff } from "lucide-react";
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
    <div className="flex min-w-0 flex-col gap-3.5 lg:gap-4">
      <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">Portfólio</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
            {lockedProfessional ? "Suas fotos publicadas no app do cliente" : "Galeria de trabalhos"}
          </p>
        </div>
        {(canManage || lockedProfessional) && (
          <PortfolioForm
            professionals={proOptions}
            lockedProfessional={lockedProfessional}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 lg:gap-3.5">
        {items.map((it) => (
          <article key={it.id} className="relative min-w-0 overflow-hidden rounded-[14px] border border-border bg-card">
            <div className="relative aspect-square w-full bg-muted">
              {it.imageUrl ? <ImageWithFallback
                src={it.imageUrl}
                fallback={<MissingImage />}
                alt={it.caption ?? "Foto do portfolio"}
                fill
                sizes="(max-width: 768px) 45vw, 22vw"
                className="object-cover"
              /> : <MissingImage />}
            </div>
            {canManage && <div className="absolute right-2 top-2 z-[1]"><DeleteButton id={it.id} /></div>}
            <div className="min-h-[58px] px-3 py-2.5 text-sm">
              {it.caption && <p className="line-clamp-3 break-words font-medium leading-snug">{it.caption}</p>}
              {it.professional && (
                <p className={`text-xs text-muted-foreground ${it.caption ? "mt-0.5" : ""}`}>por {it.professional.user.name}</p>
              )}
            </div>
          </article>
        ))}
        {items.length === 0 && (
          <div className="col-span-full rounded-[14px] border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            {role === "PROFESSIONAL" && !ownProfessional
              ? "Seu usuário ainda não possui um perfil profissional ativo neste estabelecimento."
              : "Nenhuma foto ainda. Adicione a primeira e o portfolio aparece no app."}
          </div>
        )}
      </div>
    </div>
  );
}

function MissingImage() { return <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"><ImageOff aria-hidden className="h-6 w-6" /><span className="text-xs">Imagem indisponível</span></div>; }
