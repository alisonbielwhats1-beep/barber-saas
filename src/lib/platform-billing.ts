export function isPlatformBillingEnabled() {
  return process.env.PLATFORM_BILLING_ENABLED === "true";
}

export function assertPlatformBillingEnabled() {
  if (!isPlatformBillingEnabled()) {
    throw new Error("O controle de cobranças ainda não foi ativado neste ambiente");
  }
}
