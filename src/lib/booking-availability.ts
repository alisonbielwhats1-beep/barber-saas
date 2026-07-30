import { addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const BOOKING_SLOT_STEP_MINUTES = 15;

export type ScheduleWindow = {
  startMinutes: number;
  endMinutes: number;
};

export type ScheduleInterval = {
  startAt: Date;
  endAt: Date;
};

export type SlotUnavailableReason =
  | "INVALID_SLOT"
  | "PAST_TIME"
  | "OUTSIDE_SALON_HOURS"
  | "OUTSIDE_WORKING_HOURS"
  | "PROFESSIONAL_UNAVAILABLE"
  | "SLOT_TAKEN";

type SlotRules = {
  startAt: Date;
  endAt: Date;
  now: Date;
  timeZone: string;
  salonOpenMinutes: number;
  salonCloseMinutes: number;
  workingHours: ScheduleWindow[];
  timeOffs: ScheduleInterval[];
  appointments: ScheduleInterval[];
  requireGridAlignment?: boolean;
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return "America/Sao_Paulo";
  }
}

export function salonDateKey(date: Date, timeZone: string): string {
  return formatInTimeZone(date, safeTimeZone(timeZone), "yyyy-MM-dd");
}

export function salonMinutes(date: Date, timeZone: string): number {
  const value = formatInTimeZone(date, safeTimeZone(timeZone), "HH:mm");
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function weekdayForDateKey(dateKey: string): number {
  if (!DATE_KEY_RE.test(dateKey)) throw new Error("INVALID_DATE");
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("INVALID_DATE");
  }
  return date.getUTCDay();
}

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function zonedDateAtMinutes(
  dateKey: string,
  minutes: number,
  timeZone: string,
): Date {
  weekdayForDateKey(dateKey);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1_440) {
    throw new Error("INVALID_MINUTES");
  }
  const targetDate = minutes === 1_440 ? shiftDateKey(dateKey, 1) : dateKey;
  const normalizedMinutes = minutes === 1_440 ? 0 : minutes;
  const hours = Math.floor(normalizedMinutes / 60);
  const mins = normalizedMinutes % 60;
  return fromZonedTime(
    `${targetDate}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`,
    safeTimeZone(timeZone),
  );
}

export function salonDayRange(dateKey: string, timeZone: string) {
  return {
    startAt: zonedDateAtMinutes(dateKey, 0, timeZone),
    endAt: zonedDateAtMinutes(dateKey, 1_440, timeZone),
  };
}

function overlaps(a: ScheduleInterval, b: ScheduleInterval): boolean {
  return a.startAt < b.endAt && a.endAt > b.startAt;
}

export function slotUnavailableReason({
  startAt,
  endAt,
  now,
  timeZone,
  salonOpenMinutes,
  salonCloseMinutes,
  workingHours,
  timeOffs,
  appointments,
  requireGridAlignment = true,
}: SlotRules): SlotUnavailableReason | null {
  if (
    Number.isNaN(startAt.getTime()) ||
    Number.isNaN(endAt.getTime()) ||
    startAt >= endAt
  ) {
    return "INVALID_SLOT";
  }

  const startDateKey = salonDateKey(startAt, timeZone);
  const lastOccupiedDateKey = salonDateKey(
    new Date(endAt.getTime() - 1),
    timeZone,
  );
  if (startDateKey !== lastOccupiedDateKey) return "INVALID_SLOT";

  const startMinutes = salonMinutes(startAt, timeZone);
  const exactEndDateKey = salonDateKey(endAt, timeZone);
  let endMinutes = salonMinutes(endAt, timeZone);
  if (
    exactEndDateKey !== startDateKey &&
    exactEndDateKey === shiftDateKey(startDateKey, 1) &&
    endMinutes === 0
  ) {
    endMinutes = 1_440;
  }
  if (
    requireGridAlignment &&
    startMinutes % BOOKING_SLOT_STEP_MINUTES !== 0
  ) {
    return "INVALID_SLOT";
  }
  if (startAt < now) return "PAST_TIME";
  if (
    startMinutes < salonOpenMinutes ||
    endMinutes > salonCloseMinutes
  ) {
    return "OUTSIDE_SALON_HOURS";
  }
  if (
    !workingHours.some(
      (window) =>
        startMinutes >= window.startMinutes &&
        endMinutes <= window.endMinutes,
    )
  ) {
    return "OUTSIDE_WORKING_HOURS";
  }

  const candidate = { startAt, endAt };
  if (timeOffs.some((interval) => overlaps(candidate, interval))) {
    return "PROFESSIONAL_UNAVAILABLE";
  }
  if (appointments.some((interval) => overlaps(candidate, interval))) {
    return "SLOT_TAKEN";
  }
  return null;
}

export function availableSlots({
  dateKey,
  durationMinutes,
  now,
  timeZone,
  salonOpenMinutes,
  salonCloseMinutes,
  workingHours,
  timeOffs,
  appointments,
}: Omit<SlotRules, "startAt" | "endAt"> & {
  dateKey: string;
  durationMinutes: number;
}): string[] {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return [];

  const slots = new Set<string>();
  for (const window of workingHours) {
    const start = Math.max(window.startMinutes, salonOpenMinutes);
    const end = Math.min(window.endMinutes, salonCloseMinutes);
    for (
      let minutes = start;
      minutes + durationMinutes <= end;
      minutes += BOOKING_SLOT_STEP_MINUTES
    ) {
      const startAt = zonedDateAtMinutes(dateKey, minutes, timeZone);
      const endAt = addMinutes(startAt, durationMinutes);
      const reason = slotUnavailableReason({
        startAt,
        endAt,
        now,
        timeZone,
        salonOpenMinutes,
        salonCloseMinutes,
        workingHours,
        timeOffs,
        appointments,
      });
      if (!reason) {
        slots.add(
          `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
            minutes % 60,
          ).padStart(2, "0")}`,
        );
      }
    }
  }
  return [...slots].sort();
}
