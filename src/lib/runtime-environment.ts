export type RuntimeEnvironment = Record<string, string | undefined>;

/**
 * Vercel cria Preview Deployments automaticamente para pull requests. O app
 * permanece indisponível até que alguém configure deliberadamente a Preview
 * como homologação, evitando que credenciais herdadas apontem para produção.
 */
export function isUnconfiguredVercelPreview(
  environment: RuntimeEnvironment,
): boolean {
  return (
    environment.VERCEL_ENV?.trim().toLowerCase() === "preview" &&
    environment.APP_ENV?.trim().toLowerCase() !== "staging"
  );
}
