import { z } from "zod";
import type { Tx } from "./prisma-tenant";

export const bookingPreferencesSchema = z.object({
  simultaneousPairs: z.array(z.tuple([z.string().min(1), z.string().min(1)]).refine(pair => pair[0] !== pair[1])).max(100).default([]),
  slotMode: z.enum(["ALL", "FIT"]).default("FIT"),
  returnDays: z.number().int().min(1).max(365).default(30),
  serviceReturnDays: z.record(z.number().int().min(1).max(365)).default({}),
  addons: z.record(z.array(z.string().min(1)).max(20)).default({}),
});
export type BookingPreferences = z.infer<typeof bookingPreferencesSchema>;
export async function getBookingPreferences(
  tx: Tx,
  salonId: string,
): Promise<BookingPreferences> {
  const row = await tx.auditLog.findFirst({
    where: {
      salonId,
      action: "BOOKING_PREFERENCES_UPDATED",
      entityType: "Salon",
      entityId: salonId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { metadata: true },
  });
  const parsed = bookingPreferencesSchema.safeParse(row?.metadata);
  return parsed.success ? parsed.data : bookingPreferencesSchema.parse({});
}
