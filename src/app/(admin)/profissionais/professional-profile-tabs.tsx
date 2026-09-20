"use client";
import type { ReactNode } from "react";
import { Root, List, Trigger, Content } from "@radix-ui/react-tabs";
export function ProfessionalProfileTabs({ summary, services, agenda }: { summary: ReactNode; services: ReactNode; agenda: ReactNode }) {
  return <Root defaultValue="summary" className="mt-5 min-w-0"><List className="grid grid-cols-3 gap-2" aria-label="Perfil do profissional">{[['summary','Resumo'],['services','Serviços'],['agenda','Agenda']].map(([value,label])=><Trigger key={value} value={value} className="min-h-11 rounded-full border border-border text-sm data-[state=active]:border-transparent data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{label}</Trigger>)}</List><Content value="summary" className="pt-4">{summary}</Content><Content value="services" className="pt-4">{services}</Content><Content value="agenda" className="pt-4">{agenda}</Content></Root>;
}
