"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Contact, KanbanSquare, CalendarCheck, Wallet, LifeBuoy, Layers, Bot, Settings, ShieldCheck, ArrowUpRight } from "lucide-react";
const items = [
 ["dashboard","Dashboard",LayoutDashboard],["crm","CRM",Contact],["leads","Leads",Users],["customers","Clientes",Users],["pipeline","Pipeline",KanbanSquare],["followups","Follow-ups",CalendarCheck],["cmm","CMM · Acompanhamento",Contact],["finance","Financeiro",Wallet],["support","Suporte",LifeBuoy],["product","Produto",Layers],["agents","Agentes",Bot],["settings","Configurações",Settings],
] as const;
export function HqNavigation() {
 const pathname=usePathname();
 return <nav aria-label="Everflare HQ">{items.map(([slug,title,Icon])=><Link key={slug} href={"/hq/"+slug} aria-current={pathname.startsWith("/hq/"+slug)?"page":undefined}><Icon size={18} aria-hidden="true"/>{title}</Link>)}<Link href="/plataforma"><ShieldCheck size={18}/>Gestão da plataforma<ArrowUpRight size={14}/></Link></nav>;
}

