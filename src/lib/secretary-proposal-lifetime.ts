/** Display deadlines never extend backend validity. Missing deadlines support
 * older in-memory views; real proposal schemas always provide expires_at. */
export function proposalHasExpired(proposal: {expires_at?: string} | undefined, now=Date.now()) {
  if (!proposal || proposal.expires_at === undefined) return false;
  const expiry=Date.parse(proposal.expires_at);
  return !Number.isFinite(expiry) || expiry <= now;
}
export const expiredProposalMessage="Esta proposta expirou. Os dados foram preservados. Envie uma mensagem para preparar uma nova proposta antes de confirmar.";
