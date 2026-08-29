import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * 404 global — cobre qualquer URL desconhecida fora da vitrine do cliente
 * (que tem o seu próprio, no tema salon-dark). Antes o projeto não tinha
 * nenhum, então caía no 404 padrão do Next, sem identidade e em inglês.
 */
export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 text-center outline-none">
      <p className="font-display text-6xl text-primary">404</p>

      <div>
        <h1 className="font-display text-2xl">Página não encontrada</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          O endereço não existe ou foi movido.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/">Ir para o início</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Entrar no painel</Link>
        </Button>
      </div>
    </main>
  );
}
