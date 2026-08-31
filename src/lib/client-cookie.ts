export function clientCookieIsSecure(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (environment.NODE_ENV !== "production") return false;

  // Testes de integração podem executar o build de produção em loopback HTTP.
  // Cookies `Secure` seriam silenciosamente descartados pelo navegador nesse
  // caso. A exceção é limitada a hosts locais explícitos; URL ausente,
  // inválida ou remota continua falhando para o modo seguro.
  try {
    const url = new URL(environment.NEXTAUTH_URL ?? "");
    if (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    ) {
      return false;
    }
  } catch {
    // Produção sem uma URL local inequívoca mantém o cookie seguro.
  }

  return true;
}
