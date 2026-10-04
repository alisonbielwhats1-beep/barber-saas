/** pt-BR plural → singular of a product name, word by word, for ONE more catalog search when the name as said found nothing:
 * "quatro Óleos Aurora" names the catalog's "Óleo Aurora" (Golden GF29, 04/10). Identity resolution only: words of up to
 * three letters and words without a plural ending stay as they are, and the caller still asks when several products match. */
const RULES: readonly (readonly [RegExp, string])[] = [
  [/ões$/i, "ão"], [/ães$/i, "ão"], [/ãos$/i, "ão"], [/éis$/i, "el"], [/óis$/i, "ol"], [/(?<=[aou])is$/i, "l"],
  [/ns$/i, "m"], [/(?<=[rz])es$/i, ""], [/(?<=[aeiouáéíóúâêô])s$/i, ""],
];
const singularWord = (word: string) => {
  if (word.length <= 3) return word;
  const rule = RULES.find(([pattern]) => pattern.test(word));
  return rule ? word.replace(rule[0], rule[1]) : word;
};
export const singularProductQuery = (query: string) => query.trim().split(/\s+/).map(singularWord).join(" ");
