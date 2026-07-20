import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { BottomNav } from "../bottom-nav";
import { CartBadge } from "../cart-badge";

export default async function ClientPortfolio({
  params,
}: {
  params: { salonSlug: string };
}) {
  const salon = await prisma.salon.findUnique({
    where: { slug: params.salonSlug },
    select: {
      id: true,
      portfolio: {
        orderBy: { createdAt: "desc" },
        include: {
          professional: { select: { user: { select: { name: true } } } },
        },
      },
    },
  });
  if (!salon) notFound();

  return (
    <main className="animate-fade-in space-y-5 px-5 pt-6">
      <header className="flex items-center gap-3">
        <Link
          href={`/book/${params.salonSlug}`}
          className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Nosso trabalho
          </p>
          <p className="text-sm font-semibold">Portfolio</p>
        </div>
        <CartBadge salonSlug={params.salonSlug} />
      </header>

      {salon.portfolio.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Ainda sem fotos publicadas.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {salon.portfolio.map((it) => (
            <div
              key={it.id}
              className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted"
            >
              <Image
                src={it.imageUrl}
                alt={it.caption ?? "Trabalho"}
                fill
                sizes="45vw"
                className="object-cover"
              />
              {(it.caption || it.professional) && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent p-2">
                  {it.caption && (
                    <p className="line-clamp-2 text-[11px] font-medium text-foreground">
                      {it.caption}
                    </p>
                  )}
                  {it.professional && (
                    <p className="text-[10px] text-muted-foreground">
                      por {it.professional.user.name}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <BottomNav salonSlug={params.salonSlug} />
    </main>
  );
}
