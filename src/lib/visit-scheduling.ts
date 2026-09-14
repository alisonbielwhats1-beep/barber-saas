import { z } from "zod";
import { createHash } from "node:crypto";
import type { Tx } from "./prisma-tenant";
import { AppointmentError } from "./appointment-domain";
import { createAppointment } from "./appointment-service";
import { reserveAppointmentProducts } from "./appointment-product-service";
import { lockOperationalResources } from "./inventory-lock";
import { writeAuditLog } from "./audit";
import { priceServicesForDate } from "./pricing";
import { unionIntervals } from "./intervals";
import { checkBookingWindow, bufferedWindow } from "./scheduling";
import { getBookingPreferences } from "./booking-preferences";
import {
  isDateKey,
  localDateTimeToUtc,
  startOfDateInTimeZone,
  endExclusiveOfDateInTimeZone,
  toLocalDateTime,
  weekdayOfDateKey,
} from "./time";
import {
  groupVisitItems,
  visitPlan,
  type VisitChoice,
  type VisitItem,
  type VisitPlan,
} from "./visit-plan";
import type { AppointmentActor } from "./appointment-events";

const id = z.string().min(1).max(100);
export const visitChoicesSchema = z
  .array(
    z
      .object({
        serviceId: id,
        professionalId: id.optional(),
        offsetMin: z.number().int().min(0).max(1439).optional(),
      })
      .strict(),
  )
  .min(1)
  .max(10);
export const visitQuerySchema = z
  .object({
    salonId: id,
    date: z.string().refine(isDateKey),
    choices: visitChoicesSchema,
  })
  .strict();
