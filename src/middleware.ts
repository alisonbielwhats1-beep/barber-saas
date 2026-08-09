import { withAuth } from "next-auth/middleware";
import type { NextRequestWithAuth } from "next-auth/middleware";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { isUnconfiguredVercelPreview } from "@/lib/runtime-environment";

const PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/agenda",
  "/servicos",
  "/produtos",
  "/portfolio",
  "/profissionais",
  "/clientes",
  "/configuracoes",
  "/financeiro",
  "/pacotes",
  "/relatorios",
  "/marketing",
  "/compartilhar",
  "/pagamentos",
  "/onboarding",
  "/plataforma",
] as const;

const authMiddleware = withAuth({
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/login" },
});

function isProtectedPath(pathname: string) {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Protege as rotas administrativas: sem sessão válida, redireciona para /login.
 * Em Vercel Preview, bloqueia todas as rotas até o ambiente ser explicitamente
 * classificado como staging.
 */
export default function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (isUnconfiguredVercelPreview(process.env)) {
    return new NextResponse(
      "Ambiente de homologação ainda não foi configurado com segurança.",
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": "300",
          "X-Environment-Guard": "blocked",
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    );
  }

  if (isProtectedPath(request.nextUrl.pathname)) {
    return authMiddleware(request as NextRequestWithAuth, event);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
