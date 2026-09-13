import { z } from "zod";
import type { ServiceSnapshot } from "./appointment-service";
export function offerSnapshots(services: ServiceSnapshot[]) {
  return services.map((s) => ({
    id: s.id,
    name: s.name,
    durationMin: s.durationMin,
    priceCents: s.priceCents,
    priceType: s.priceType ?? "FIXED",
    priceNote: s.priceNote ?? null,
  }));
}
export function readOfferSnapshots(value: unknown) {
  const parsed = z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        durationMin: z.number().int(),
        priceCents: z.number().int(),
        priceType: z.string(),
        priceNote: z.string().nullable(),
      }),
    )
    .safeParse(value);
  return parsed.success ? parsed.data : [];
}
