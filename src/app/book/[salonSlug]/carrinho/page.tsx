import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BottomNav } from "../bottom-nav";
import { CartView } from "./cart-view";

export default function CarrinhoPage({
  params,
}: {
  params: { salonSlug: string };
}) {
  return (
    <main className="animate-fade-in space-y-6 px-5 pt-6">
      <header className="flex items-center gap-3">
        <Link
          href={`/book/${params.salonSlug}/produtos`}
          className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-lg font-semibold">Seu carrinho</h1>
      </header>

      <CartView salonSlug={params.salonSlug} />

      <BottomNav salonSlug={params.salonSlug} />
    </main>
  );
}
