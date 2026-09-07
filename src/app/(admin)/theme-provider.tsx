"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeCtx = createContext<ThemeContextValue>({ theme: "dark", toggle: () => {} });

function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.setAttribute("data-theme", t === "light" ? "admin-light" : "admin-dark");
}

/**
 * O atributo vive no <html> e é aplicado ANTES do primeiro paint por um
 * script inline no layout do admin — este provider só mantém o estado React
 * (ícone do toggle) em sincronia e persiste a escolha.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    let initial: Theme = "dark";
    try {
      if (localStorage.getItem("admin-theme") === "light") initial = "light";
    } catch {}
    setTheme(initial);
    applyTheme(initial);
    // Saiu do admin (navegação client-side): não vazar o tema para outras áreas
    return () => document.documentElement.removeAttribute("data-theme");
  }, []);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem("admin-theme", next);
      } catch {}
      return next;
    });
  }, []);

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export function useAdminTheme() {
  return useContext(ThemeCtx);
}
