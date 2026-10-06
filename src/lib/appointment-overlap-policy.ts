/** Shared manual scheduling policy. Callers resolve the authenticated membership. */
export const OVERBOOK_ROLES = ["OWNER", "MANAGER"] as const;
export const canOverbookRole = (role: string) => (OVERBOOK_ROLES as readonly string[]).includes(role);
export const validOverbookReason = (reason?: string | null) => (reason?.trim().length ?? 0) >= 3;
export type SlotConflict = { kind: "APPOINTMENT" | "RESOURCE" | "WAITLIST"; startAt?: Date; endAt?: Date };
export function canOverrideSlot(violation: string | null, conflicts: readonly SlotConflict[], allowed: boolean) {
  return allowed && violation === "SLOT_TAKEN" && conflicts.some(c => c.kind === "APPOINTMENT") &&
    conflicts.every(c => c.kind === "APPOINTMENT");
}
