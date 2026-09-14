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

function visitErrorMessage(error: unknown) {
  if (!isAppointmentError(error))
    return "Não foi possível concluir a visita agora. Suas escolhas foram mantidas; tente novamente.";
  const messages: Partial<Record<typeof error.code, string>> = {
    PRICE_CHANGED: "O valor ou a duração mudou. Revise a visita novamente.",
    SLOT_TAKEN:
      "A disponibilidade mudou desde a revisão. Nenhum serviço foi confirmado. Revise a visita para identificar o bloqueio e escolher outro horário.",
    SALON_CLOSED:
      "O salão está fechado nesse período. Escolha outro horário ou data.",
    FORBIDDEN:
      "Seu acesso não permite agendar este cliente ou profissional. Volte e confira a seleção com a gestão.",
    SERVICE_INVALID:
      "Um serviço não está mais disponível. Volte e escolha outro serviço.",
    PRO_SERVICE_MISMATCH:
      "O profissional não realiza um dos serviços. Confira a seleção de profissionais.",
    BILLING_REQUIRED:
      "O plano do estabelecimento não permite criar novas reservas neste momento. Peça ao proprietário para conferir a assinatura.",
    INVALID_LOCAL_TIME:
      "Confira a data e o início da visita no horário do estabelecimento.",
    PROFESSIONAL_UNAVAILABLE:
      "Há uma folga ou bloqueio neste horário. Escolha outro início ou confirme uma exceção, se seu acesso permitir.",
    OUTSIDE_WORKING_HOURS:
      "O atendimento não cabe no expediente. Ajuste o início ou confirme uma exceção de jornada, se autorizado.",
  };
  return (
    messages[error.code] ??
    "A disponibilidade mudou. Nenhum serviço foi confirmado. Revise a visita antes de tentar novamente."
  );
}

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
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      error:
        "Confira cliente, serviços, data e horário. Se marcou uma exceção, informe um motivo com pelo menos três caracteres.",
    };
  const data = parsed.data;
  try {
    return await withTenant(ctx, async (tx) => {
      await authorize(tx, ctx, data);
      const day = await loadVisitDay(
        tx,
        ctx.salonId,
        data.startLocal.slice(0, 10),
        data.choices,
      );
      const issues: { index: number; reason: string }[] = [];
      const plan = findVisitPlan(
        day,
        data.choices,
        Number(data.startLocal.slice(11, 13)) * 60 +
          Number(data.startLocal.slice(14, 16)),
        {
          manual: true,
          overrideSchedule: !!data.scheduleOverrideReason,
          onBlocked: (index, reason) => issues.push({ index, reason }),
        },
      );
      if (!plan) {
        const issue = issues[0];
        const choice = issue && data.choices[issue.index];
        const service =
          choice && day.services.find((s) => s.id === choice.serviceId);
        const professional = service?.professionals.find(
          (p) => p.professional.id === choice?.professionalId,
        )?.professional;
        return {
          error: issue
            ? `Serviço ${issue.index + 1} · ${service?.name ?? "Serviço"}${professional ? ` · ${professional.user.name}` : ""}: ${issue.reason}`
            : "Não foi possível combinar os horários. Revise os serviços e tente outro início.",
          serviceIndex: issue?.index,
        };
      }
      return { plan, quote: visitQuote(plan) };
    });
  } catch (error) {
    return { error: visitErrorMessage(error) };
  }
}
export async function confirmStaffVisit(raw: unknown) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"]);
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      error:
        "Os dados da visita estão incompletos. Volte, confira o cliente e os horários e revise novamente.",
    };
  const data = parsed.data;
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
      error: visitErrorMessage(error),
    };
  }
}
