/** P3b (flag SALON_SECRETARY_READS_V2, default off): the frequent read-only answers the backend gives without asking what the
 * owner cannot know. C32: a list/read of ONE customer with no day said is that customer's next PENDING/CONFIRMED appointments
 * (a small limit, "há mais" when there are more). C29: the salon's day list applies its period/clock filter before the row
 * limit; above it, a per-professional (or per-period) summary and a question, never "restrinja por cliente". C30/C31 a+b:
 * availability with no professional said lists the free times of each eligible professional, and every availability says when
 * more free times exist than it shows. Read-only: no domain, permission or tenant-scope change. The wire and the prompt are
 * the same with the flag on or off (the model already publishes these operations with nullable fields); only the contract
 * version records it (`readsV2`), because the answers Luna later reads as data change. The multi-day "next free slot" search
 * is not part of it (Candidate 5). C4 owner rule 6 (29/09): a list/read of ONE professional with no customer and no day, clock
 * or period said reads today while that professional has an appointment left, otherwise their next working day from the
 * tenant's hours (said as such); the day is still asked when the hours cannot tell (scheduling-catalog professionalReadDay). */
export const readsV2Enabled = () => process.env.SALON_SECRETARY_READS_V2 === "true";
