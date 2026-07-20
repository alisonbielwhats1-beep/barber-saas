"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addMinutes } from "date-fns";
import { prisma } from "@/lib/prisma";
import { assertRole, getTenantContext } from "@/lib/tenant";

const createInput = z.object({
  professionalId: z.string(),
  serviceId: z.string(),
  clientId: z.string().optional(),
  clientName: z.string().min(2).optional(),
  clientPhone: z.string().optional().nullable(),
  startAt: z.string().datetime(),
  notes: z.string().optional().nullable(),
});

/**
 * Cria um agendamento manualmente (pelo admin, na tela de agenda).
 *
 * Aceita `clientId` (cliente existente) OU `clientName`+`clientPhone` (cria um
 * novo cliente no mesmo salão). Valida:
 *  - profissional e serviço pertencem ao salão ativo
 *  - profissional pode fazer aquele serviço
 *  - não há conflito de horário
 */
export async function createAppointmentManually(
  input: z.infer<typeof createInput>,
) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = createInput.parse(input);

  const [service, link] = await Promise.all([
    prisma.service.findFirst({
      where: { id: data.serviceId, salonId: ctx.salonId, active: true },
      select: { durationMin: true, priceCents: true },
    }),
    prisma.professionalService.findFirst({
      where: {
        serviceId: data.serviceId,
        professional: { id: data.professionalId, salonId: ctx.salonId, active: true },
      },
    }),
  ]);
  if (!service) throw new Error("Serviço inválido");
  if (!link) throw new Error("Este profissional não faz esse serviço");

  const startAt = new Date(data.startAt);
  const endAt = addMinutes(startAt, service.durationMin);

  const conflict = await prisma.appointment.findFirst({
    where: {
      professionalId: data.professionalId,
      status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  });
  if (conflict) throw new Error("Horário já ocupado");

  let clientId = data.clientId;
  if (!clientId) {
    if (!data.clientName) throw new Error("Informe um cliente");
    const client = await prisma.clientProfile.create({
      data: {
        salonId: ctx.salonId,
        name: data.clientName,
        phone: data.clientPhone ?? null,
      },
      select: { id: true },
    });
    clientId = client.id;
  } else {
    const owned = await prisma.clientProfile.findFirst({
      where: { id: clientId, salonId: ctx.salonId },
      select: { id: true },
    });
    if (!owned) throw new Error("Cliente inválido");
  }

  await prisma.appointment.create({
    data: {
      salonId: ctx.salonId,
      clientId,
      serviceId: data.serviceId,
      professionalId: data.professionalId,
      startAt,
      endAt,
      priceCents: service.priceCents,
      status: "CONFIRMED",
      notes: data.notes ?? null,
    },
  });

  revalidatePath("/agenda");
  revalidatePath("/dashboard");
}

const statusInput = z.enum([
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export async function updateAppointmentStatus(
  id: string,
  status: z.infer<typeof statusInput>,
) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"]);
  const parsedStatus = statusInput.parse(status);

  await prisma.appointment.updateMany({
    where: { id, salonId: ctx.salonId },
    data: { status: parsedStatus },
  });
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
}

export async function cancelAppointment(id: string) {
  return updateAppointmentStatus(id, "CANCELLED");
}
