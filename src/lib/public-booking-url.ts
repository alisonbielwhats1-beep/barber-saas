/** Endereço de divulgação separado do login para preservar acessos antigos. */
export function getPublicBookingUrl(
  salonSlug: string,
  fallbackOrigin = "https://salon-saas-ruby.vercel.app",
): string {
  const publicOrigin = process.env.PUBLIC_BOOKING_URL?.trim();
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    const localHttp = url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash
    ) {
      throw new Error("PUBLIC_BOOKING_URL deve ser uma origem HTTPS, sem caminho ou credenciais.");
    }
    return `${url.origin}/book/${encodeURIComponent(salonSlug)}`;
  }

  const origin = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? fallbackOrigin;
  return `${origin}/book/${encodeURIComponent(salonSlug)}`;
}
