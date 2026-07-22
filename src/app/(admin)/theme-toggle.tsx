"use client";

import { Moon, Sun } from "lucide-react";
import { useAdminTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggle } = useAdminTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      {theme === "dark" ? (
        <Sun className="h-3.5 w-3.5" />
      ) : (
        <Moon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
