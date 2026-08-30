import { STORAGE_BUCKET } from "./storage-constants";

const LEGACY_IMAGE_HOSTS = new Set([
  "images.unsplash.com",
  "avatars.githubusercontent.com",
]);

function parseHttpsUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

export function isRenderableImageUrl(value: string): boolean {
  if (value.startsWith("/images/") || value.startsWith("/icon")) return true;
  const parsed = parseHttpsUrl(value);
  if (!parsed) return false;
  if (LEGACY_IMAGE_HOSTS.has(parsed.hostname)) return true;
  if (
    !parsed.hostname.endsWith(".supabase.co") ||
    !parsed.pathname.startsWith(`/storage/v1/object/public/${STORAGE_BUCKET}/`)
  ) {
    return false;
  }

  // Server Components conhecem a origem exata. No bundle cliente essa
  // variável server-only não é exposta; a Server Action ainda revalida host e
  // tenant antes de persistir qualquer alteração.
  try {
    const configuredHost = new URL(process.env.SUPABASE_URL ?? "").hostname;
    return configuredHost ? parsed.hostname === configuredHost : true;
  } catch {
    return true;
  }
}

/**
 * Novas imagens persistidas precisam vir do bucket do próprio tenant. Hosts
 * legados confiáveis continuam aceitos para que registros antigos possam ser
 * editados sem quebra, mas URLs arbitrárias nunca chegam ao next/image.
 */
export function isAllowedStoredImageUrl(
  value: string | null | undefined,
  salonId: string,
): boolean {
  if (!value) return true;
  const parsed = parseHttpsUrl(value);
  if (!parsed) return false;
  if (LEGACY_IMAGE_HOSTS.has(parsed.hostname)) return true;

  let storageHost: string | null = null;
  try {
    storageHost = new URL(process.env.SUPABASE_URL ?? "").hostname;
  } catch {
    return false;
  }

  const tenantPrefix = `/storage/v1/object/public/${STORAGE_BUCKET}/${salonId}/`;
  return parsed.hostname === storageHost && parsed.pathname.startsWith(tenantPrefix);
}

export function assertAllowedStoredImageUrl(
  value: string | null | undefined,
  salonId: string,
): void {
  if (!isAllowedStoredImageUrl(value, salonId)) {
    throw new Error("Imagem inválida ou pertencente a outro estabelecimento.");
  }
}
