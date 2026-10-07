"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { OPEN_MORE_EVENT, mobileScreenFor } from "./mobile-navigation";
import { ThemeToggle } from "./theme-toggle";
import { requestCommandPaletteOpen } from "./command-palette";

/** Screens with their own top area on phones: Hoje (brand header) and Agenda (date toolbar). */
const OWN_HEADER = ["/hoje", "/agenda"];
/** Nested screens go back to their parent; other module screens go back to "Mais". */
const PARENTS: Array<[path: string, parent: string, label: string]> = [
  ["/servicos/secretaria", "/servicos", "Serviços"],
  ["/plataforma/cobrancas", "/plataforma/solicitacoes", "Administração"],
];

/**
 * Compact app bar of the panel below 1024px. It stays pinned while the page
 * scrolls; the screen title fades in once the page's large title leaves the view.
 */
export function MobileTopBar() {
  const pathname = usePathname();
  const bar = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);
  const screen = mobileScreenFor(pathname);
  const parent = PARENTS.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
  const hidden = OWN_HEADER.includes(pathname);

  useEffect(() => {
    if (hidden) return;
    const root = document.getElementById("main-content");
    if (!root) return;
    // The page's h1 is looked up on every check: streaming and refreshes replace it.
    let frame = 0;
    const check = () => {
      frame = 0;
      const title = root.querySelector("h1");
      const barBottom = bar.current?.getBoundingClientRect().bottom ?? 52;
      setCondensed(!title || title.getBoundingClientRect().bottom <= barBottom);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(check); };
    check();
    // The page (and its h1) may stream in after the bar mounts: re-check when the content changes.
    const content = new MutationObserver(schedule);
    content.observe(root, { childList: true, subtree: true });
    root.addEventListener("scroll", schedule, { passive: true });
    return () => {
      root.removeEventListener("scroll", schedule);
      content.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pathname, hidden]);

  if (hidden) return null;

  return (
    <div
      ref={bar}
      role="region"
      aria-label="Barra da tela"
      data-condensed={condensed}
      className="app-topbar sticky top-0 z-30 flex h-[3.25rem] items-center gap-1 border-b border-transparent bg-background/80 px-1.5 lg:hidden print:hidden"
    >
      <div className="flex min-w-[5.5rem] items-center">
        {parent ? (
          <Link href={parent[1]} className="press inline-flex min-h-11 items-center gap-0.5 rounded-xl pl-1 pr-2.5 text-[15px] font-medium text-primary">
            <ChevronLeft aria-hidden="true" className="h-6 w-6" />
            {parent[2]}
          </Link>
        ) : !screen.isTabRoot ? (
          <button
            type="button"
            aria-label="Voltar ao menu Mais"
            onClick={() => window.dispatchEvent(new Event(OPEN_MORE_EVENT))}
            className="press inline-flex min-h-11 items-center gap-0.5 rounded-xl pl-1 pr-2.5 text-[15px] font-medium text-primary"
          >
            <ChevronLeft aria-hidden="true" className="h-6 w-6" />
            Mais
          </button>
        ) : null}
      </div>
      <p aria-hidden="true" className="app-topbar-title min-w-0 flex-1 truncate text-center text-[15px] font-semibold">{screen.title}</p>
      <div className="flex min-w-[5.5rem] items-center justify-end gap-1">
        <button
          type="button"
          aria-label="Buscar"
          aria-haspopup="dialog"
          data-command-palette-trigger="true"
          onClick={(event) => requestCommandPaletteOpen(event.currentTarget)}
          className="press grid h-11 w-11 place-items-center rounded-full text-foreground hover:bg-card-hover"
        >
          <Search aria-hidden="true" className="h-5 w-5" />
        </button>
        <ThemeToggle className="h-11 w-11 rounded-full border-0 bg-transparent hover:bg-card-hover" />
      </div>
    </div>
  );
}
