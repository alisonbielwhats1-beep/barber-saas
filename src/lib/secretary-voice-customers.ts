import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";

/** Owner decision 05/10 (flag SALON_SECRETARY_TRANSCRIBE_CUSTOMER_NAMES, default off): the transcription vocabulary also carries
 * the names of this salon's customers with an appointment around today (7 days back, 30 ahead; nearest first; at most 40), so a
 * spoken "Valter" or "Isabela" is written as registered. These names go to the transcription provider with the audio (which
 * already carries them spoken); never phones, e-mails or notes. Off: the vocabulary is professionals and services only. */
export const transcribeCustomerNamesEnabled = (env: Record<string, string | undefined> = process.env) => env.SALON_SECRETARY_TRANSCRIBE_CUSTOMER_NAMES === "true";
export const VOICE_CUSTOMER_LIMIT = 40;
const DAY = 24 * 3600_000;

export async function voiceCustomerNames(tx: Tx, actor: ServiceActor, now = new Date()) {
  if (!transcribeCustomerNamesEnabled()) return [];
  const rows = await tx.appointment.findMany({
    where: { salonId: actor.salonId, startAt: { gte: new Date(now.getTime() - 7 * DAY), lte: new Date(now.getTime() + 30 * DAY) }, status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED"] } },
    select: { startAt: true, client: { select: { name: true } } }, take: 400,
  });
  const nearest = rows.map(row => ({ name: row.client.name?.replace(/\s+/g, " ").trim() ?? "", distance: Math.abs(row.startAt.getTime() - now.getTime()) }))
    .filter(row => row.name).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, "pt-BR"));
  return [...new Set(nearest.map(row => row.name))].slice(0, VOICE_CUSTOMER_LIMIT);
}
