"use server";

import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { lockOperationalResources } from "@/lib/inventory-lock";
import { writeAuditLog } from "@/lib/audit";
import {
  replaceDailyShifts,
  salonHoursInput,
  teamScheduleInput,
  type SalonHoursInput,
  type TeamScheduleInput,
} from "@/lib/team-schedule";

const REVALIDATE_PATHS = ["/configuracoes", "/profissionais", "/agenda", "/hoje", "/dashboard"];

export async function saveSalonHours(input: SalonHoursInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const parsed = salonHoursInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const data = parsed.data;
  const slug = await withTenant(ctx, async tx => {
    const salon = await tx.salon.findUniqueOrThrow({
      where: { id: ctx.salonId },
      select: { slug: true, openMinutes: true, closeMinutes: true },
    });
    await tx.salon.update({
      where: { id: ctx.salonId },
      data: { openMinutes: data.openMinutes, closeMinutes: data.closeMinutes },
    });
    await writeAuditLog(tx, {
      salonId: ctx.salonId,
      userId: ctx.userId,
      actorName: "Equipe",
      action: "SALON_OPENING_HOURS_UPDATED",
      entityType: "Salon",
      entityId: ctx.salonId,
      reason: "Horário geral do estabelecimento atualizado sem alterar jornadas individuais.",
      metadata: {
        before: { openMinutes: salon.openMinutes, closeMinutes: salon.closeMinutes },
        after: { openMinutes: data.openMinutes, closeMinutes: data.closeMinutes },
      },
    });
    return salon.slug;
  });
  for (const path of REVALIDATE_PATHS) revalidatePath(path);
  revalidatePath(`/book/${slug}`, "layout");
}

export async function saveTeamHours(input: TeamScheduleInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const parsed = teamScheduleInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const data = parsed.data;
  const ids = [...new Set(data.professionalIds)].sort();
  const slug = await withTenant(ctx, async tx => {
    const professionals = await tx.professional.findMany({ where: { salonId: ctx.salonId, id: { in: ids }, active: true }, select: { id: true } });
    if (professionals.length !== ids.length) throw new Error("Selecione profissionais ativos deste estabelecimento.");
    await lockOperationalResources(tx, { professionalIds: ids });
    const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { slug: true, openMinutes: true, closeMinutes: true } });
    const before = await tx.workingHours.findMany({ where: { salonId: ctx.salonId, professionalId: { in: ids } }, select: { professionalId: true, weekday: true, startMinutes: true, endMinutes: true } });
    if (ids.some(id => !before.some(row => row.professionalId === id))) throw new Error("Defina os dias de trabalho de cada profissional antes de aplicar o expediente em conjunto.");
    const after = ids.flatMap(id => replaceDailyShifts(before.filter(row => row.professionalId === id), data).map(row => ({ ...row, professionalId: id, salonId: ctx.salonId })));
    await tx.salon.update({ where: { id: ctx.salonId }, data: { openMinutes: data.openMinutes, closeMinutes: data.closeMinutes } });
    await tx.workingHours.deleteMany({ where: { salonId: ctx.salonId, professionalId: { in: ids } } });
    await tx.workingHours.createMany({ data: after });
    await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "TEAM_WORKING_HOURS_UPDATED", entityType: "Salon", entityId: ctx.salonId,
      reason: "Expediente e pausa aplicados à equipe selecionada; dias de folga preservados.",
      metadata: { before: { openMinutes: salon.openMinutes, closeMinutes: salon.closeMinutes, workingHours: before }, after: { openMinutes: data.openMinutes, closeMinutes: data.closeMinutes, pause: data.pause, workingHours: after } },
    });
    return salon.slug;
  });
  for (const path of REVALIDATE_PATHS) revalidatePath(path);
  revalidatePath(`/book/${slug}`, "layout");
}
