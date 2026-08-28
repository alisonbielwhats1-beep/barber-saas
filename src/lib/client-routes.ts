const CLIENT_RETURN_PAGES = new Set([
  "agendar",
  "minhas",
  "notificacoes",
  "produtos",
]);

export type ClientBookingQuery = {
  service?: string;
  services?: string;
  pro?: string;
  reschedule?: string;
  version?: string;
};

export function clientBookingPath(salonSlug: string): string {
  return `/book/${salonSlug}/agendar`;
}

/** Mantém a escolha do cliente ao passar pela tela de autenticação. */
export function clientBookingReturnTo(
  salonSlug: string,
  query: ClientBookingQuery,
): string {
  const params = new URLSearchParams();
  const services = query.services ?? query.service;
  if (services) params.set("services", services.slice(0, 500));
  if (query.pro) params.set("pro", query.pro.slice(0, 120));
  if (query.reschedule) params.set("reschedule", query.reschedule.slice(0, 120));
  if (query.version) params.set("version", query.version.slice(0, 20));
  const encoded = params.toString();
  return `${clientBookingPath(salonSlug)}${encoded ? `?${encoded}` : ""}`;
}

/** Evita que a tela de entrada aceite retorno para outro host ou rota. */
export function safeClientReturnTo(
  salonSlug: string,
  returnTo: string | null | undefined,
  fallback = clientBookingPath(salonSlug),
): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(returnTo, "https://salon.invalid");
    const prefix = `/book/${salonSlug}/`;
    if (!parsed.pathname.startsWith(prefix)) return fallback;
    const page = parsed.pathname.slice(prefix.length);
    if (!CLIENT_RETURN_PAGES.has(page)) return fallback;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}
