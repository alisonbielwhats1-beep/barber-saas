import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (secret && auth !== `Bearer ${secret}`) {
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
  let appointments: ApptRow[] = [];
  try {
    appointments = await prisma.$queryRaw<ApptRow[]>`
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
      WHERE a."startAt"        >= ${tomorrow}
        AND a."startAt"        <= ${tomorrowEnd}
        AND a.status           IN ('CONFIRMED', 'PENDING')
        AND a."reminderSentAt"  IS NULL
      ORDER BY a."salonId" ASC, a."startAt" ASC
    `;
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
