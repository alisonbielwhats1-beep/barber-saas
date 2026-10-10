/** Public, fixed codes only: NextAuth v4 transports Error.message to the browser. */
export class LoginError extends Error {
  constructor(code: "LOGIN_RATE_LIMITED" | "LOGIN_TEMPORARILY_UNAVAILABLE") {
    super(code);
    this.name = "LoginError";
  }
}

export function loginErrorMessage(code?: string | null): string {
  if (code === "CredentialsSignin") return "E-mail ou senha incorretos. Confira os dados e tente novamente.";
  if (code === "LOGIN_RATE_LIMITED") return "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.";
  // Never display provider messages, database errors or unknown transport errors.
  return "Não foi possível entrar agora por uma falha temporária. Aguarde um pouco e tente novamente.";
}
