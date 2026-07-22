/**
 * Detecta violação da exclusion constraint `appointment_no_overlap`
 * (Postgres 23P01) — a garantia definitiva contra double-booking.
 * O Prisma não mapeia 23P01 para um código próprio, então inspecionamos
 * a mensagem/meta do erro.
 */
export function isOverlapViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const text = [
    (e as { message?: string }).message ?? "",
    JSON.stringify((e as { meta?: unknown }).meta ?? ""),
  ].join(" ");
  return text.includes("23P01") || text.includes("appointment_no_overlap");
}
