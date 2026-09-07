import { ArrowUpRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export function SalonLocationLink({
  address,
  className,
}: {
  address: string | null;
  className?: string;
}) {
  const location = address?.trim();
  if (!location) return null;

  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex min-h-11 min-w-0 items-start gap-2.5 rounded-lg py-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      <MapPin aria-hidden="true" className="client-location-icon mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">
        <span className="block">{location}</span>
        <span className="mt-1 flex items-center gap-1 text-xs font-semibold underline underline-offset-4">
          Abrir no Google Maps
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="sr-only"> (abre em nova aba)</span>
        </span>
      </span>
    </a>
  );
}
