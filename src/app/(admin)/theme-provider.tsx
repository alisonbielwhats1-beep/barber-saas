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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("admin-theme");
      if (saved === "light") setTheme("light");
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("admin-theme", next);
      } catch {}
      return next;
    });
  }, []);

  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      <div
        data-theme={theme === "light" ? "admin-light" : undefined}
        style={{ display: "contents" }}
      >
        {children}
      </div>
    </ThemeCtx.Provider>
  );
}

export function useAdminTheme() {
  return useContext(ThemeCtx);
}
