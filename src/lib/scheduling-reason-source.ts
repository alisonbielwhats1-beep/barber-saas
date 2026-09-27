import { createHash } from "node:crypto";
import { z } from "zod";
import { groundSchedulingException } from "./scheduling-conflict-contract";

/** Backend-only evidence; never accepted in the interpreter's field schema. Offsets are UTF-16. */
export const overrideReasonSource = z.object({
  kind: z.literal("EXPLICIT_OVERRIDE_CAUSE"),
  message_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
  original_text: z.string().min(3).max(200), interpreted_text: z.string().max(200),
}).strict();

const comparable = (value: string) => value.normalize("NFC").toLocaleLowerCase("pt-BR").replace(/\s+/gu, " ").trim();

/** Select a single terminal causal clause explicitly attached to an override request.
 * This extracts source text, not a pronoun referent. Multiple clauses/instructions fail closed.
 * A model's expanded subject is discarded only when the rest of the predicate is identical.
 */
export function groundOriginalSchedulingException(patch: Record<string, unknown>, previous: Record<string, unknown>, message?: string) {
  if (message !== undefined && typeof patch.override_reason === "string" && patch.override_reason !== previous.override_reason) {
    const causes = [...message.matchAll(/\bporque\s+/giu)];
    const marker = /(?:mesmo que dê conflito|mesmo com conflito|pode encaixar),?\s+porque\s+/giu;
    const matches = [...message.matchAll(marker)];
    if (matches.length) {
      if (matches.length !== 1 || causes.length !== 1) throw Error("OVERRIDE_REASON_NOT_GROUNDED");
      const match = matches[0], start = match.index! + match[0].length;
      const original = message.slice(start).trimEnd().replace(/\.$/u, "").trimEnd();
      if (original.length < 3 || original.length > 200 || /[.,;!?\r\n]/u.test(original) ||
        /\b(?:e|ou)\s+(?:cancela|coloca|agenda|avisa|altera|bloqueia|encaixa)\b/iu.test(original))
        throw Error("OVERRIDE_REASON_NOT_GROUNDED");
      const interpreted = patch.override_reason;
      let corresponds = comparable(interpreted.replace(/\.$/u, "")) === comparable(original);
      const pronoun = /^(?:ele|ela)\s+(.+)$/iu.exec(original);
      const customer = typeof patch.customer_name === "string" ? patch.customer_name : previous.customer_name;
      if (!corresponds && pronoun && typeof customer === "string") {
        // No gender inference, identity resolution or claim that the substituted name is correct.
        // Only recognize the discarded representation of this field, with the exact predicate intact.
        const names = [customer, customer.split(/\s/u)[0]];
        corresponds = names.some(name => comparable(interpreted.replace(/\.$/u, "")) === comparable(`${name} ${pronoun[1]}`));
      }
      if (!corresponds) throw Error("OVERRIDE_REASON_NOT_GROUNDED");
      patch.override_reason = original;
      groundSchedulingException(patch, previous, message);
      patch.override_reason_source = overrideReasonSource.parse({ kind: "EXPLICIT_OVERRIDE_CAUSE",
        message_sha256: createHash("sha256").update(message).digest("hex"), start, end: start + original.length,
        original_text: original, interpreted_text: interpreted });
      return;
    }
  }
  groundSchedulingException(patch, previous, message);
}
