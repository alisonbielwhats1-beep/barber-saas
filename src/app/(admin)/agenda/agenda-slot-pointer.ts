/** Grid lines are visual; pointer selection resolves five-minute intervals inside them. */
export function minuteAtSlotPointer(slotStart: number, clientY: number, top: number, height: number, slotMinutes = 30) {
  if (height <= 0) return slotStart;
  const offset = Math.max(0, Math.min(slotMinutes - 5, Math.floor(((clientY - top) / height) * slotMinutes / 5) * 5));
  return slotStart + offset;
}
