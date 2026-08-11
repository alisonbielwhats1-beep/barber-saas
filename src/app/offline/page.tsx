import { WifiOff } from "lucide-react";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
      <div className="max-w-sm rounded-2xl border border-border bg-card p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
          <WifiOff className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">Você está sem conexão</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reconecte-se para consultar ou alterar agenda, clientes e pagamentos. Seus dados não são armazenados offline neste dispositivo.
        </p>
        <Link href="/" className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
          Tentar novamente
        </Link>
      </div>
    </main>
  );
}
