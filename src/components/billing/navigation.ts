/** Leaves the app for a Mercado Pago page already validated by `safeCheckout`. */
export function goToCheckout(url: string) {
  window.location.assign(url);
}
