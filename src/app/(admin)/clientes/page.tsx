import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
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
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            CRM
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
        </div>
        <ClientForm />
      </header>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="p-4 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Cliente
                </th>
                <th className="p-4 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Contato
                </th>
                <th className="p-4 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Atend.
                </th>
                <th className="p-4 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Total gasto
                </th>
                <th className="p-4 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const total = c.appointments.reduce((s, a) => s + a.priceCents, 0);
                return (
                  <tr
                    key={c.id}
                    className="border-b border-border/50 transition last:border-0 hover:bg-muted/30"
                  >
                    <td className="p-4 font-medium">{c.name}</td>
                    <td className="p-4 text-muted-foreground">{c.phone ?? c.email ?? "—"}</td>
                    <td className="p-4 text-muted-foreground">{c.appointments.length}</td>
                    <td className="p-4 font-medium">{formatMoney(total)}</td>
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
                  <td colSpan={5} className="p-12 text-center text-[13px] text-muted-foreground">
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
