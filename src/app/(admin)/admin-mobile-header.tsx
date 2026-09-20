"use client";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand";
import { PlanShortcut } from "./plan-shortcut";
import { ThemeToggle } from "./theme-toggle";

export function AdminMobileHeader({
  role,
  plan,
  planHref,
}: {
  role: string;
  plan: string | null;
  planHref: string;
}) {
  const pathname = usePathname();
  const owner = role === "OWNER";
  if (pathname !== "/hoje") return null;
  return (
    <header
      role="region"
      aria-label="Marca e aparência"
      className="flex items-center justify-between gap-2 border-b border-border bg-surface-1 px-3 py-2 lg:hidden print:hidden"
    >
      <BrandLogo
        className={`!h-9 shrink-0 text-[hsl(var(--selection-foreground))] ${owner ? "!w-[100px] sm:!w-[142px]" : "!w-[142px]"}`}
      />
      {owner && (
        <div
          aria-label="Plano do estabelecimento"
          className="ml-auto min-w-0 max-w-40"
        >
          <PlanShortcut compact plan={plan} href={planHref} />
        </div>
      )}
      <ThemeToggle />
    </header>
  );
}
