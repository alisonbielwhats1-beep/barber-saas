import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * Renderizado quando `notFound()` dispara na vitrine — o caso real é slug de
 * salão inexistente (link antigo, digitado errado ou salão removido).
 * Antes caía no 404 padrão do Next, sem o tema do cliente e em inglês.
 */
export default function BookNotFound() {
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-muted">
        <SearchX className="h-8 w-8 text-muted-foreground" />
      </div>

      <div>
        <h1 className="font-display text-xl">Estabelecimento não encontrado</h1>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          Este link pode estar desatualizado. Confirme o endereço com o
          estabelecimento.
        </p>
      </div>

      <Link
        href="/"
        className="inline-flex h-12 items-center justify-center rounded-full border border-border px-6 text-sm font-medium text-muted-foreground transition active:opacity-80"
      >
        Conhecer a plataforma
      </Link>
    </main>
  );
}
