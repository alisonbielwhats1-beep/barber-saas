import { describe, expect, it } from "vitest";
import { isCancellationCauseStatement } from "../cancel-reason-statement";

/** Owner 06/10/2026: with a cancellation open, the cause said is its reason; giving up stays explicit. */
describe("isCancellationCauseStatement", () => {
  it.each([
    "Ela solicitou a mudança de planos.",
    "Ela pediu para cancelar",
    "porque ela vai viajar",
    "A cliente teve um imprevisto",
    "Ela está doente",
    "Motivo: trabalho",
    "Ela não vai poder vir",
    "Ele desmarcou pelo WhatsApp",
  ])("reads %j as the reason", message => expect(isCancellationCauseStatement(message)).toBe(true));

  it.each([
    "Esquece, não cancela mais",
    "Deixa pra lá",
    "Mudei de ideia",
    "Não precisa cancelar, ela pediu para manter",
    "Desisti desse pedido",
    "Por que ela cancelou?",
    "Pode confirmar",
    "Remarca para amanhã às 10h",
    "ok",
  ])("never reads %j as the reason", message => expect(isCancellationCauseStatement(message)).toBe(false));

  it("refuses a sentence longer than a stored reason", () => expect(isCancellationCauseStatement(`porque ${"a".repeat(200)}`)).toBe(false));
});
