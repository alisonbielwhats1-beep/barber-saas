/** P3c (flag SALON_SECRETARY_RECURRENCE_GUARD, default off; matrix C03 + X01): a create or block whose own words state a
 * recurrence ("toda sexta", "todo dia", "de 15 em 15 dias", "todas as segundas") is never prepared as one silent occurrence.
 * The backend reads the owner's words itself (src/lib/secretary-recurrence.ts): the action asks "Marco só a primeira (…)?" as a
 * one-option card, and only an explicit yes (the owner's click, or a verified pick of that option) goes on to the ordinary
 * proposal and Confirmar; a turn with no operation that states a recurrence gets a specific "not supported" notice. Recurrence
 * itself is not implemented. The wire, the prompt and the requirements Luna reads are the same with the flag on or off; only the
 * contract version records it (`recurrenceGuard`), because the questions Luna later reads as data change. */
export const recurrenceGuardEnabled = () => process.env.SALON_SECRETARY_RECURRENCE_GUARD === "true";
