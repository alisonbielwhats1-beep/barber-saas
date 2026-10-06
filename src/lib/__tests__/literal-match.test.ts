import { describe, expect, it } from "vitest";
import { foldedLiteral, literalProofSpans, literalSpans, normalizedOffsets } from "../../../packages/salon-secretary/src/literal-match";

const texts = (message: string, literal: string) => literalSpans(message, literal).map(([start, end]) => message.slice(start, end));

describe("literalSpans: tolerant whole-token proof on the original message", () => {
  it("folds accents and pt-BR case both ways, returning the user's own bytes", () => {
    expect(texts("passa o fabio pra amanha as 10h", "amanhã")).toEqual(["amanha"]);
    expect(texts("passa o fabio pra amanha as 10h", "às 10h")).toEqual(["as 10h"]);
    expect(texts("PASSA O FÁBIO PRA AMANHÃ ÀS 10H", "amanhã às 10h")).toEqual(["AMANHÃ ÀS 10H"]);
    expect(texts("Muda para Amanhã", "amanha")).toEqual(["Amanhã"]);
    expect(texts("coloracao amanha", "Coloração")).toEqual(["coloracao"]);
  });
  it("collapses whitespace runs and treats typographic quotes and dashes as their plain forms", () => {
    expect(texts("amanhã  às  10h", "amanhã às 10h")).toEqual(["amanhã  às  10h"]);
    expect(texts("fecha 14h–16h", "14h-16h")).toEqual(["14h–16h"]);
    expect(texts("manda “Ok” e ‘sim’", "\"ok\" e 'sim'")).toEqual(["“Ok” e ‘sim’"]);
    expect(texts("às 10h", "  às 10h  ")).toEqual(["às 10h"]);
  });
  it("requires whole-token boundaries at both ends", () => {
    expect(literalSpans("marca às 100", "10")).toEqual([]);
    expect(literalSpans("o dia 210", "dia 21")).toEqual([]);
    expect(literalSpans("cancela a Mariana", "ana")).toEqual([]);
    expect(literalSpans("às 10hs", "10h")).toEqual([]);
    expect(texts("das 10 às 11", "10")).toEqual(["10"]);
    // Only the token edges are constrained; punctuation at the edge of a literal needs no boundary.
    expect(texts("(amanhã)", "amanhã")).toEqual(["amanhã"]);
    expect(texts("motivo: ela viajou.", "ela viajou.")).toEqual(["ela viajou."]);
    expect(literalSpans("Cancela a Mariana", "ana", false).length).toBe(1);
  });
  it("returns every occurrence in order, never only the first", () => {
    const message = "Marca a Amanda às 10h e a Carla AS 10H também.";
    const spans = literalSpans(message, "às 10h");
    expect(spans).toHaveLength(2);
    expect(spans.map(([start, end]) => message.slice(start, end))).toEqual(["às 10h", "AS 10H"]);
    expect(spans[0][0]).toBeLessThan(spans[1][0]);
  });
  it("maps offsets to the original string for NFD (decomposed) input and NFC literals", () => {
    const message = "Passa o Fábio pra amanhã às 10h";
    const [[start, end]] = literalSpans(message, "amanhã às 10h");
    expect(message.slice(start, end)).toBe("amanhã às 10h");
    expect(start).toBe(message.indexOf("amanha"));
    expect(end).toBe(message.length);
    // A trailing combining mark stays inside its base grapheme, never outside the span.
    const [[a, b]] = literalSpans("x amanhã, sim", "amanhã");
    expect("x amanhã, sim".slice(a, b)).toBe("amanhã");
    expect(texts("Passa o Fábio", "Fábio")).toEqual(["Fábio"]);
  });
  it("proves nothing for blank or absent literals", () => {
    expect(literalSpans("amanhã às 10h", "   ")).toEqual([]);
    expect(literalSpans("amanhã às 10h", "")).toEqual([]);
    expect(literalSpans("amanhã às 10h", "tomorrow")).toEqual([]);
    expect(literalSpans("", "amanhã")).toEqual([]);
  });
});

describe("literal helpers", () => {
  it("foldedLiteral is the comparison key", () => {
    expect(foldedLiteral("  Depois de  AMANHÃ ")).toBe(foldedLiteral("depois de amanha"));
    expect(foldedLiteral("terça")).not.toBe(foldedLiteral("quarta"));
  });
  it("literalProofSpans prefers byte-exact copies and falls back to folded ones", () => {
    const message = "Terça não; terca, dia 14.";
    expect(literalProofSpans(message, "terca").map(([s, e]) => message.slice(s, e))).toEqual(["terca"]);
    expect(literalProofSpans(message, "TERÇA").map(([s, e]) => message.slice(s, e))).toEqual(["Terça", "terca"]);
  });
  it("normalizedOffsets maps both directions and refuses a divergent whole-string normalization", () => {
    const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const message = "Fábio às 10h";
    const map = normalizedOffsets(message, normalize)!;
    expect(map.text).toBe("fabio as 10h");
    const at = map.text.indexOf("as 10h");
    expect(message.slice(map.toOriginal(at), map.toOriginal(map.text.length))).toBe("às 10h");
    expect(map.toNormalized(message.indexOf("às"))).toBe(at);
    expect(normalizedOffsets("abc", text => text === "abc" ? "x" : text)).toBeUndefined();
  });
});
