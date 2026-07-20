import { BottomNav } from "../bottom-nav";
import { MinhasList } from "./minhas-list";

export default function MinhasPage({
  params,
}: {
  params: { salonSlug: string };
}) {
  return (
    <main className="animate-fade-in space-y-6 px-5 pt-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Suas reservas
        </p>
        <h1 className="text-2xl font-semibold">Minhas visitas</h1>
      </header>

      <MinhasList salonSlug={params.salonSlug} />

      <BottomNav salonSlug={params.salonSlug} />
    </main>
  );
}
