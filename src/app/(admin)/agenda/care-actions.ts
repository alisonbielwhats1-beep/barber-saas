"use server";
import sharp from "sharp";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { requireCareAppointment } from "@/lib/care-access";
import { lockOperationalResources } from "@/lib/inventory-lock";
import { writeAuditLog } from "@/lib/audit";

export async function readCareEntries(appointmentId: string) {
  const ctx = await getTenantContext();
  return withTenant(ctx, async tx => {
    await requireCareAppointment(tx, ctx, appointmentId);
    return tx.careEntry.findMany({ where: { salonId: ctx.salonId, appointmentId }, select: { id: true, body: true, authorName: true, createdAt: true, photoConsent: true }, orderBy: { createdAt: "desc" }, take: 100 });
  });
}
export async function addCareEntry(form: FormData) {
  const ctx = await getTenantContext();
  const appointmentId = z.string().min(1).max(100).parse(form.get("appointmentId"));
  const body = z.string().trim().min(3).max(8000).parse(form.get("body"));
  const id = z.string().uuid().parse(form.get("requestId"));
  // Authorize before decoding a private upload.
  await withTenant(ctx, tx => requireCareAppointment(tx, ctx, appointmentId));
  const file = form.get("photo"); let photo: Buffer | null = null;
  if (file instanceof File && file.size) {
    if (form.get("photoConsent") !== "on") throw new Error("Confirme a autorização do cliente para registrar a foto.");
    if (file.size > 800_000 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use JPG, PNG ou WebP de até 800 KB.");
    photo = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 16_000_000 }).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    if (photo.length > 1048576) throw new Error("A foto ultrapassou o limite após processamento.");
  }
  await withTenant(ctx, async tx => {
    await lockOperationalResources(tx, { appointmentIds: [appointmentId] });
    const appointment = await requireCareAppointment(tx, ctx, appointmentId);
    if (!["IN_PROGRESS", "COMPLETED"].includes(appointment.status) || appointment.startAt > new Date()) throw new Error("Registre os cuidados durante ou após o atendimento.");
    const previous = await tx.careEntry.findFirst({ where: { id, salonId: ctx.salonId } });
    if (previous) {
      if (previous.appointmentId !== appointmentId || previous.body !== body || previous.authorId !== ctx.userId || !Buffer.from(previous.photo ?? []).equals(photo ?? Buffer.alloc(0))) throw new Error("O pedido mudou. Atualize o formulário.");
      return;
    }
    const author = await tx.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } });
    await tx.careEntry.create({ data: { id, salonId: ctx.salonId, appointmentId, authorId: ctx.userId, authorName: author.name, body, photo, photoConsent: photo !== null } });
    await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: author.name, action: "CARE_RECORDED", entityType: "CareEntry", entityId: id, metadata: { appointmentId, hasPhoto: photo !== null } });
  });
}
