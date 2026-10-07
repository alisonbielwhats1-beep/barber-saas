"use client";
import { usePathname } from "next/navigation";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

/** Route-shaped placeholders: the screen keeps its layout while the server answers. */
export default function AdminLoading() {
  const pathname = usePathname();
  const directory = ["/clientes", "/servicos", "/produtos", "/profissionais"].includes(pathname);
  const agenda = pathname === "/agenda";
  const today = pathname === "/hoje";
  return <div role="status" aria-label="Carregando conteúdo" className="space-y-4">
    <span className="sr-only">Carregando conteúdo…</span>
    {!agenda && <Skeleton className="h-8 w-40 rounded-lg" />}
    {directory ? <div aria-hidden="true" className="space-y-2">
      <Skeleton className="h-11 max-w-xl rounded-xl" />
      <div className="divide-y divide-border">{Array.from({ length: 7 }, (_, i) => <SkeletonRow key={i} />)}</div>
    </div>
      : agenda ? <div aria-hidden="true" className="space-y-3">
        <div className="flex items-center justify-between"><Skeleton className="h-6 w-36 rounded-lg" /><Skeleton className="h-10 w-10 rounded-full" /></div>
        <div className="grid grid-cols-7 gap-2">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="mx-auto h-12 w-10 rounded-2xl" />)}</div>
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-[55dvh] rounded-2xl" />
      </div>
      : today ? <div aria-hidden="true" className="space-y-3">
        <Skeleton className="h-12 rounded-2xl" />
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
      </div>
      : <div aria-hidden="true" className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div>}
  </div>;
}
