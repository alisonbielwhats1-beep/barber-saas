import { foldName } from "./name-search";

/** Reasserting an accepted lookup label is not entity resolution. The selected
 * backend reference stays unchanged; different labels still require a new task. */
export function sameAcceptedQuery(received: string, accepted?: string) {
  return accepted !== undefined && foldName(received.trim()) === foldName(accepted.trim());
}
