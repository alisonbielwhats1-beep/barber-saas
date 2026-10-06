import { describe, expect, it } from "vitest";
import { TRANSCRIBE_STYLE, withoutPromptEcho } from "../secretary-transcribe";

/** Production pilot, 06/10/2026: a 1.3 s recording came back as the speech followed by the vocabulary prompt. */
describe("transcription prompt echo", () => {
  it("keeps what was said and drops the repeated vocabulary prompt (the pilot case)", () => {
    expect(withoutPromptEcho("Cancela o horário da Carolina. Agenda de salão de beleza. Profissionais: Renata Mendes, Caio Ferreira. Clientes: Camila Rocha."))
      .toBe("Cancela o horário da Carolina.");
  });
  it("leaves nothing when the whole text is the prompt (then nothing was recognized)", () => {
    expect(withoutPromptEcho("Agenda de salão de beleza. Profissionais: Renata Mendes.")).toBe("");
    expect(withoutPromptEcho(`${TRANSCRIBE_STYLE} Agenda de salão de beleza. Clientes: Camila Rocha.`)).toBe("");
    expect(withoutPromptEcho("agenda de salao de beleza. clientes: camila rocha")).toBe("");
  });
  it("never touches an ordinary request, even one that says agenda or salão", () => {
    for (const said of ["Agenda a Carolina amanhã às 10h para corte.", "Qual a agenda do salão na sexta?", "Português do Brasil é a língua do salão."])
      expect(withoutPromptEcho(said)).toBe(said);
  });
});
