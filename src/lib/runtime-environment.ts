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

/**
 * Mantém o Preview sem staging útil apenas para revisão visual da landing.
 * Nenhuma rota de autenticação, agendamento, API ou painel entra nesta lista.
 */
export function isSafeMarketingPreviewPath(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/images/");
}

/**
 * A landing monta o SessionProvider, que consulta este endpoint via GET mesmo
 * sem autenticação. Em Preview sem staging, o middleware responde `null`
 * diretamente e não encaminha a requisição ao NextAuth ou ao banco.
 */
export function isSafePreviewSessionProbe(pathname: string): boolean {
  return pathname === "/api/auth/session";
}
