"use client";

import { SessionProvider } from "next-auth/react";

/**
 * A sessão é JWT (`strategy: "jwt"` em lib/auth.ts), então revalidar não traz
 * nada de novo — o token já carrega tudo e só muda em login/logout. Com os
 * padrões do NextAuth, cada foco de janela disparava um GET /api/auth/session:
 * os logs de produção mostravam 5 chamadas em 6 segundos, cada uma um
 * round-trip do Brasil até a serverless function.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
      {children}
    </SessionProvider>
  );
}
