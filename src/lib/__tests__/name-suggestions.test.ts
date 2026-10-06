import { describe, expect, it } from "vitest";
import { nameInText, nameScore, nameTokens, osaDistance, rankNameSuggestions, sameName, SUGGESTION_LIMIT, tokenSimilarity } from "../name-search";

const rows = (...names: string[]) => names.map((name, i) => ({ id: `id-${String(i).padStart(2, "0")}`, name }));

describe("C3 tolerant name scorer (pure)", () => {
  it("tokenizes folded names and drops particles only", () => {
    expect(nameTokens("Maria da Silva e Souza")).toEqual(["maria", "silva", "souza"]);
    expect(nameTokens("João  D'Ávila-Pereira.")).toEqual(["joao", "d", "avila", "pereira"]);
    expect(nameTokens("de do das dos")).toEqual([]);
  });
  it("bounded OSA distance counts one transposition as one edit and stops above k", () => {
    expect(osaDistance("rodirgo", "rodrigo", 1)).toBe(1);
    expect(osaDistance("tatiane", "tatiana", 1)).toBe(1);
    expect(osaDistance("abcdef", "badcfe", 2)).toBe(3);
    expect(osaDistance("ana", "anabela", 2)).toBe(3);
    expect(osaDistance("kitten", "sitting", 3)).toBe(3);
  });
  it("per-token similarity: exact, prefix (3+), initial on a later token, bounded edits by length", () => {
    expect(tokenSimilarity("tatiana", "tatiana")).toBe(1);
    expect(tokenSimilarity("tat", "tatiana")).toBe(0.97);
    expect(tokenSimilarity("ta", "tatiana")).toBe(0);
    expect(tokenSimilarity("r", "rocha", 1)).toBe(0.9);
    expect(tokenSimilarity("r", "rocha", 0)).toBe(0);
    expect(tokenSimilarity("tatiane", "tatiana")).toBeCloseTo(1 - 1 / 7, 10);
    expect(tokenSimilarity("rodirgo", "rodrigo")).toBeCloseTo(1 - 1 / 7, 10);
    expect(tokenSimilarity("fabio", "fabia")).toBeCloseTo(0.8, 10);
    // Up to 3 characters: no edit allowed; 4-7: one; 8+: two.
    expect(tokenSimilarity("ana", "ane")).toBe(0);
    expect(tokenSimilarity("joao", "joan")).toBeCloseTo(0.75, 10);
    expect(tokenSimilarity("fernandes", "fernandez")).toBeCloseTo(1 - 1 / 9, 10);
    expect(tokenSimilarity("fernand", "frenandes")).toBe(0);
    expect(tokenSimilarity("carolinne", "karoline")).toBeCloseTo(1 - 2 / 9, 10);
  });
  it("a candidate is scored by its weakest query token over distinct name tokens", () => {
    expect(nameScore(["tatiane"], ["tatiana", "rocha"])).toBeCloseTo(1 - 1 / 7, 10);
    expect(nameScore(["tatiane", "r"], ["tatiana", "rocha"])).toBeCloseTo(1 - 1 / 7, 10);
    expect(nameScore(["ana", "ana"], ["ana", "souza"])).toBe(0);
    expect(nameScore(["ana", "maria", "silva"], ["ana", "maria"])).toBe(0);
    expect(nameScore(["souza", "ana"], ["ana", "souza"])).toBe(1);
  });
  it("suggests at 0.80 or more, never below; the owner's examples", () => {
    const salon = rows("Tatiana Rocha", "Ricardo Alves", "Rodrigo Lima", "Fabia Nunes", "Ane Costa");
    expect(rankNameSuggestions("Tatiane", salon)).toEqual({ status: "SUGGEST", rows: [salon[0]] });
    expect(rankNameSuggestions("Rodirgo", salon)).toEqual({ status: "SUGGEST", rows: [salon[2]] });
    expect(rankNameSuggestions("Fabio", salon)).toEqual({ status: "SUGGEST", rows: [salon[3]] });
    expect(rankNameSuggestions("Ana", salon)).toEqual({ status: "NONE" });
    expect(rankNameSuggestions("Joaquim", salon)).toEqual({ status: "NONE" });
    expect(rankNameSuggestions("  ", salon)).toEqual({ status: "NONE" });
  });
  it("orders deterministically (score, folded name, name, id) whatever the row order", () => {
    const salon = rows("Tatiane Lima", "Tatiana Rocha", "Tatiana Alves", "Tatiana Rocha");
    const expected = rankNameSuggestions("Tatiana", salon);
    expect(expected.status).toBe("SUGGEST");
    const names = expected.status === "SUGGEST" ? expected.rows.map(row => `${row.name}|${row.id}`) : [];
    expect(names).toEqual(["Tatiana Alves|id-02", "Tatiana Rocha|id-01", "Tatiana Rocha|id-03", "Tatiane Lima|id-00"]);
    expect(rankNameSuggestions("Tatiana", [...salon].reverse())).toEqual(expected);
  });
  it("keeps the top five and asks for detail on a tie at the cut", () => {
    const six = rows("Tatiana A", "Tatiana B", "Tatiana C", "Tatiana D", "Tatiana E", "Tatiana F");
    expect(rankNameSuggestions("Tatiane", six)).toEqual({ status: "DETAIL" });
    const clear = rows("Tatiane A", "Tatiane B", "Tatiane C", "Tatiane D", "Tatiane E", "Tatiana F");
    const ranked = rankNameSuggestions("Tatiane", clear);
    expect(ranked.status).toBe("SUGGEST");
    expect(ranked.status === "SUGGEST" && ranked.rows.map(row => row.name)).toEqual(["Tatiane A", "Tatiane B", "Tatiane C", "Tatiane D", "Tatiane E"]);
    expect(ranked.status === "SUGGEST" && ranked.rows).toHaveLength(SUGGESTION_LIMIT);
  });
  it("a name Luna emitted is in the message only when every token is written there", () => {
    expect(nameInText("Fábio", "altere o horário do fabio para amanhã")).toBe(true);
    expect(nameInText("Maria da Silva", "marca a maria silva")).toBe(true);
    expect(nameInText("Tatiana", "marca a tatiane amanhã às 10h")).toBe(false);
    expect(nameInText("Maria Silva", "marca a maria")).toBe(false);
    expect(nameInText("11999990001", "cliente do 11 99999-0001")).toBe(true);
    expect(nameInText("Ana", "banana")).toBe(false);
    expect(nameInText("...", "qualquer")).toBe(false);
  });
  it("same name ignores case, accents, punctuation and particles", () => {
    expect(sameName("Tatiana Rocha", "tatiana  rocha")).toBe(true);
    expect(sameName("João da Silva", "joao silva")).toBe(true);
    expect(sameName("Tatiana", "Tatiana Rocha")).toBe(false);
    expect(sameName("", "")).toBe(false);
  });
});
