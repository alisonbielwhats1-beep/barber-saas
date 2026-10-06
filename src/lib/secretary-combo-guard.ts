import { comboParts } from "./secretary-multi-service";
import { nameTokens, sameName, withoutArticle } from "./name-search";

/** C5 (flag SALON_SECRETARY_COMBO_GUARD, default off; owner rules 9 and 11): an appointment never holds a catalog combo beside one
 * of its own parts. Adding a combo to an appointment that holds one of its parts (registered with the part's exact name) replaces
 * that part; a combo part the owner did not say and the appointment does not hold is used only after the owner's click on that
 * combo (never picked from a partial word); any other overlap between a combo and another service of the same appointment is
 * asked, never proposed. Structural: the catalog names decide, never the owner's sentence. */
export const comboGuardEnabled = () => process.env.SALON_SECRETARY_COMBO_GUARD === "true";
type Named = { id: string; name: string };
const words = (name: string) => nameTokens(withoutArticle(name.trim()));
/** A combo part and a registered service are the same service when every word of one is a word of the other. */
const overlaps = (part: string, name: string) => {
  const a = words(part), b = words(name);
  return a.length > 0 && b.length > 0 && (a.every(token => b.includes(token)) || b.every(token => a.includes(token)));
};
export const isCombo = (name: string) => comboParts(name).length > 1;
/** The services a combo replaces: those the appointment holds under the exact name of one of its parts. */
export const comboAbsorbs = (combo: Named, held: readonly Named[]) => {
  const parts = comboParts(combo.name);
  return held.filter(service => service.id !== combo.id && !isCombo(service.name) && parts.some(part => sameName(part, service.name)));
};
/** The combo parts that neither the appointment holds (exact name) nor the owner's words for this change name. */
export function unsaidComboParts(combo: Named, said: string, held: readonly Named[]) {
  const spoken = isCombo(said) ? comboParts(said) : [said];
  return comboParts(combo.name).filter(part => !held.some(service => sameName(part, service.name)) && !spoken.some(item => overlaps(item, part)));
}
/** First combo of a service list beside a service that is (or overlaps) one of its parts. */
export function comboWithOwnPart(services: readonly Named[]) {
  for (const combo of services) {
    if (!isCombo(combo.name)) continue;
    const parts = comboParts(combo.name);
    const part = services.find(other => other.id !== combo.id && (isCombo(other.name) ? comboParts(other.name).some(piece => parts.some(own => overlaps(own, piece))) : parts.some(own => overlaps(own, other.name))));
    if (part) return { combo, part };
  }
}
