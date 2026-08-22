import { withAuth } from "next-auth/middleware";
import type { NextRequestWithAuth } from "next-auth/middleware";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import {
  isSafeMarketingPreviewPath,
  isSafePreviewSessionProbe,
  isUnconfiguredVercelPreview,
} from "@/lib/runtime-environment";

const PROTECTED_PATH_PREFIXES = [
  "/hoje",
  "/dashboard",
  "/agenda",
  "/servicos",
  "/produtos",
  "/portfolio",
  "/profissionais",
  "/clientes",
  "/configuracoes",
  "/financeiro",
  "/fechamento",
  "/pacotes",
  "/relatorios",
  "/marketing",
  "/compartilhar",
  "/pagamentos",
  "/onboarding",
  "/pos-login",
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
 * Em Vercel Preview sem staging, permite somente a landing e seus assets
 * versionados para revisão visual. Apenas o probe anônimo de sessão recebe
 * `{}` diretamente; rotas com dados ou autenticação continuam bloqueadas.
 */
export default function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (
    isUnconfiguredVercelPreview(process.env) &&
    request.method === "GET" &&
    isSafePreviewSessionProbe(request.nextUrl.pathname)
  ) {
    // O cliente do NextAuth converte um objeto vazio em sessão nula. Retornar
    // JSON `null` diretamente faz sua rotina chamar Object.keys(null).
    const response = NextResponse.json({}, { status: 200 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Environment-Guard", "anonymous-session");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  if (
    isUnconfiguredVercelPreview(process.env) &&
    !isSafeMarketingPreviewPath(request.nextUrl.pathname)
  ) {
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

  if (isUnconfiguredVercelPreview(process.env)) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Environment-Guard", "marketing-only");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  if (isProtectedPath(request.nextUrl.pathname)) {
    return authMiddleware(request as NextRequestWithAuth, event);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
