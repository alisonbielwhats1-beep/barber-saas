import { readOfferSnapshots } from "@/lib/offer-snapshot";
import { formatInTimeZone } from "date-fns-tz";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { formatMoney } from "@/lib/utils";
import { OfferButtons } from "./offer-buttons";
export async function WaitlistOffers({ salonSlug }: { salonSlug: string }) {
  const session = await getClientSession();
  if (!session) return null;
  const data = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    const client = await resolveClientSessionInTenant(tx, session, salonId);
    if (!client) return null;
    const salon = await tx.salon.findUniqueOrThrow({
      where: { id: salonId },
      select: { timezone: true, currency: true },
    });
    const offers = await tx.waitlistOffer.findMany({
      where: {
        salonId,
        status: "OFFERED",
        expiresAt: { gt: new Date() },
        waitlist: { salonId, clientId: client.clientId, status: "WAITING" },
      },
      include: {
        waitlist: {
          include: {
            professional: { include: { user: { select: { name: true } } } },
            services: { include: { service: { select: { name: true } } } },
          },
        },
      },
      orderBy: { expiresAt: "asc" },
    });
    return { salon, offers };
  });
  if (!data?.offers.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Uma vaga para você</h2>
      {data.offers.map((o) => (
        <article
          key={o.id}
          className="rounded-xl border border-primary/30 bg-primary/5 p-4"
        >
          <p className="font-semibold">
            {formatInTimeZone(
              o.startAt,
              data.salon.timezone,
              "dd/MM 'às' HH:mm",
            )}{" "}
            · {o.waitlist.professional.user.name}
          </p>
          <p className="text-sm">
            {readOfferSnapshots(o.serviceSnapshots)
              .map((s) => s.name)
              .join(" + ")}{" "}
            ·{" "}
            {readOfferSnapshots(o.serviceSnapshots).some(
              (s) => s.priceType === "FROM",
            )
              ? "A partir de "
              : ""}
            {formatMoney(o.priceCents, data.salon.currency)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Vaga reservada até{" "}
            {formatInTimeZone(o.expiresAt, data.salon.timezone, "HH:mm")}.
            Confirme apenas se puder comparecer.
          </p>
          <OfferButtons slug={salonSlug} id={o.id} />
        </article>
      ))}
    </section>
  );
}
