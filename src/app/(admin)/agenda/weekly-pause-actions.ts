"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant, type Tx } from "@/lib/prisma-tenant";
import { lockOperationalResources } from "@/lib/inventory-lock";
import { writeAuditLog } from "@/lib/audit";
import { subtractWeeklyPause, weeklyPauseInput, type WeeklyPauseInput } from "@/lib/weekly-pause";

function parseInput(input: WeeklyPauseInput) {
  const parsed = weeklyPauseInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

async function readSchedule(tx: Tx, salonId: string, input: WeeklyPauseInput) {
  const ids = [...new Set(input.professionalIds)].sort();
  const professionals = await tx.professional.findMany({ where: { salonId, id: { in: ids }, active: true }, select: { id: true, user: { select: { name: true } } }, orderBy: { id: "asc" } });
  if (professionals.length !== ids.length) throw new Error("Selecione profissionais ativos deste estabelecimento.");
  const before = await tx.workingHours.findMany({ where: { salonId, professionalId: { in: ids } }, select: { professionalId: true, weekday: true, startMinutes: true, endMinutes: true }, orderBy: [{ professionalId: "asc" }, { weekday: "asc" }, { startMinutes: "asc" }] });
  const after = subtractWeeklyPause(before, input);
  if (JSON.stringify(before) === JSON.stringify(after)) throw new Error("Esse período já está fora das jornadas selecionadas. Confira os horários em Configurações → Agenda.");
  // The review is tied to both the exact request and the current schedule.
  const version = createHash("sha256").update(JSON.stringify({ salonId, ids, weekdays: [...new Set(input.weekdays)].sort(), start: input.startMinutes, end: input.endMinutes, before })).digest("hex");
  return { ids, before, after, version, professionals };
}

export async function previewWeeklyPause(input: WeeklyPauseInput) {
  const ctx = await getTenantContext(); assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = parseInput(input);
  return withTenant(ctx, async tx => {
    const result = await readSchedule(tx, ctx.salonId, data);
    return { version: result.version, professionals: result.professionals.map(p => ({ id: p.id, name: p.user.name, before: result.before.filter(r => r.professionalId === p.id), after: result.after.filter(r => r.professionalId === p.id) })) };
  });
}

export async function saveWeeklyPause(input: WeeklyPauseInput, reviewedVersion: string) {
  const ctx = await getTenantContext(); assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = parseInput(input);
  const version = z.string().regex(/^[a-f0-9]{64}$/).parse(reviewedVersion);
  const slug = await withTenant(ctx, async tx => {
    await lockOperationalResources(tx, { professionalIds: [...new Set(data.professionalIds)].sort() });
    const result = await readSchedule(tx, ctx.salonId, data);
    if (version !== result.version) throw new Error("A jornada mudou desde a revisão. Revise novamente antes de salvar.");
    await tx.workingHours.deleteMany({ where: { salonId: ctx.salonId, professionalId: { in: result.ids } } });
    if (result.after.length) await tx.workingHours.createMany({ data: result.after.map(row => ({ ...row, salonId: ctx.salonId })) });
    await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "WEEKLY_PAUSE_ADDED", entityType: "Salon", entityId: ctx.salonId, reason: "Pausa semanal adicionada à jornada; folgas e reservas preservadas.", metadata: { pause: data, before: result.before, after: result.after } });
    const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { slug: true } });
    return salon.slug;
  });
  for (const path of ["/agenda", "/configuracoes", "/profissionais", "/hoje", "/dashboard"]) revalidatePath(path);
  revalidatePath(`/book/${slug}`, "layout");
}
