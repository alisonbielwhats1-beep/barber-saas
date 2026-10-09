/** Leaves the app for a payment page (Mercado Pago or Stripe) already validated by `safeCheckout`. */
export function goToCheckout(url: string) {
  window.location.assign(url);
}
