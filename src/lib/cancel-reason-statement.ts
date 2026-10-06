/** Owner, 06/10/2026 (flag SALON_SECRETARY_CANCEL_REASON_OPTIONAL): a cancellation goes straight to Confirmar, without asking a reason.
 * When the owner still explains the cause while it is open ("Ela solicitou a mudança de planos", "porque ela viajou"), that sentence is the
 * reason, kept literally: it is never read as giving up. Discarding stays the owner's explicit words ("esquece", "não cancela mais",
 * "deixa pra lá", "mudei de ideia"). Read with no model call; anything else goes on as before. */
const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();

const CAUSE = /\b(solicit\w*|pediu|pediram|porque|pois|por causa|devido|motivo|imprevisto|emergencia|viaj\w*|viagem|doente|passou mal|internad\w*|consulta medica|trabalho|compromisso|mudou de planos|mudanca de planos|nao (vai |vao )?(poder|pode|podera|consegue|conseguira|conseguiu|vai|vao) (mais )?(vir|comparecer|ir)|desmarc\w*)\b/;
const WITHDRAWAL = /\b(esquec\w*|deixa (pra|para) la|nao cancel\w*|nao precisa|desist\w*|mudei de ideia|descart\w*|nao quero mais|volta atras|cancela (o|esse|este) pedido|para tudo)\b/;
const QUESTION = /\?\s*$/;

export const CANCEL_REASON_MAX = 200;

export function isCancellationCauseStatement(message: string) {
  const text = message.trim();
  if (text.length < 3 || text.length > CANCEL_REASON_MAX || QUESTION.test(text)) return false;
  const folded = fold(text);
  return CAUSE.test(folded) && !WITHDRAWAL.test(folded);
}
