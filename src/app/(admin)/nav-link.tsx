"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavLinkProps = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export function NavLink({ href, label, icon: Icon }: NavLinkProps) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
      )}
      <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "")} />
      {label}
    </Link>
  );
}
