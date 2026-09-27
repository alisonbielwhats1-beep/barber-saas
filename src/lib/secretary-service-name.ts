import { serviceFields } from "./service-contract";

/** Presentation of model-extracted names only; manual catalog inputs are unchanged. */
export function normalizeSecretaryServiceName(name: string): string {
  // Reuse the domain's trim/validation; preserve meaningful internal spacing.
  const value = serviceFields.name.parse(name);
  // Preserve mixed case, acronyms, digits and punctuation (e.g. iPhone, LED, e.l.f.).
  if (!/^\p{Ll}[\p{Ll}\p{M} ]*$/u.test(value)) return value;
  const initial = [...value][0];
  const capital = initial.toLocaleUpperCase("pt-BR");
  // Never expand characters into multiple letters (e.g. ß -> SS).
  return [...capital].length === 1 ? capital + value.slice(initial.length) : value;
}
