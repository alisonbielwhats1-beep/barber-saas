"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Error boundary da vitrine do cliente. Sem isto, qualquer erro de servidor
 * (queda do banco, timeout de pool) virava tela branca para o cliente final —
 * a pior experiência possível para quem só quer marcar um horário.
 *
 * Linguagem propositalmente sem jargão: quem lê aqui é cliente do salão, não
 * usuário do sistema. Também oferece uma saída offline (ligar para o salão)
 * porque, se o banco caiu, navegar para outra página do site não resolve.
 */
export default function BookError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ salonSlug: string }>();

  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-destructive/10">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>

      <div>
        <h1 className="font-display text-xl">Não conseguimos carregar esta página</h1>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          Pode ter sido uma instabilidade momentânea. Tente de novo em alguns
          segundos.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <button
          onClick={reset}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground transition active:opacity-80"
        >
          <RefreshCw className="h-4 w-4" /> Tentar novamente
        </button>
        {params?.salonSlug && (
          <a
            href={`/book/${params.salonSlug}`}
            className="inline-flex h-12 items-center justify-center rounded-full border border-border text-sm font-medium text-muted-foreground transition active:opacity-80"
          >
            Voltar ao início
          </a>
        )}
      </div>

      {error.digest && (
        <p className="text-[11px] text-muted-foreground/40">ref: {error.digest}</p>
      )}
    </main>
  );
}
