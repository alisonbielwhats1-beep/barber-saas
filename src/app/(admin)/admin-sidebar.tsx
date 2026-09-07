"use client";

import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { SidebarNav } from "./sidebar-nav";
import { SidebarFooter } from "./sidebar-footer";
import { SalonSwitcher } from "./salon-switcher";
import { OpenCommandPaletteButton } from "./command-palette";

type Salon = { id: string; name: string; role: string };

export function AdminSidebar({ current, memberships, role, plan, unreadNotifications, isPlatformAdmin }: {
  current: Salon; memberships: Salon[]; role: string; plan: string;
  unreadNotifications: number; isPlatformAdmin: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("admin-sidebar-collapsed") === "true"); } catch { /* Optional preference. */ }
  }, []);
  function toggle() {
    setCollapsed(value => {
      try { localStorage.setItem("admin-sidebar-collapsed", String(!value)); } catch { /* Navigation remains usable. */ }
      return !value;
    });
  }
  const label = collapsed ? "Expandir menu" : "Recolher menu";
  return (
    <aside aria-label="Menu do estabelecimento" data-collapsed={collapsed} className={`admin-sidebar hidden shrink-0 flex-col border-r border-border lg:flex print:hidden ${collapsed ? "w-[72px]" : "w-56"}`}>
      <div className={`flex shrink-0 items-center p-3 ${collapsed ? "flex-col gap-1" : "justify-between"}`}>
        <span role="img" aria-label="Everflair — símbolo Flair" className="grid h-11 w-11 place-items-center text-[hsl(var(--selection-foreground))]">
          <BrandMark className="!h-8 !w-8" />
        </span>
        <button type="button" onClick={toggle} aria-label={label} title={label} aria-expanded={!collapsed} aria-controls="admin-navigation" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        </button>
      </div>
      <div className="space-y-2 px-3 pb-3">
        <SalonSwitcher current={current} memberships={memberships} compact={collapsed} />
        <OpenCommandPaletteButton compact={collapsed} />
      </div>
      <SidebarNav role={role} unreadNotifications={unreadNotifications} isPlatformAdmin={isPlatformAdmin} collapsed={collapsed} />
      <SidebarFooter plan={plan} compact={collapsed} />
    </aside>
  );
}
