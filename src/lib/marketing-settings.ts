import type { Tx } from "./prisma-tenant";

export const DEFAULT_LAPSED_CLIENT_DAYS = 60;
export const MIN_LAPSED_CLIENT_DAYS = 15;
export const MAX_LAPSED_CLIENT_DAYS = 365;
export const MARKETING_SETTINGS_ACTION = "MARKETING_SETTINGS_UPDATED";

export type MarketingSettings = {
  lapsedClientDays: number;
  googleReviewUrl: string | null;
};

export function normalizeLapsedClientDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return DEFAULT_LAPSED_CLIENT_DAYS;
  }
  return Math.min(MAX_LAPSED_CLIENT_DAYS, Math.max(MIN_LAPSED_CLIENT_DAYS, value));
}

export function parseMarketingSettings(metadata: unknown): MarketingSettings {
  const value = metadata && typeof metadata === "object"
    ? metadata as Record<string, unknown>
    : {};
  const reviewUrl = typeof value.googleReviewUrl === "string"
    ? value.googleReviewUrl.trim()
    : "";

  return {
    lapsedClientDays: normalizeLapsedClientDays(value.lapsedClientDays),
    googleReviewUrl: reviewUrl.startsWith("https://") ? reviewUrl : null,
  };
}

export async function getMarketingSettings(
  tx: Tx,
  salonId: string,
): Promise<MarketingSettings> {
  const latest = await tx.auditLog.findFirst({
    where: {
      salonId,
      action: MARKETING_SETTINGS_ACTION,
      entityType: "Salon",
      entityId: salonId,
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });

  return parseMarketingSettings(latest?.metadata);
}
