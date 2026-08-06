"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingBag, Calendar, Image as ImageIcon, Bell } from "lucide-react";

export function BottomNav({ salonSlug }: { salonSlug: string }) {
  const pathname = usePathname();
  const items = [
    {
      href: `/book/${salonSlug}`,
      icon: Home,
      label: "Início",
      match: (p: string) => p === `/book/${salonSlug}`,
    },
    {
      href: `/book/${salonSlug}/produtos`,
      icon: ShoppingBag,
      label: "Loja",
      match: (p: string) => p.includes("/produtos") || p.includes("/carrinho"),
    },
    {
      href: `/book/${salonSlug}/portfolio`,
      icon: ImageIcon,
      label: "Fotos",
      match: (p: string) => p.includes("/portfolio"),
    },
    {
      href: `/book/${salonSlug}/minhas`,
      icon: Calendar,
      label: "Reservas",
      match: (p: string) => p.includes("/minhas"),
    },
    {
      href: `/book/${salonSlug}/notificacoes`,
      icon: Bell,
      label: "Notificações",
      match: (p: string) => p.includes("/notificacoes"),
    },
  ];

  return (
    <nav className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto flex w-auto max-w-[440px] justify-around gap-1 rounded-full border border-border/60 bg-card/90 px-3 py-2 shadow-lg backdrop-blur">
      {items.map((it) => {
        const active = it.match(pathname);
        return (
          <Link
            key={it.label}
            href={it.href}
            className={`grid h-11 w-11 place-items-center rounded-full transition ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label={it.label}
          >
            <it.icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
          </Link>
        );
      })}
    </nav>
  );
}
