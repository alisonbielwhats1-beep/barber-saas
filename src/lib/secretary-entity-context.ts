/** Reasserting an accepted lookup label is not entity resolution. The selected
 * backend reference stays unchanged; different labels still require a new task. */
export function sameAcceptedQuery(received: string, accepted?: string) {
  return accepted !== undefined && received.normalize("NFC").trim().toLocaleLowerCase("pt-BR") === accepted.normalize("NFC").trim().toLocaleLowerCase("pt-BR");
}
