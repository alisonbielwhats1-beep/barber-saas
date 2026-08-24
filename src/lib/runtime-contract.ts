export type RuntimeEnvironment = Record<string, string | undefined>;

export type RuntimeEnvironmentName =
  | "development"
  | "test"
  | "staging"
  | "production";

export type RuntimeContractIssue = {
  key: string;
  message: string;
};

const VALID_ENVIRONMENTS = new Set<RuntimeEnvironmentName>([
  "development",
  "test",
  "staging",
  "production",
]);

const BASE_REQUIRED_KEYS = [
  "APP_ENV",
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
] as const;

const REMOTE_REQUIRED_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function requiredValue(
  environment: RuntimeEnvironment,
  key: string,
  issues: RuntimeContractIssue[],
) {
  if (environment[key]?.trim()) return environment[key]!.trim();
  issues.push({ key, message: "variável obrigatória não configurada" });
  return null;
}

function isLocalDatabase(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"].includes(
      url.hostname.toLowerCase(),
    );
  } catch {
    return false;
  }
}

function usesPostgresSuperuser(value: string) {
  try {
    return decodeURIComponent(new URL(value).username).toLowerCase() === "postgres";
  } catch {
    return false;
  }
}

function validateDatabaseUrl(
  value: string | null,
  key: string,
  issues: RuntimeContractIssue[],
) {
  if (!value) return;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push({ key, message: "não é uma URL válida" });
    return;
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    issues.push({ key, message: "precisa usar o protocolo PostgreSQL" });
  }
}

function validateHttpsUrl(
  value: string | null,
  key: string,
  environmentName: RuntimeEnvironmentName,
  issues: RuntimeContractIssue[],
) {
  if (!value) return;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push({ key, message: "não é uma URL válida" });
    return;
  }

  if (
    (environmentName === "production" || environmentName === "staging") &&
    url.protocol !== "https:"
  ) {
    issues.push({ key, message: "precisa usar HTTPS neste ambiente" });
  }
}

function validateSupabaseProjectRefs(
  environment: RuntimeEnvironment,
  issues: RuntimeContractIssue[],
) {
  const stagingRef = requiredValue(environment, "SUPABASE_PROJECT_REF", issues);
  const productionRef = requiredValue(
    environment,
    "PRODUCTION_SUPABASE_PROJECT_REF",
    issues,
  );

  if (
    stagingRef &&
    productionRef &&
    stagingRef.toLowerCase() === productionRef.toLowerCase()
  ) {
    issues.push({
      key: "SUPABASE_PROJECT_REF",
      message: "não pode ser igual ao project ref de produção",
    });
  }

  if (stagingRef && !/^[a-z0-9-]+$/.test(stagingRef)) {
    issues.push({
      key: "SUPABASE_PROJECT_REF",
      message: "precisa ser um project ref válido",
    });
  }

  if (productionRef && !/^[a-z0-9-]+$/.test(productionRef)) {
    issues.push({
      key: "PRODUCTION_SUPABASE_PROJECT_REF",
      message: "precisa ser um project ref válido",
    });
  }

  const supabaseUrl = environment.SUPABASE_URL?.trim();
  if (!supabaseUrl || !stagingRef) return;

  try {
    const url = new URL(supabaseUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== `${stagingRef.toLowerCase()}.supabase.co`
    ) {
      issues.push({
        key: "SUPABASE_URL",
        message: "não corresponde ao project ref de homologação",
      });
    }
  } catch {
    issues.push({ key: "SUPABASE_URL", message: "não é uma URL válida" });
  }
}

/**
 * Valida somente a presença e a coerência do ambiente. Nunca retorna valores
 * de secrets, para que o resultado possa ser usado no CI sem vazar credenciais.
 */
export function validateRuntimeContract(
  environment: RuntimeEnvironment,
): RuntimeContractIssue[] {
  const issues: RuntimeContractIssue[] = [];
  const rawEnvironment = environment.APP_ENV?.trim().toLowerCase();

  if (
    !rawEnvironment ||
    !VALID_ENVIRONMENTS.has(rawEnvironment as RuntimeEnvironmentName)
  ) {
    issues.push({
      key: "APP_ENV",
      message: "precisa ser development, test, staging ou production",
    });
    return issues;
  }

  const environmentName = rawEnvironment as RuntimeEnvironmentName;
  const values = new Map<string, string | null>();

  for (const key of BASE_REQUIRED_KEYS) {
    values.set(key, requiredValue(environment, key, issues));
  }

  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    validateDatabaseUrl(values.get(key) ?? null, key, issues);
  }

  validateHttpsUrl(
    values.get("NEXTAUTH_URL") ?? null,
    "NEXTAUTH_URL",
    environmentName,
    issues,
  );

  if (environmentName === "staging" || environmentName === "production") {
    for (const key of REMOTE_REQUIRED_KEYS) {
      requiredValue(environment, key, issues);
    }
    requiredValue(environment, "CRON_SECRET", issues);
  }

  if (environmentName === "staging") {
    validateSupabaseProjectRefs(environment, issues);
  }

  const vercelEnvironment = environment.VERCEL_ENV?.trim().toLowerCase();
  if (
    environmentName === "production" &&
    vercelEnvironment &&
    vercelEnvironment !== "production"
  ) {
    issues.push({
      key: "VERCEL_ENV",
      message: "produção só pode rodar em Vercel Production",
    });
  }

  if (
    environmentName === "staging" &&
    vercelEnvironment &&
    vercelEnvironment !== "preview"
  ) {
    issues.push({
      key: "VERCEL_ENV",
      message: "homologação na Vercel deve rodar em Preview",
    });
  }

  const databaseUrl = values.get("DATABASE_URL");
  if (
    environmentName === "production" &&
    databaseUrl &&
    isLocalDatabase(databaseUrl)
  ) {
    issues.push({
      key: "DATABASE_URL",
      message: "produção não pode apontar para um banco local",
    });
  }

  if (
    environmentName === "production" &&
    databaseUrl &&
    usesPostgresSuperuser(databaseUrl)
  ) {
    issues.push({
      key: "DATABASE_URL",
      message: "runtime não deve usar a role postgres com BYPASSRLS",
    });
  }

  return issues;
}
