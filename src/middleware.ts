import { withAuth } from "next-auth/middleware";

/**
 * Protege as rotas administrativas: sem sessão válida, redireciona para /login.
 * O NextAuth injeta o próprio middleware — este arquivo só declara o matcher.
 */
export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/agenda/:path*",
    "/servicos/:path*",
    "/produtos/:path*",
    "/portfolio/:path*",
    "/profissionais/:path*",
    "/clientes/:path*",
    "/configuracoes/:path*",
  ],
};
