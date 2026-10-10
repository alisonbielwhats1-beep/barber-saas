"use client";
import type { ReactNode } from "react";
import { Root, List, Trigger, Content } from "@radix-ui/react-tabs";
export function ProfessionalProfileTabs({ summary, services, agenda }: { summary: ReactNode; services: ReactNode; agenda: ReactNode }) {
  return <Root defaultValue="summary" className="mt-5 min-w-0">
    <List className="grid grid-cols-3 gap-[3px] rounded-[11px] border border-border-strong bg-card p-[3px]" aria-label="Perfil do profissional">
      {[["summary", "Resumo"], ["services", "Serviços"], ["agenda", "Agenda"]].map(([value, label]) => <Trigger key={value} value={value} className="min-h-11 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:bg-[hsl(var(--border))] data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-border-strong lg:min-h-[34px]">{label}</Trigger>)}
    </List>
    <Content value="summary" className="pt-4">{summary}</Content>
    <Content value="services" className="pt-4">{services}</Content>
    <Content value="agenda" className="pt-4">{agenda}</Content>
  </Root>;
}
