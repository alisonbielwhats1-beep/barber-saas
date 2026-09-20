"use client";
import { usePathname } from "next/navigation";

export default function AdminLoading() {
  const pathname = usePathname();
  const directory = ["/clientes", "/servicos", "/produtos", "/profissionais"].includes(pathname);
  const agenda = pathname === "/agenda";
  return <div role="status" aria-label="Carregando conteúdo" className="space-y-4">
    <span className="sr-only">Carregando conteúdo…</span>
    <div aria-hidden="true" className="h-7 w-40 animate-shimmer rounded" />
    {directory ? <div aria-hidden="true" className="space-y-3"><div className="h-11 max-w-xl animate-shimmer rounded" />{Array.from({length: 5}, (_, i) => <div key={i} className="h-16 animate-shimmer rounded" />)}</div>
      : agenda ? <div aria-hidden="true" className="space-y-3"><div className="h-20 animate-shimmer rounded" /><div className="h-[60dvh] animate-shimmer rounded" /></div>
      : <div aria-hidden="true" className="grid gap-4 md:grid-cols-2"><div className="h-48 animate-shimmer rounded" /><div className="h-48 animate-shimmer rounded" /></div>}
  </div>;
}
