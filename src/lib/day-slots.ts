import { addMinutes } from "date-fns";
import type { Tx } from "@/lib/prisma-tenant";
import { checkBookingWindow, bufferedWindow, type SchedulingPolicy } from "@/lib/scheduling";
import { priceServicesForDate } from "@/lib/pricing";
import { workingHoursForDate } from "@/lib/working-hours";
import {
  addCalendarDays,
  endExclusiveOfDateInTimeZone,
  hhmmInTimeZone,
  startOfDateInTimeZone,
  zonedDateTimeToUtc,
} from "@/lib/time";

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "IN_PROGRESS"] as const;
const STEP_MINUTES = 15;

type Interval = { startAt: Date; endAt: Date };

export type DaySlotSalon = SchedulingPolicy & { timezone: string };

export type DaySlotInputs = Awaited<ReturnType<typeof loadDaySlotInputs>>;

function instantForMinutes(date: string, minutes: number, timezone: string) {
  if (minutes === 24 * 60) {
    return zonedDateTimeToUtc(addCalendarDays(date, 1), "00:00", timezone);
  }
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return zonedDateTimeToUtc(
    date,
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    timezone,
  );
}

/**
 * Carrega, dentro do tenant, tudo que ocupa o dia de um profissional para os
 * serviços pedidos. Retorna `null` quando algum serviço não existe/está
 * inativo ou o profissional não realiza todos eles. Compartilhado entre a
 * disponibilidade pública e as sugestões da equipe.
 */
export async function loadDaySlotInputs(
  tx: Tx,
  input: {
    salonId: string;
    salon: DaySlotSalon;
    professionalId: string;
    serviceIds: string[];
    date: string;
    now: Date;
    excludeAppointmentId?: string | null;
  },
) {
  const { salonId, salon, professionalId, serviceIds, date, excludeAppointmentId } = input;
  const from = startOfDateInTimeZone(date, salon.timezone);
  const to = endExclusiveOfDateInTimeZone(date, salon.timezone);

  const services = await tx.service.findMany({
    where: { id: { in: serviceIds }, salonId, active: true },
    select: { id: true, durationMin: true, priceCents: true, priceType: true, priceNote: true, physicalResourceId: true },
  });
  if (services.length !== new Set(serviceIds).size) return null;
  const priced = await priceServicesForDate(tx, {
    salonId,
    dateKey: date,
    services: serviceIds.map(id => services.find(service => service.id === id)!),
  });

  const professionalLinks = await tx.professionalService.findMany({
    where: {
      serviceId: { in: serviceIds },
      professional: { id: professionalId, salonId, active: true },
    },
    select: { serviceId: true },
  });
  if (professionalLinks.length !== new Set(serviceIds).size) return null;

  const workingHours = await workingHoursForDate(tx, salonId, professionalId, date);
  const closures = await tx.salonClosure.findMany({
    where: { salonId, startAt: { lt: to }, endAt: { gt: from } },
    select: { startAt: true, endAt: true },
  });
  const timeOffs = await tx.timeOff.findMany({
    where: {
      professionalId,
      startAt: { lt: to },
      endAt: { gt: from },
    },
    select: { startAt: true, endAt: true },
  });
  const appointments = await tx.appointment.findMany({
    where: {
      salonId,
      professionalId,
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      startAt: { lt: to },
      endAt: { gt: from },
      status: { in: [...ACTIVE_STATUSES] },
    },
    select: { id: true, startAt: true, endAt: true },
    orderBy: { startAt: "asc" },
  });
  const resourceIds = services.flatMap(s => s.physicalResourceId ? [s.physicalResourceId] : []);
  const resourceBookings: Interval[] = resourceIds.length ? await tx.resourceBooking.findMany({ where: { salonId, resourceId: { in: resourceIds }, active: true, startAt: { lt: to }, endAt: { gt: from }, ...(excludeAppointmentId ? { appointmentId: { not: excludeAppointmentId } } : {}) }, select: { startAt: true, endAt: true } }) : [];
  const offerHolds = await tx.waitlistOffer.findMany({ where: { salonId, status: "OFFERED", expiresAt: { gt: input.now }, startAt: { lt: to }, endAt: { gt: from }, OR: [{ professionalId }, { resourceIds: { hasSome: resourceIds } }] }, select: { startAt: true, endAt: true, professionalId: true } });
  resourceBookings.push(...offerHolds.map(o => o.professionalId === professionalId ? { startAt: addMinutes(o.startAt, -salon.bufferMinutes), endAt: addMinutes(o.endAt, salon.bufferMinutes) } : o));

  return {
    salon,
    services: priced.services,
    pricingRule: priced.rule,
    workingHours,
    closures,
    timeOffs,
    appointments,
    resourceBookings,
  };
}

/**
 * Horários de início (HH:mm no fuso do salão) em que todos os serviços cabem
 * na jornada sem tocar reservas (com buffer), folgas, fechamentos, recursos ou
 * ofertas em aberto. A janela pública de antecedência só vale para o cliente;
 * a equipe recebe apenas horários que ainda não começaram. A criação sempre
 * repete a validação no servidor.
 */
export function computeFreeSlots(
  inputs: NonNullable<DaySlotInputs>,
  options: { date: string; now: Date; enforceBookingWindow: boolean },
): string[] {
  const { date, now } = options;
  const durationMin = inputs.services.reduce((total, service) => total + service.durationMin, 0);
  const slots = new Set<string>();

  for (const working of inputs.workingHours) {
    const workingStart = instantForMinutes(date, working.startMinutes, inputs.salon.timezone);
    const workingEnd = instantForMinutes(date, working.endMinutes, inputs.salon.timezone);

    for (
      let cursor = workingStart;
      addMinutes(cursor, durationMin) <= workingEnd;
      cursor = addMinutes(cursor, STEP_MINUTES)
    ) {
      const slotEnd = addMinutes(cursor, durationMin);
      if (options.enforceBookingWindow
        ? checkBookingWindow(cursor, inputs.salon, now) !== null
        : cursor <= now) continue;

      const blockedByClosure = inputs.closures.some(
        (closure) => cursor < closure.endAt && slotEnd > closure.startAt,
      );
      const blockedByTimeOff = inputs.timeOffs.some(
        (timeOff) => cursor < timeOff.endAt && slotEnd > timeOff.startAt,
      );
      const blockedByAppointment = inputs.appointments.some((appointment) => {
        const buffered = bufferedWindow(
          appointment.startAt,
          appointment.endAt,
          inputs.salon.bufferMinutes,
        );
        return cursor < buffered.to && slotEnd > buffered.from;
      });
      if (blockedByClosure || blockedByTimeOff || blockedByAppointment || inputs.resourceBookings.some(b => cursor < b.endAt && slotEnd > b.startAt)) continue;
      slots.add(hhmmInTimeZone(cursor, inputs.salon.timezone));
    }
  }

  return [...slots].sort();
}
