export const DEFAULT_AUTH_CALLBACK = "/dashboard";

const ALLOWED_EXACT_PATHS = new Set([
  "/",
  "/agenda",
  "/clientes",
  "/compartilhar",
  "/configuracoes",
  "/dashboard",
  "/financeiro",
  "/marketing",
  "/pacotes",
  "/portfolio",
  "/produtos",
  "/profissionais",
  "/relatorios",
  "/servicos",
]);

const INVITE_PATH = /^\/convite\/[A-Za-z0-9_-]{20,256}$/;
const INTERNAL_ORIGIN = "https://callback.invalid";

/**
 * Aceita somente rotas internas conhecidas, iniciadas por uma única barra.
 * O retorno sempre é relativo e seguro para router.push/redirect.
 */
export function sanitizeAuthCallback(
  value: string | null | undefined,
  fallback = DEFAULT_AUTH_CALLBACK,
): string {
  if (!value || value !== value.trim()) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\") || /[\u0000-\u001F\u007F]/.test(value)) {
    return fallback;
  }

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN) return fallback;
    if (
      !ALLOWED_EXACT_PATHS.has(parsed.pathname) &&
      !INVITE_PATH.test(parsed.pathname)
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function safeNextAuthRedirect(url: string, baseUrl: string): string {
  if (url.startsWith("/")) {
    return `${baseUrl}${sanitizeAuthCallback(url)}`;
  }

  try {
    const parsed = new URL(url);
    if (parsed.origin !== baseUrl) return `${baseUrl}${DEFAULT_AUTH_CALLBACK}`;
    const relative = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `${baseUrl}${sanitizeAuthCallback(relative)}`;
  } catch {
    return `${baseUrl}${DEFAULT_AUTH_CALLBACK}`;
  }
}
