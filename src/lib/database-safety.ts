export const DESTRUCTIVE_DATABASE_CONFIRMATION =
  "YES_I_AM_USING_A_DISPOSABLE_DATABASE";

const ALLOWED_APP_ENVIRONMENTS = new Set([
  "development",
  "test",
  "staging",
]);

const LOCAL_DATABASE_HOSTS = new Set([
  "127.0.0.1",
  "[::1]",
  "::1",
  "localhost",
  "postgres",
]);

export type DatabaseSafetyEnvironment = Record<string, string | undefined>;

export type DatabaseSafetyOptions = {
  destructive?: boolean;
  operation: string;
};

export type SafeDatabaseTarget = {
  appEnvironment: "development" | "test" | "staging";
  databaseHosts: string[];
  operation: string;
  target: "local" | "supabase-staging";
};

function fail(message: string): never {
  throw new Error(`[database-safety] ${message}`);
}

function parsePostgresUrl(value: string, variableName: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    fail(`${variableName} não é uma URL PostgreSQL válida.`);
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    fail(`${variableName} precisa usar o protocolo postgresql://.`);
  }

  return parsed;
}

function normalizeProjectRef(value: string | undefined, variableName: string) {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || !/^[a-z0-9-]+$/.test(normalized)) {
    fail(`${variableName} precisa conter um project ref Supabase válido.`);
  }

  return normalized;
}

function projectRefFromDatabaseUrl(databaseUrl: URL): string | null {
  const hostname = databaseUrl.hostname.toLowerCase();
  const username = decodeURIComponent(databaseUrl.username).toLowerCase();
  if (
    username.startsWith("postgres.") &&
    hostname.endsWith(".pooler.supabase.com")
  ) {
    return username.slice("postgres.".length);
  }

  const directHostMatch = hostname.match(
    /^db\.([a-z0-9-]+)\.supabase\.co$/,
  );

  return directHostMatch?.[1] ?? null;
}

function assertSupabaseStagingTarget(
  urls: URL[],
  environment: DatabaseSafetyEnvironment,
) {
  const stagingRef = normalizeProjectRef(
    environment.SUPABASE_PROJECT_REF,
    "SUPABASE_PROJECT_REF",
  );
  const productionRef = normalizeProjectRef(
    environment.PRODUCTION_SUPABASE_PROJECT_REF,
    "PRODUCTION_SUPABASE_PROJECT_REF",
  );

  if (stagingRef === productionRef) {
    fail("o project ref de homologação é igual ao de produção.");
  }

  const supabaseUrl = environment.SUPABASE_URL;
  if (!supabaseUrl) {
    fail("SUPABASE_URL é obrigatória para um banco remoto de homologação.");
  }

  let supabaseProjectUrl: URL;
  try {
    supabaseProjectUrl = new URL(supabaseUrl);
  } catch {
    fail("SUPABASE_URL não é uma URL válida.");
  }

  if (
    supabaseProjectUrl.protocol !== "https:" ||
    supabaseProjectUrl.hostname.toLowerCase() !== `${stagingRef}.supabase.co`
  ) {
    fail("SUPABASE_URL não corresponde ao project ref de homologação.");
  }

  for (const databaseUrl of urls) {
    const urlProjectRef = projectRefFromDatabaseUrl(databaseUrl);

    if (!urlProjectRef) {
      fail("o banco remoto precisa ser um projeto Supabase identificável.");
    }

    if (urlProjectRef === productionRef) {
      fail("a operação tentou usar o projeto Supabase de produção.");
    }

    if (urlProjectRef !== stagingRef) {
      fail("a conexão não corresponde ao project ref de homologação.");
    }
  }
}

/**
 * Bloqueia operações de schema/dados quando o destino não é inequivocamente
 * local, de teste ou o projeto Supabase de homologação declarado.
 *
 * Esta função nunca aceita APP_ENV=production. Alterações produtivas devem
 * passar por um fluxo separado, revisado e deliberadamente não automatizado.
 */
export function assertSafeDatabaseOperation(
  environment: DatabaseSafetyEnvironment,
  options: DatabaseSafetyOptions,
): SafeDatabaseTarget {
  const appEnvironment = environment.APP_ENV?.trim().toLowerCase();

  if (!appEnvironment || !ALLOWED_APP_ENVIRONMENTS.has(appEnvironment)) {
    fail(
      "APP_ENV deve ser explicitamente development, test ou staging; produção é bloqueada.",
    );
  }

  if (environment.VERCEL_ENV?.trim().toLowerCase() === "production") {
    fail("VERCEL_ENV=production bloqueia qualquer operação de banco.");
  }

  const rawUrls = [environment.DATABASE_URL, environment.DIRECT_URL].filter(
    (value): value is string => Boolean(value?.trim()),
  );

  if (rawUrls.length === 0) {
    fail("DATABASE_URL ou DIRECT_URL precisa estar configurada.");
  }

  const urls = rawUrls.map((value, index) =>
    parsePostgresUrl(
      value,
      index === 0 && environment.DATABASE_URL ? "DATABASE_URL" : "DIRECT_URL",
    ),
  );
  const allLocal = urls.every((url) =>
    LOCAL_DATABASE_HOSTS.has(url.hostname.toLowerCase()),
  );

  if (appEnvironment === "test" && !allLocal) {
    fail("APP_ENV=test aceita somente PostgreSQL local e descartável.");
  }

  if (appEnvironment === "development" && !allLocal) {
    fail("APP_ENV=development aceita somente PostgreSQL local.");
  }

  if (appEnvironment === "staging" && !allLocal) {
    assertSupabaseStagingTarget(urls, environment);
  }

  if (
    options.destructive &&
    environment.ALLOW_DESTRUCTIVE_DB_OPERATIONS !==
      DESTRUCTIVE_DATABASE_CONFIRMATION
  ) {
    fail(
      "a operação destrutiva exige confirmação explícita em banco descartável.",
    );
  }

  return {
    appEnvironment: appEnvironment as SafeDatabaseTarget["appEnvironment"],
    databaseHosts: [...new Set(urls.map((url) => url.hostname.toLowerCase()))],
    operation: options.operation,
    target: allLocal ? "local" : "supabase-staging",
  };
}
