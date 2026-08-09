import type { AppointmentStatus } from "@prisma/client";

export const ACTIVE_APPOINTMENT_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
] as const satisfies readonly AppointmentStatus[];

export const CLOSED_APPOINTMENT_STATUSES = [
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const satisfies readonly AppointmentStatus[];

export const RESCHEDULABLE_APPOINTMENT_STATUSES = [
  "PENDING",
  "CONFIRMED",
] as const satisfies readonly AppointmentStatus[];

export type AppointmentErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "SERVICE_INVALID"
  | "PRO_SERVICE_MISMATCH"
  | "INVALID_LOCAL_TIME"
  | "INVALID_TIMEZONE"
  | "TOO_SOON"
  | "TOO_FAR"
  | "OUTSIDE_WORKING_HOURS"
  | "PROFESSIONAL_UNAVAILABLE"
  | "SALON_CLOSED"
  | "SLOT_TAKEN"
  | "ALREADY_CLOSED"
  | "TOO_LATE"
  | "ALREADY_STARTED"
  | "INVALID_STATUS_TRANSITION"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_MISMATCH"
  | "REASON_REQUIRED"
  | "WAITLIST_BLOCKED";

export class AppointmentError extends Error {
  constructor(
    readonly code: AppointmentErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AppointmentError";
  }
}

export function isAppointmentError(error: unknown): error is AppointmentError {
  return error instanceof AppointmentError;
}

const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  PENDING: ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function isActiveAppointmentStatus(
  status: AppointmentStatus,
): status is (typeof ACTIVE_APPOINTMENT_STATUSES)[number] {
  return (ACTIVE_APPOINTMENT_STATUSES as readonly AppointmentStatus[]).includes(status);
}

export function isReschedulableAppointmentStatus(
  status: AppointmentStatus,
): status is (typeof RESCHEDULABLE_APPOINTMENT_STATUSES)[number] {
  return (RESCHEDULABLE_APPOINTMENT_STATUSES as readonly AppointmentStatus[]).includes(status);
}

export function assertStatusTransition(
  current: AppointmentStatus,
  next: AppointmentStatus,
): void {
  if (current === next) return;
  if (!TRANSITIONS[current].includes(next)) {
    throw new AppointmentError(
      "INVALID_STATUS_TRANSITION",
      `Transição inválida: ${current} → ${next}`,
    );
  }
}

export type ClientChangePolicyResult =
  | { allowed: true }
  | { allowed: false; code: "ALREADY_CLOSED" | "ALREADY_STARTED" | "TOO_LATE" };

export function checkClientChangePolicy(input: {
  status: AppointmentStatus;
  startAt: Date;
  cancelPolicyHours: number;
  now?: Date;
}): ClientChangePolicyResult {
  const now = input.now ?? new Date();
  if (input.status === "IN_PROGRESS") {
    return { allowed: false, code: "ALREADY_STARTED" };
  }
  if (!isReschedulableAppointmentStatus(input.status)) {
    return { allowed: false, code: "ALREADY_CLOSED" };
  }
  if (input.startAt.getTime() <= now.getTime()) {
    return { allowed: false, code: "ALREADY_STARTED" };
  }
  const cutoffMs = input.cancelPolicyHours * 60 * 60 * 1_000;
  if (input.startAt.getTime() - now.getTime() < cutoffMs) {
    return { allowed: false, code: "TOO_LATE" };
  }
  return { allowed: true };
}
