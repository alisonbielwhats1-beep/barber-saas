import { describe, expect, it } from "vitest";
import { choiceVerdict, optionId, type OptionCoordinates, type PublishedOption } from "../secretary-options";
import { quoteTemporalFacts } from "../scheduling-temporal-source";

/** Review 2b (B4): the owner's own words must single out the chosen option of ANY card. Pure: the backend
 * passes fresh appointment coordinates; synthetic labels only. */
const now = new Date("2026-09-28T15:00:00Z"); // Monday 28/09 in São Paulo
const card = (field: string, labels: string[]): PublishedOption[] => labels.map((label, index) => ({ option_id: optionId(index), label, ref: `ref-${index}`, field }));
const verdict = (literal: string, chosen: number, options: PublishedOption[], coordinates?: OptionCoordinates[]) =>
  choiceVerdict(literal, options[chosen], options, coordinates, coordinates ? quoteTemporalFacts(literal, "America/Sao_Paulo", now) : undefined);

describe("appointment cards: every day, weekday, clock or daypart the words state must be the option's own", () => {
  const options = card("appointment_ref", ["Carla Mendes — seg, 05/10 às 10h — Tatiana Rocha", "Carla Mendes — ter, 06/10 às 15h — Rodrigo Lima"]);
  const coordinates = [{ day: "2026-10-05", clock: "10:00" }, { day: "2026-10-06", clock: "15:00" }];
  it.each([
    ["às 15h", 1, "OK"], ["às 15h", 0, "OPTION_ECHO_MISMATCH"], ["o das 3", 1, "OPTION_NAME_REQUIRED"], ["às 3h", 1, "OK"],
    ["dia 6", 1, "OK"], ["dia 6", 0, "OPTION_ECHO_MISMATCH"], ["06/10", 1, "OK"], ["o de terça", 1, "OK"], ["segunda-feira", 0, "OK"], ["segunda-feira", 1, "OPTION_ECHO_MISMATCH"],
    // "a segunda" is the 2nd option or Monday's: two different options, so it chooses neither.
    ["a segunda", 1, "OPTION_NAME_REQUIRED"], ["a segunda", 0, "OPTION_NAME_REQUIRED"],
    ["o da tarde", 1, "OK"], ["o da manhã", 1, "OPTION_ECHO_MISMATCH"], ["o do Rodrigo", 1, "OK"], ["o do Rodrigo", 0, "OPTION_ECHO_MISMATCH"],
    ["o da Carla", 0, "OPTION_NAME_REQUIRED"], ["esse", 1, "OPTION_NAME_REQUIRED"], ["o primeiro", 0, "OK"], ["o último", 1, "OK"], ["o terceiro", 0, "OPTION_ECHO_MISMATCH"],
    ["terça às 10h", 1, "OPTION_ECHO_MISMATCH"],
  ] as const)("'%s' for option %i → %s", (literal, chosen, expected) => { expect(verdict(literal, chosen, options, coordinates)).toBe(expected); });
  it("a clock read either way (10h/22h) that fits two options chooses neither; an option without fresh coordinates never matches", () => {
    const late = card("appointment_ref", ["Ana — seg, 05/10 às 10h — Tati", "Ana — seg, 05/10 às 22h — Tati"]);
    expect(verdict("às 10", 0, late, [{ day: "2026-10-05", clock: "10:00" }, { day: "2026-10-05", clock: "22:00" }])).toBe("OPTION_NAME_REQUIRED");
    expect(verdict("às 10h", 0, late, [undefined, { day: "2026-10-05", clock: "22:00" }])).toBe("OPTION_ECHO_MISMATCH");
    expect(verdict("às 10h", 0, late, [undefined, { day: "2026-10-05", clock: "11:00" }])).toBe("OPTION_ECHO_MISMATCH");
  });
});

describe("entity cards: names, phone ending and position", () => {
  const customers = card("customer_ref", ["Amanda Souza · (11) *****-0001", "Amanda Lima · (21) *****-2299"]);
  it.each([
    ["Lima", 1, "OK"], ["Amanda Lima", 1, "OK"], ["Lima", 0, "OPTION_ECHO_MISMATCH"], ["Amanda", 0, "OPTION_NAME_REQUIRED"], ["sim", 1, "OPTION_NAME_REQUIRED"],
    ["essa mesma", 0, "OPTION_NAME_REQUIRED"], ["a de final 99", 1, "OK"], ["final 99", 0, "OPTION_ECHO_MISMATCH"], ["a segunda", 1, "OK"], ["a primeira", 1, "OPTION_ECHO_MISMATCH"],
    ["2", 1, "OK"], ["opção 1", 0, "OK"], ["1ª", 0, "OK"], ["a Lima, a segunda", 1, "OK"], ["a Souza, a segunda", 1, "OPTION_ECHO_MISMATCH"],
  ] as const)("'%s' for option %i → %s", (literal, chosen, expected) => { expect(verdict(literal, chosen, customers)).toBe(expected); });
  it("services and professionals are told apart by their own words", () => {
    const services = card("service_ref", ["Corte feminino", "Corte masculino", "Corte infantil"]);
    expect(verdict("o feminino", 0, services)).toBe("OK"); expect(verdict("corte", 0, services)).toBe("OPTION_NAME_REQUIRED");
    expect(verdict("o masculino", 0, services)).toBe("OPTION_ECHO_MISMATCH");
  });
  it("a card of one option needs no distinguishing words, only no contradiction", () => {
    const one = card("customer_ref", ["Carla Mendes · (11) *****-2299"]);
    expect(verdict("pode ser", 0, one)).toBe("OK"); expect(verdict("a Carla", 0, one)).toBe("OK"); expect(verdict("final 10", 0, one)).toBe("OPTION_ECHO_MISMATCH");
    const slot = card("appointment_ref", ["Carla — qua, 07/10 às 15h — Tati"]);
    expect(verdict("essa mesma", 0, slot, [{ day: "2026-10-07", clock: "15:00" }])).toBe("OK");
    expect(verdict("às 16h", 0, slot, [{ day: "2026-10-07", clock: "15:00" }])).toBe("OPTION_ECHO_MISMATCH");
  });
});
