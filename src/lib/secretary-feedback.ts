import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withTenant } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";

/** B7 owner feedback ("Não era isso" and, since 06/10/2026, "Boa resposta"), flag SALON_SECRETARY_FEEDBACK (default off). One row per submission in the
 * raw-SQL table "SecretaryFeedback" (prisma/sql/manual/026_secretary_feedback.sql; no Prisma model): the actor from
 * authentication, codes from the server's own turn record, the owner's optional comment and, ONLY when the owner ticked
 * "incluir o texto desta conversa", the conversation text shown on the screen. Rows expire after 90 days (expiresAt): the
 * read policy hides expired rows and 026_secretary_feedback.purge.sql deletes them (maintenance role; it must be scheduled,
 * 026_secretary_feedback.schedule.sql, before the flag is turned on). Feedback never changes the conversation, a plan or
 * anything in the salon. */
export const secretaryFeedbackEnabled = () => process.env.SALON_SECRETARY_FEEDBACK === "true";

const code = /^[A-Z][A-Z0-9_]{1,79}$/;
export const FEEDBACK_TRANSCRIPT_LIMIT = 80;
/** `turn`: position of the rated reply in the conversation on the screen. `rating` (owner decision 06/10/2026, migration
 * 031): "good" from "Boa resposta", "bad" from "Não era isso" (the default, as before). `transcript`: allowed only with
 * `include_transcript` (the explicit checkbox); without it the request is refused, never stored without consent. */
export const feedbackInput = z.object({
  sessionId: z.string().uuid(),
  turn: z.number().int().min(0).max(500),
  rating: z.enum(["good", "bad"]).optional(),
  comment: z.string().max(1000).optional(),
  include_transcript: z.boolean(),
  transcript: z.array(z.object({ role: z.enum(["owner", "secretary"]), text: z.string().min(1).max(2000) }).strict()).min(1).max(FEEDBACK_TRANSCRIPT_LIMIT).optional(),
}).strict().refine(value => value.include_transcript ? value.transcript !== undefined : value.transcript === undefined, "TRANSCRIPT_CONSENT");
export type FeedbackInput = z.infer<typeof feedbackInput>;
/** What the server itself recorded for the session's latest message (codes only), when it still has it. */
export type FeedbackContext = { codes: readonly string[]; contract_version?: string | null };

/** The exact row stored. Pure: the transcript is kept only with consent; codes are whitelisted. */
export function feedbackRow(actor: ServiceActor, input: FeedbackInput, context?: FeedbackContext) {
  const comment = input.comment?.trim();
  return {
    id: randomUUID(), salonId: actor.salonId, userId: actor.userId, sessionId: input.sessionId, turnIndex: input.turn,
    outcomeCodes: [...new Set((context?.codes ?? []).filter(item => code.test(item)))].slice(0, 32),
    contractVersion: context?.contract_version && /^[0-9a-f]{64}$/.test(context.contract_version) ? context.contract_version : null,
    comment: comment ? comment : null,
    transcriptConsent: input.include_transcript,
    rating: input.rating === "good" ? "GOOD" as const : "BAD" as const,
    transcript: input.include_transcript && input.transcript ? input.transcript.map(({ role, text }) => ({ role, text })) : null,
  };
}

/** Review: insert limits (rows can reach ~256 KB). Per user: at most FEEDBACK_RATE_LIMIT rows in the last
 * FEEDBACK_RATE_WINDOW_MINUTES; per conversation: at most FEEDBACK_SESSION_LIMIT rows (counted over the user's own
 * unexpired rows, the only ones the read policy shows). */
export const FEEDBACK_RATE_LIMIT = 10, FEEDBACK_RATE_WINDOW_MINUTES = 10, FEEDBACK_SESSION_LIMIT = 30;
/** Inserts under the tenant GUCs (FORCE RLS: salon and user must be the authenticated actor's). The limits are checked in
 * the same statement: nothing inserted means a limit was reached (FEEDBACK_RATE_LIMITED); an RLS refusal raises. */
export async function storeSecretaryFeedback(actor: ServiceActor, input: FeedbackInput, context?: FeedbackContext) {
  const row = feedbackRow(actor, input, context);
  const [stored] = await withTenant(actor, tx => tx.$queryRaw<{ id: string }[]>`INSERT INTO "SecretaryFeedback"
    ("id","salonId","userId","sessionId","turnIndex","outcomeCodes","contractVersion","comment","transcriptConsent","transcript","rating")
    SELECT ${row.id}::uuid, ${row.salonId}::text, ${row.userId}::text, ${row.sessionId}::uuid, ${row.turnIndex}::int, ${JSON.stringify(row.outcomeCodes)}::jsonb,
      ${row.contractVersion}::text, ${row.comment}::text, ${row.transcriptConsent}::boolean, ${row.transcript === null ? null : JSON.stringify(row.transcript)}::jsonb, ${row.rating}::text
    WHERE (SELECT count(*) FROM "SecretaryFeedback" WHERE "userId" = ${row.userId} AND "createdAt" > now() - make_interval(mins => ${FEEDBACK_RATE_WINDOW_MINUTES}::int)) < ${FEEDBACK_RATE_LIMIT}::int
      AND (SELECT count(*) FROM "SecretaryFeedback" WHERE "sessionId" = ${row.sessionId}::uuid) < ${FEEDBACK_SESSION_LIMIT}::int
    RETURNING "id"::text AS "id"`);
  if (!stored) throw Error("FEEDBACK_RATE_LIMITED");
  return { id: stored.id };
}
