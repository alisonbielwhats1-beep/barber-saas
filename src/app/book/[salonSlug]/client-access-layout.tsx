import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand";

/** Shared, scrollable entry surface for welcome, login and registration. */
export function ClientAccessLayout({
  salonName,
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  salonName?: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="client-access">
      <header className="client-access-brand">
        <BrandLogo className="client-brand-logo" />
        {salonName && <p className="mt-3 break-words text-sm text-muted-foreground">{salonName}</p>}
      </header>
      <section className="client-access-card" aria-labelledby="client-access-title">
        <div className="mb-6">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
          <h1 id="client-access-title" className="mt-2 break-words text-[clamp(1.5rem,6vw,1.875rem)] font-semibold leading-tight tracking-tight">{title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {children}
      </section>
      {footer && <div className="mt-4 w-full">{footer}</div>}
    </main>
  );
}
