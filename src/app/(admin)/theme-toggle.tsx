"use client";

import { Moon, Sun } from "lucide-react";
import { useAdminTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggle } = useAdminTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      aria-label={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4 text-warning" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}
