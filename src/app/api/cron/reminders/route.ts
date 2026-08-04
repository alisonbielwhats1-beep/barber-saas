import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withSalon } from "@/lib/prisma-tenant";
import { isCronAuthorized } from "@/lib/cron-auth";
import { startOfDay, endOfDay, addDays } from "date-fns";

/**
 * GET /api/cron/reminders
 *
 * Chamado pelo Vercel Cron às 08:00 diariamente.
 * Retorna agendamentos de amanhã que ainda não receberam lembrete.
 *
 * Em produção: integrar com Evolution API / Z-API para envio automático.
 * Por ora, o admin usa o painel "Lembretes de amanhã" no dashboard.
 *
 * Protegido por CRON_SECRET — configure na Vercel:
 *   vercel env add CRON_SECRET production
 *
 * Varre todos os salões, mas em loop — um `withSalon` por salão, não uma
 * query cross-tenant. Sob RLS (`01_enable_rls.sql`, já aplicado) a policy de
 * Appointment exige salonId = app_current_salon(); sem essa GUC a leitura
 * volta vazia. A alternativa seria uma conexão à parte com BYPASSRLS, mas
 * isso reintroduziria exatamente o atributo que o resto da migração eliminou
 * — uma credencial assim vazando anula o RLS inteiro. O loop mantém este job
 * na mesma forma de acesso do resto do app; roda 1x/dia, então N round-trips
 * sequenciais não é custo sensível.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  // Fail closed: configuração ausente também bloqueia a rota.
  if (!isCronAuthorized(auth, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const tomorrow = startOfDay(addDays(now, 1));
  const tomorrowEnd = endOfDay(addDays(now, 1));

  type ApptRow = {
    id: string;
    startAt: Date;
    salonName: string;
    salonPhone: string | null;
    clientName: string;
    clientPhone: string | null;
    serviceName: string;
    proName: string;
  };
  const appointments: ApptRow[] = [];
  try {
    // Salon tem leitura pública nas policies (01_enable_rls.sql, seção 2) —
    // listar os ids não precisa de GUC nenhuma.
    const salons = await prisma.salon.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });

    for (const salon of salons) {
      const rows = await withSalon(salon.id, (tx) =>
        tx.$queryRaw<ApptRow[]>`
          SELECT
            a.id,
            a."startAt",
            sl.name      AS "salonName",
            sl.phone     AS "salonPhone",
            c.name       AS "clientName",
            c.phone      AS "clientPhone",
            s.name       AS "serviceName",
            u.name       AS "proName"
          FROM "Appointment" a
          JOIN "Salon"         sl ON sl.id = a."salonId"
          JOIN "ClientProfile" c  ON c.id  = a."clientId"
          JOIN "Service"       s  ON s.id  = a."serviceId"
          JOIN "Professional"  p  ON p.id  = a."professionalId"
          JOIN "User"          u  ON u.id  = p."userId"
          WHERE a."salonId"        = ${salon.id}
            AND a."startAt"        >= ${tomorrow}
            AND a."startAt"        <= ${tomorrowEnd}
            AND a.status           IN ('CONFIRMED', 'PENDING')
            AND a."reminderSentAt"  IS NULL
          ORDER BY a."startAt" ASC
        `,
      );
      appointments.push(...rows);
    }
  } catch {
    return NextResponse.json(
      { error: "Migration 003 not applied yet", appointments: [] },
      { status: 503 },
    );
  }

  return NextResponse.json({
    date: tomorrow.toISOString().slice(0, 10),
    count: appointments.length,
    appointments,
  });
}
