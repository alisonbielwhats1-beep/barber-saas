/** One authentication authority per deployment; never fall back after an Auth error. */
export function supabaseAuthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AUTH_PROVIDER === "supabase";
}

export function authConfig(env: Record<string, string | undefined> = process.env) {
  if (!supabaseAuthEnabled(env)) throw new Error("AUTH_NOT_ENABLED");
  const url = new URL(env.SUPABASE_URL ?? "");
  const key = env.SUPABASE_AUTH_PUBLISHABLE_KEY?.trim();
  if (!key || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("AUTH_CONFIGURATION_INVALID");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && url.protocol !== "https:") throw new Error("AUTH_HTTPS_REQUIRED");
  if (["test", "development"].includes(env.APP_ENV ?? "") && !local) {
    throw new Error("AUTH_REMOTE_TEST_BLOCKED");
  }
  if (env.VERCEL_ENV === "preview" || env.APP_ENV === "staging") {
    if (env.APP_ENV !== "staging" || !env.SUPABASE_PROJECT_REF ||
        !env.PRODUCTION_SUPABASE_PROJECT_REF ||
        env.SUPABASE_PROJECT_REF === env.PRODUCTION_SUPABASE_PROJECT_REF ||
        url.hostname !== `${env.SUPABASE_PROJECT_REF}.supabase.co`) {
      throw new Error("AUTH_STAGING_TARGET_INVALID");
    }
  }
  return { url: url.origin, key };
}

export function recoveryPath(salonSlug?: string) {
  if (salonSlug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(salonSlug)) {
    throw new Error("INVALID_RECOVERY_CONTEXT");
  }
  return salonSlug ? `/book/${salonSlug}/redefinir-senha` : "/redefinir-senha";
}

export function recoveryRedirect(salonSlug?: string, env: Record<string, string | undefined> = process.env) {
  const origin = salonSlug ? env.CLIENT_APP_URL || env.NEXTAUTH_URL : env.OWNER_APP_URL || env.NEXTAUTH_URL;
  const url = new URL(origin ?? "");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      (["test", "development"].includes(env.APP_ENV ?? "") && !local)) {
    throw new Error("INVALID_APPLICATION_ORIGIN");
  }
  return new URL(recoveryPath(salonSlug), url).toString();
}
