import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { withHq } from "@/lib/hq/access";
import { HqError } from "@/lib/hq/validation";
import { withSalon } from "@/lib/prisma-tenant";
import { pilotActors } from "@/lib/secretary-production-pilot";
import { salonSpend } from "@/lib/secretary-spend";
import { spendReport } from "@/lib/secretary-spend-report";
export const runtime = "nodejs";

/** HQ only, read only (owner decision 06/10/2026): this month's Secretária cost per pilot salon (DeepSeek + GPT Transcribe) and
 * the margin it would have at the configured price per request. Used to calibrate the prepaid price before anything is sold. */
export async function GET() {
  try {
    await withHq(async () => undefined);
    const salons = [...new Set((pilotActors() ?? []).map(pair => pair.salonId))];
    const report = [];
    for (const salonId of salons) {
      const spend = await withSalon(salonId, tx => salonSpend(tx, salonId));
      report.push(spend.overflow ? { salonId, timezone: spend.timezone, month_start: spend.monthStart, overflow: true }
        : { salonId, timezone: spend.timezone, month_start: spend.monthStart, today: spendReport(spend.today), month: spendReport(spend.month) });
    }
    return NextResponse.json({ salons: report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof HqError) return NextResponse.json({ code: "HQ_FORBIDDEN" }, { status: 403 });
    console.error("SECRETARY_SPEND_REPORT_FAILED");
    return NextResponse.json({ code: "SECRETARY_SPEND_REPORT_FAILED" }, { status: 500 });
  }
}
