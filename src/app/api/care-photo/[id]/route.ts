import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { requireCareAppointment } from "@/lib/care-access";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantContext(); const { id } = await params;
    const entry = await withTenant(ctx, async tx => {
      const item = await tx.careEntry.findFirst({ where: { id, salonId: ctx.salonId }, select: { appointmentId: true, photo: true } });
      if (!item?.photo) return null;
      await requireCareAppointment(tx, ctx, item.appointmentId);
      return item;
    });
    if (!entry?.photo) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(entry.photo), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new NextResponse(null, { status: 404 }); }
}
