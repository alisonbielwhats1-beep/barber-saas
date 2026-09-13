import { z } from "zod";
import type { WeeklyHours } from "./team-schedule";

export const SETUP_ACTION = "INITIAL_SETUP_PROGRESS";
export const HOURS_ACTION = "INITIAL_SETUP_HOURS";
export const REVIEW_ACTION = "INITIAL_SETUP_SERVICE_REVIEW";
export const SETUP_PATH = "/onboarding/configuracao";
export const setupHoursSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startMinutes: z.number().int().min(0).max(1439),
      endMinutes: z.number().int().min(1).max(1440),
    }),
  )
  .min(1, "Selecione pelo menos um dia de atendimento.")
  .max(42)
  .superRefine((rows, ctx) => {
    for (const row of rows)
      if (row.endMinutes <= row.startMinutes)
        ctx.addIssue({
          code: "custom",
          message: "O fim de cada período deve ser depois do início.",
        });
    for (let day = 0; day < 7; day++) {
      const intervals = rows
        .filter((r) => r.weekday === day)
        .sort((a, b) => a.startMinutes - b.startMinutes);
      if (
        intervals.some(
          (r, i) => i > 0 && r.startMinutes < intervals[i - 1].endMinutes,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Os períodos do mesmo dia não podem se sobrepor.",
        });
    }
  });
export const setupServiceSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(2).max(120),
    durationMin: z.number().int().min(5).max(600),
    priceCents: z.number().int().min(0).max(100_000_000),
    freeConfirmed: z.boolean(),
  })
  .refine(
    (s) => s.priceCents > 0 || s.freeConfirmed,
    "Confirme que o serviço é gratuito ou informe seu preço.",
  );
export type SetupServiceInput = z.infer<typeof setupServiceSchema>;
export type SetupService = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
  reviewed: boolean;
};
export type SetupProfessional = {
  id: string;
  userId: string;
  name: string;
  serviceIds: string[];
  hours: WeeklyHours[];
};
export type SetupData = {
  salon: {
    name: string;
    slug: string;
    address: string | null;
    phone: string | null;
    timezone: string;
    openMinutes: number;
    closeMinutes: number;
  };
  userId: string;
  userName: string;
  services: SetupService[];
  professionals: SetupProfessional[];
  hours: WeeklyHours[];
  hoursConfirmed: boolean;
  status: "new" | "active" | "deferred" | "completed";
  step: number;
  hasAppointments: boolean;
};

/** Readiness describes configuration; closures and occupied dates still affect availability. */
export function setupChecks(data: SetupData) {
  const services =
    data.services.length > 0 && data.services.every((s) => s.reviewed);
  const team =
    data.services.length > 0 &&
    data.services.every((s) =>
      data.professionals.some(
        (p) =>
          p.serviceIds.includes(s.id) &&
          p.hours.some((h) => h.endMinutes - h.startMinutes >= s.durationMin),
      ),
    );
  return [data.hoursConfirmed, services, team, data.status === "completed"];
}

export function shouldStartSetup(data: SetupData, role: string) {
  return (
    role === "OWNER" &&
    data.status === "new" &&
    !data.hasAppointments &&
    !setupChecks(data).slice(0, 3).every(Boolean)
  );
}

export function setupReturnHref(value?: string): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return "/dashboard";
  const url = new URL(value, "https://setup.invalid");
  return ["/assinatura", "/dashboard"].includes(url.pathname)
    ? `${url.pathname}${url.search}`
    : "/dashboard";
}

export function setupEntryHref(next: string) {
  return `${SETUP_PATH}?next=${encodeURIComponent(setupReturnHref(next))}`;
}
