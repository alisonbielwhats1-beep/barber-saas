"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { withTenant, type Tx } from "@/lib/prisma-tenant";
import {
  createVisit,
  findVisitPlan,
  loadVisitDay,
  visitChoicesSchema,
  visitQuote,
} from "@/lib/visit-scheduling";
import { hiddenClientIds } from "@/lib/client-list-visibility";
import { AppointmentError, isAppointmentError } from "@/lib/appointment-domain";
import { isValidPhoneBR } from "@/lib/phone";
import type { TenantContext } from "@/lib/tenant";

const schema = z
  .object({
    choices: visitChoicesSchema,
    startLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/),
    clientId: z.string().min(1).optional(),
    clientName: z.string().trim().min(2).max(120).optional(),
    clientPhone: z
      .string()
      .max(32)
      .refine((v) => !v || isValidPhoneBR(v))
      .optional(),
    scheduleOverrideReason: z.string().trim().min(3).max(200).optional(),
    idempotencyKey: z.string().uuid(),
    quote: z.string().length(64).optional(),
  })
  .strict();
async function authorize(
  tx: Tx,
  ctx: TenantContext,
  data: z.infer<typeof schema>,
) {
  if (ctx.role === "PROFESSIONAL") {
    const own = await tx.professional.findFirst({
      where: { salonId: ctx.salonId, userId: ctx.userId, active: true },
      select: { id: true },
    });
    if (!own || data.choices.some((c) => c.professionalId !== own.id))
      throw new AppointmentError("FORBIDDEN");
    if (
      data.clientId &&
      !(await tx.clientProfile.findFirst({
        where: {
          id: data.clientId,
          salonId: ctx.salonId,
          appointments: { some: { professionalId: own.id } },
        },
        select: { id: true },
      }))
    )
      throw new AppointmentError("FORBIDDEN");
  }
  if (
    data.scheduleOverrideReason &&
    !["OWNER", "MANAGER", "PROFESSIONAL"].includes(ctx.role)
  )
    throw new AppointmentError("FORBIDDEN");
  if (
    data.clientId &&
    (await hiddenClientIds(tx, ctx.salonId)).has(data.clientId)
  )
    throw new AppointmentError("FORBIDDEN");
}
export async function previewStaffVisit(raw: unknown) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"]);
  const data = schema.parse(raw);
  return withTenant(ctx, async (tx) => {
    await authorize(tx, ctx, data);
    const day = await loadVisitDay(
      tx,
      ctx.salonId,
      data.startLocal.slice(0, 10),
      data.choices,
    );
    const plan = findVisitPlan(
      day,
      data.choices,
      Number(data.startLocal.slice(11, 13)) * 60 +
        Number(data.startLocal.slice(14, 16)),
      { manual: true, overrideSchedule: !!data.scheduleOverrideReason },
    );
    if (!plan)
      return {
        error:
          "Um serviço não cabe neste horário. Confira folgas, expediente, bloqueios e atendimentos existentes.",
      };
    return { plan, quote: visitQuote(plan) };
  });
}
export async function confirmStaffVisit(raw: unknown) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"]);
  const data = schema.parse(raw);
  if (!data.quote || (!data.clientId && !data.clientName))
    return { error: "Selecione o cliente e revise a visita." };
  try {
    const result = await withTenant(ctx, async (tx) => {
      await authorize(tx, ctx, data);
      return createVisit(tx, {
        salonId: ctx.salonId,
        ...data,
        guest: data.clientId
          ? undefined
          : { name: data.clientName!, phone: data.clientPhone ?? null },
        manual: true,
        actor: { type: "STAFF", id: ctx.userId, name: "Equipe" },
      });
    });
    for (const path of ["/agenda", "/clientes", "/hoje", "/dashboard"])
      revalidatePath(path);
    revalidatePath("/book", "layout");
    return { success: true, ...result };
  } catch (error) {
    return {
      error:
        isAppointmentError(error) && error.code === "PRICE_CHANGED"
          ? "O valor ou a duração mudou. Revise a visita novamente."
          : "A visita não foi confirmada. Confira os horários de todos os profissionais.",
    };
  }
}
