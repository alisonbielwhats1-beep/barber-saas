import Image from "next/image";
import { ChevronRight, Search } from "lucide-react";

const SERVICES = [
  { name: "Serviço", duration: "45 min" },
  { name: "Serviço", duration: "30 min" },
  { name: "Serviço", duration: "1h" },
];

/**
 * Mockup ilustrativo da vitrine do cliente (formato celular) — mesma lógica
 * do ProductMockup: forma real da experiência, sem dado ou número inventado.
 */
export function ClientMockup() {
  return (
    <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-[2rem] border border-border bg-card shadow-2xl">
      <div className="relative h-28 w-full overflow-hidden">
        <Image
          src="/images/salon-hero-stylist-v1.webp"
          alt=""
          fill
          sizes="280px"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <p className="absolute bottom-3 left-4 text-sm font-semibold text-white">Nome do estabelecimento</p>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          Buscar serviços…
        </div>
        {SERVICES.map((s, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2.5 text-[12px]"
          >
            <div>
              <p className="font-medium">{s.name}</p>
              <p className="text-[10px] text-muted-foreground">{s.duration}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        ))}
      </div>
    </div>
  );
}