export const visitBookingSchema = visitQuerySchema
  .extend({
    startLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/),
    idempotencyKey: z.string().uuid(),
    quote: z.string().length(64),
    expectedProductTotalCents: z.number().int().min(0).optional(),
    dependentId: id.optional(),
    notes: z.string().max(2000).optional(),
    cartItems: z
      .array(
        z
          .object({ productId: id, quantity: z.number().int().min(1).max(20) })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const visitQuote = (plan: VisitPlan) => digest(plan);
const localAt = (date: string, minutes: number) =>
  `${date}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minuteOf = (local: string) =>
  Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));

export async function loadVisitDay(
  tx: Tx,
  salonId: string,
  date: string,
  choices: VisitChoice[],
  now = new Date(),
) {
  const salon = await tx.salon.findUnique({
    where: { id: salonId },
    select: {
      timezone: true,
      minBookingLeadMinutes: true,
      maxBookingLeadDays: true,
      bufferMinutes: true,
    },
  });
  if (!salon) throw new AppointmentError("NOT_FOUND");
  const ids = choices.map((c) => c.serviceId);
  const services = await tx.service.findMany({
    where: { salonId, id: { in: ids }, active: true },
    select: {
      id: true,
      name: true,
      durationMin: true,
      priceCents: true,
      priceType: true,
      priceNote: true,
      physicalResourceId: true,
      professionals: {
        where: { professional: { salonId, active: true } },
        select: {
          professional: {
            select: { id: true, user: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (services.length !== new Set(ids).size)
    throw new AppointmentError("SERVICE_INVALID");
  const priced = await priceServicesForDate(tx, {
    salonId,
    dateKey: date,
    services,
  });
  const pros = [
    ...new Set(
      choices.flatMap((choice) =>
        services
          .find((s) => s.id === choice.serviceId)!
          .professionals.filter(
            (p) =>
              !choice.professionalId ||
              p.professional.id === choice.professionalId,
          )
          .map((p) => p.professional.id),
      ),
    ),
  ].sort();
  if (pros.length > 100)
    throw new Error("Escolha um profissional para reduzir a busca.");
  const from = startOfDateInTimeZone(date, salon.timezone),
    to = endExclusiveOfDateInTimeZone(date, salon.timezone);
  const bufferedFrom = new Date(from.getTime() - salon.bufferMinutes * 60000);
  const bufferedTo = new Date(to.getTime() + salon.bufferMinutes * 60000);
  const weekly = await tx.workingHours.findMany({
    where: {
      salonId,
      professionalId: { in: pros },
      weekday: weekdayOfDateKey(date),
    },
    select: { professionalId: true, startMinutes: true, endMinutes: true },
  });
  const openings = await tx.professionalOpening.findMany({
    where: { salonId, professionalId: { in: pros }, dateKey: date },
    select: { professionalId: true, startMinutes: true, endMinutes: true },
  });
  const hours = new Map(
    pros.map((pro) => [
      pro,
      unionIntervals(
        [...weekly, ...openings]
          .filter((h) => h.professionalId === pro)
          .map((h) => ({ start: h.startMinutes, end: h.endMinutes })),
      ).map((h) => ({ startMinutes: h.start, endMinutes: h.end })),
    ]),
  );
  const closures = await tx.salonClosure.findMany({
    where: { salonId, startAt: { lt: to }, endAt: { gt: from } },
    select: { startAt: true, endAt: true },
  });
  const blocks = await tx.timeOff.findMany({
    where: {
      professionalId: { in: pros },
      startAt: { lt: to },
      endAt: { gt: from },
    },
    select: { professionalId: true, startAt: true, endAt: true },
  });
  const appointments = await tx.appointment.findMany({
    where: {
      salonId,
      professionalId: { in: pros },
      status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      startAt: { lt: bufferedTo },
      endAt: { gt: bufferedFrom },
    },
    select: { professionalId: true, startAt: true, endAt: true },
  });
  const resources = services.flatMap((s) =>
    s.physicalResourceId ? [s.physicalResourceId] : [],
  );
  const resourceBookings = resources.length
    ? await tx.resourceBooking.findMany({
        where: {
          salonId,
          resourceId: { in: resources },
          active: true,
          startAt: { lt: to },
          endAt: { gt: from },
        },
        select: { resourceId: true, startAt: true, endAt: true },
      })
    : [];
  const offers = await tx.waitlistOffer.findMany({
    where: {
      salonId,
      status: "OFFERED",
      expiresAt: { gt: now },
      startAt: { lt: bufferedTo },
      endAt: { gt: bufferedFrom },
    },
    select: {
      professionalId: true,
      resourceIds: true,
      startAt: true,
      endAt: true,
    },
  });
  const preferences = await getBookingPreferences(tx, salonId);
  return {
    salon,
    services,
    priced: priced.services,
    hours,
    closures,
    blocks,
    appointments,
    resourceBookings,
    offers,
    preferences,
    date,
    now,
  };
}
export type VisitDay = Awaited<ReturnType<typeof loadVisitDay>>;

/** Backtracking is bounded across one request and never probes the database per slot. */
export function findVisitPlan(
  day: VisitDay,
  choices: VisitChoice[],
  startMinute: number,
  options: {
    manual?: boolean;
    overrideSchedule?: boolean;
    budget?: { remaining: number };
    onBlocked?: (index: number, reason: string) => void;
  } = {},
): VisitPlan | null {
  const budget = options.budget ?? { remaining: 20000 };
  const overlap = (a: Date, b: Date, c: Date, d: Date) => a < d && b > c;
  function search(index: number, previous: VisitItem[]): VisitItem[] | null {
    if (--budget.remaining < 0)
      throw new Error(
        "Escolha os profissionais para reduzir as combinações de horários.",
      );
    if (index === choices.length) return previous;
    if (
      previous.length &&
      choices[index]!.offsetMin === undefined &&
      previous.at(-1)!.endLocal.slice(0, 10) !== day.date
    )
      return null;
    const choice = choices[index]!,
      service = day.services.find((s) => s.id === choice.serviceId);
    if (!service) { options.onBlocked?.(index, "Este serviço não está mais disponível. Escolha outro serviço."); return null; }
    const blocked = (reason: string) => options.onBlocked?.(index, reason);
    if (!service.professionals.some(p => !choice.professionalId || p.professional.id === choice.professionalId)) {
      blocked("O profissional não realiza este serviço. Escolha um profissional compatível."); return null;
    }
    const priced = day.priced.find((s) => s.id === service.id)!;
    const start =
      choice.offsetMin === undefined
        ? previous.length
          ? minuteOf(previous.at(-1)!.endLocal)
          : startMinute
        : startMinute + choice.offsetMin;
    const end = start + service.durationMin;
    if (start < 0 || end > 1440) { blocked("O serviço termina no dia seguinte. Antecipe o início para terminar até 24:00."); return null; }
    const startLocal = localAt(day.date, start),
      a = localDateTimeToUtc(startLocal, day.salon.timezone),
      b = new Date(a.getTime() + service.durationMin * 60000);
    const endLocal = toLocalDateTime(b, day.salon.timezone);
    if (!options.manual && checkBookingWindow(a, day.salon, day.now))
      return null;
    if (day.closures.some((c) => overlap(a, b, c.startAt, c.endAt))) {
      blocked("O salão está fechado neste período. Escolha outra data ou horário; a exceção de jornada não libera o fechamento do salão."); return null;
    }
    for (const { professional: pro } of service.professionals) {
      if (choice.professionalId && choice.professionalId !== pro.id) continue;
      if (
        !options.overrideSchedule &&
        (!(day.hours.get(pro.id) ?? []).some(
          (h) => start >= h.startMinutes && end <= h.endMinutes,
        ) ||
          day.blocks.some(
            (c) =>
              c.professionalId === pro.id && overlap(a, b, c.startAt, c.endAt),
          ))
      ) {
        const blockedPeriod = day.blocks.find(c => c.professionalId === pro.id && overlap(a, b, c.startAt, c.endAt));
        const hours = day.hours.get(pro.id) ?? [];
        const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        blocked(blockedPeriod
          ? "Há uma folga ou bloqueio pessoal neste período. Escolha outro horário ou, se autorizado, confirme a exceção de jornada com um motivo."
          : `${hours.length ? `O serviço não cabe nos períodos de trabalho: ${hours.map(h => `${hhmm(h.startMinutes)}–${hhmm(h.endMinutes)}`).join(", ")}.` : "O profissional não tem expediente neste dia."} Ajuste o início ou, se autorizado, confirme a exceção de jornada com um motivo.`);
        continue;
      }
      if (
        day.appointments.some((c) => {
          const w = bufferedWindow(c.startAt, c.endAt, day.salon.bufferMinutes);
          return c.professionalId === pro.id && overlap(a, b, w.from, w.to);
        })
      ) { blocked("Já existe atendimento neste período, incluindo o intervalo de preparação. Escolha outro início ou profissional. A exceção de jornada não libera sobreposição."); continue; }
      if (
        day.resourceBookings.some(
          (c) =>
            c.resourceId === service.physicalResourceId &&
            overlap(a, b, c.startAt, c.endAt),
        )
      ) { blocked("A sala ou equipamento deste serviço está reservado. Escolha outro horário."); continue; }
      if (
        day.offers.some((c) => {
          const w =
            c.professionalId === pro.id
              ? bufferedWindow(c.startAt, c.endAt, day.salon.bufferMinutes)
              : { from: c.startAt, to: c.endAt };
          return (
            (c.professionalId === pro.id ||
              (!!service.physicalResourceId &&
                c.resourceIds.includes(service.physicalResourceId))) &&
            overlap(a, b, w.from, w.to)
          );
        })
      ) { blocked("O horário ou recurso está reservado por uma oferta da fila. Escolha outro horário ou aguarde a oferta expirar."); continue; }
      let invalid = false;
      // Buffer belongs between appointments, never between service items of
      // the same continuous appointment (including the third item onward).
      let continuousFrom = previous.length;
      let boundary = startLocal;
      while (continuousFrom > 0) {
        const prior = previous[continuousFrom - 1]!;
        if (prior.professionalId !== pro.id || prior.endLocal !== boundary)
          break;
        boundary = prior.startLocal;
        continuousFrom--;
      }
      for (let j = 0; j < previous.length; j++) {
        const old = previous[j]!,
          oldStart = minuteOf(old.startLocal),
          oldEnd =
            old.endLocal.slice(0, 10) !== day.date
              ? 1440
              : minuteOf(old.endLocal);
        const intersects = start < oldEnd && end > oldStart;
        const samePro = old.professionalId === pro.id;
        const contiguous = j >= continuousFrom;
        if (
          samePro &&
          (intersects ||
            (!contiguous &&
              start < oldEnd + day.salon.bufferMinutes &&
              end > oldStart - day.salon.bufferMinutes))
        ) {
          blocked(`O horário conflita com o serviço ${j + 1} desta visita para o mesmo profissional. Use sequência ou outro profissional, respeitando o intervalo de preparação.`);
          invalid = true;
          break;
        }
        if (intersects) {
          const oldService = day.services.find((s) => s.id === old.serviceId)!;
          if (
            service.physicalResourceId &&
            service.physicalResourceId === oldService.physicalResourceId
          ) {
            blocked(`O serviço ${j + 1} desta visita usa a mesma sala ou equipamento. Organize os serviços em sequência.`);
            invalid = true;
            break;
          }
          if (
            !options.manual &&
            !day.preferences.simultaneousPairs.some(
              (pair) =>
                pair.includes(service.id) && pair.includes(old.serviceId),
            )
          ) {
            invalid = true;
            break;
          }
        }
      }
      if (invalid) continue;
      const item: VisitItem = {
        serviceId: service.id,
        serviceName: service.name,
        professionalId: pro.id,
        professionalName: pro.user.name,
        startLocal,
        endLocal,
        durationMin: service.durationMin,
        priceCents: priced.priceCents,
        priceType: priced.priceType ?? "FIXED",
        priceNote: priced.priceNote ?? null,
      };
      const found = search(index + 1, [...previous, item]);
      if (found) return found;
    }
    return null;
  }
  const items = search(0, []);
  return items ? visitPlan(items) : null;
}

export async function createVisit(
  tx: Tx,
  input: {
    salonId: string;
    clientId?: string;
    guest?: { name: string; phone: string | null };
    dependentId?: string;
    choices: VisitChoice[];
    startLocal: string;
    idempotencyKey: string;
    quote?: string;
    notes?: string;
    actor: AppointmentActor;
    manual?: boolean;
    scheduleOverrideReason?: string;
    expectedProductTotalCents?: number;
    cartItems?: { productId: string; quantity: number }[];
  },
) {
  const fingerprint = digest({
    ...input,
    actor: { type: input.actor.type, id: input.actor.id },
    cartItems: input.cartItems ?? [],
  });
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`visit:${input.salonId}:${input.idempotencyKey}`},0))`;
  const existing = await tx.auditLog.findFirst({
    where: {
      salonId: input.salonId,
      action: "VISIT_CREATED",
      entityType: "Visit",
      entityId: input.idempotencyKey,
    },
    select: { metadata: true },
  });
  if (existing) {
    const data = existing.metadata as {
      fingerprint: string;
      appointmentIds: string[];
      plan: VisitPlan;
    };
    if (data.fingerprint !== fingerprint)
      throw new AppointmentError("IDEMPOTENCY_MISMATCH");
    return {
      appointmentIds: data.appointmentIds,
      plan: data.plan,
      duplicate: true,
      visitId: input.idempotencyKey,
    };
  }
  const date = input.startLocal.slice(0, 10);
  const proIds = [
    ...new Set(
      input.choices.flatMap((c) =>
        c.professionalId ? [c.professionalId] : [],
      ),
    ),
  ];
  if (proIds.length === 0 || input.choices.some((c) => !c.professionalId))
    throw new AppointmentError("PRO_SERVICE_MISMATCH");
  await lockOperationalResources(tx, { professionalIds: proIds });
  const day = await loadVisitDay(tx, input.salonId, date, input.choices);
  const plan = findVisitPlan(day, input.choices, minuteOf(input.startLocal), {
    manual: input.manual,
    overrideSchedule: !!input.scheduleOverrideReason,
  });
  if (!plan) throw new AppointmentError("SLOT_TAKEN");
  if (input.quote && visitQuote(plan) !== input.quote)
    throw new AppointmentError("PRICE_CHANGED");
  const groups = groupVisitItems(plan.items),
    appointmentIds: string[] = [];
  let clientId = input.clientId;
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]!;
    const result = await createAppointment(tx, {
      salonId: input.salonId,
      professionalId: group.professionalId,
      serviceIds: group.serviceIds,
      startLocal: group.startLocal,
      dependentId: input.dependentId,
      origin: input.manual ? "ADMIN" : "PUBLIC",
      actor: input.actor,
      idempotencyKey: `visit:${input.idempotencyKey}:${index}`,
      idempotencyContext: fingerprint,
      enforceBookingWindow: !input.manual,
      enforcePlanLimits: true,
      notes: input.notes,
      canOverrideSchedule: !!input.manual && !!input.scheduleOverrideReason,
      scheduleOverrideReason: input.scheduleOverrideReason,
      ...(clientId ? { clientId } : { guest: input.guest! }),
    });
    clientId = result.appointment.clientId;
    appointmentIds.push(result.appointment.id);
  }
  if (input.cartItems?.length)
    await reserveAppointmentProducts(tx, {
      salonId: input.salonId,
      appointmentId: appointmentIds[0]!,
      actorName: input.actor.name,
      items: input.cartItems,
    });
  if (input.cartItems?.length) {
    const products = await tx.appointmentProduct.findMany({
      where: { salonId: input.salonId, appointmentId: appointmentIds[0]! },
      select: { quantity: true, priceCentsUnit: true },
    });
    if (
      products.reduce((sum, p) => sum + p.quantity * p.priceCentsUnit, 0) !==
      input.expectedProductTotalCents
    )
      throw new AppointmentError("PRICE_CHANGED");
  }
  await writeAuditLog(tx, {
    salonId: input.salonId,
    userId: input.actor.type === "STAFF" ? (input.actor.id ?? null) : null,
    actorName: input.actor.name,
    action: "VISIT_CREATED",
    entityType: "Visit",
    entityId: input.idempotencyKey,
    metadata: { fingerprint, clientId, appointmentIds, plan },
  });
  return {
    appointmentIds,
    plan,
    duplicate: false,
    visitId: input.idempotencyKey,
  };
}

/** Link only already-authorized appointments; the ledger never expands access. */
export async function visitGroupsForAppointments(
  tx: Tx,
  salonId: string,
  ids: string[],
): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await tx.auditLog.findMany({
    where: {
      salonId,
      action: "VISIT_CREATED",
      entityType: "Visit",
      OR: ids.map((id) => ({
        metadata: { path: ["appointmentIds"], array_contains: [id] },
      })),
    },
    select: { entityId: true, metadata: true },
  });
  const allowed = new Set(ids),
    groups: Record<string, string> = {};
  for (const row of rows) {
    const metadata = row.metadata as { appointmentIds?: unknown };
    if (Array.isArray(metadata?.appointmentIds))
      for (const id of metadata.appointmentIds)
        if (typeof id === "string" && allowed.has(id))
          groups[id] = row.entityId;
  }
  return groups;
}
