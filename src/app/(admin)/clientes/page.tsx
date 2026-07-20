import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { ClientForm } from "./client-form";

export default async function ClientesPage() {
  const { salonId } = await getTenantContext();
  const clients = await prisma.clientProfile.findMany({
    where: { salonId },
    include: {
      appointments: {
        where: { status: "COMPLETED" },
        select: { priceCents: true },
      },
    },
    orderBy: { name: "asc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Histórico e informações de contato
          </p>
        </div>
        <ClientForm />
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por nome ou telefone…" className="pl-9" />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-4">Cliente</th>
                <th className="p-4">Contato</th>
                <th className="p-4">Atendimentos</th>
                <th className="p-4">Total gasto</th>
                <th className="p-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {clients.map((c) => {
                const total = c.appointments.reduce((s, a) => s + a.priceCents, 0);
                return (
                  <tr key={c.id} className="transition hover:bg-muted/30">
                    <td className="p-4 font-medium">{c.name}</td>
                    <td className="p-4 text-muted-foreground">
                      {c.phone ?? c.email ?? "—"}
                    </td>
                    <td className="p-4">{c.appointments.length}</td>
                    <td className="p-4">{formatMoney(total)}</td>
                    <td className="p-4 text-right">
                      <ClientForm
                        client={{
                          id: c.id,
                          name: c.name,
                          phone: c.phone,
                          email: c.email,
                          birthday: c.birthday,
                          notes: c.notes,
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-muted-foreground">
                    Sem clientes ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
