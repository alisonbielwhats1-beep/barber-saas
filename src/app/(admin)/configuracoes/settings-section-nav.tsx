"use client";

import {
  Bell,
  CalendarClock,
  Crown,
  Palette,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

const SECTIONS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "perfil", label: "Perfil", icon: UserRound },
  { id: "aparencia", label: "Aparência", icon: Palette },
  { id: "agenda", label: "Agenda", icon: CalendarClock },
  { id: "notificacoes", label: "Notificações", icon: Bell },
  { id: "seguranca", label: "Segurança", icon: ShieldCheck },
  { id: "plano", label: "Plano", icon: Crown },
];

export function SettingsSectionNav() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  useEffect(() => {
    const validIds = new Set(SECTIONS.map((section) => section.id));
    const syncFromHash = () => {
      const id = window.location.hash.slice(1);
      if (validIds.has(id)) setActiveSection(id);
    };

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);

    if (typeof IntersectionObserver === "undefined") {
      return () => window.removeEventListener("hashchange", syncFromHash);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.1] },
    );

    for (const section of SECTIONS) {
      const target = document.getElementById(section.id);
      if (target) observer.observe(target);
    }

    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", syncFromHash);
    };
  }, []);

  function handleNavigate(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    const target = document.getElementById(id);
    if (!target) return;

    event.preventDefault();
    setActiveSection(id);
    window.history.pushState(null, "", `#${id}`);
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  return (
    <nav
      aria-label="Seções de configurações"
      className="sticky top-0 z-20 -mx-1 overflow-x-auto rounded-2xl border border-border bg-background/95 p-1.5 shadow-sm backdrop-blur sm:mx-0"
    >
      <div className="flex min-w-max items-center gap-1">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={activeSection === id ? "location" : undefined}
            onClick={(event) => handleNavigate(event, id)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              activeSection === id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-card-hover hover:text-foreground"
            }`}
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}
