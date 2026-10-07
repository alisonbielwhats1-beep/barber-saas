import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { withHq } from "@/lib/hq/access";
import { HqError } from "@/lib/hq/validation";
import { withSalon } from "@/lib/prisma-tenant";
import { salonSpend } from "@/lib/secretary-spend";
import { spendReport } from "@/lib/secretary-spend-report";
export const runtime = "nodejs";

/** The most salons one report reads (each is one short transaction). */
const REPORT_SALONS = 500;
/** HQ only, read only (owner decision 06/10/2026): this month's Secretária cost per salon (DeepSeek + GPT Transcribe) and the
 * margin it would have at the configured price per request. Owner 07/10/2026 (open to every owner): the salons are every
 * approved salon that used the Secretária this month or has a credit purchase in review, not a manual list. */
export async function GET() {
  try {
    const salons = await withHq(tx => tx.salon.findMany({ where: { accessStatus: "APPROVED" }, select: { id: true }, orderBy: { id: "asc" }, take: REPORT_SALONS }));
    const report = [];
    for (const { id: salonId } of salons) {
      const { spend, inReview } = await withSalon(salonId, async tx => ({ spend: await salonSpend(tx, salonId),
        // In review, or a paid purchase that received a mismatched payment (money held without credit either way).
        inReview: await tx.secretaryCreditPurchase.count({ where: { salonId, OR: [{ state: "REVIEW" }, { lastError: { in: ["PAYMENT_MISMATCH", "DUPLICATE_PAYMENT"] } }] } }) }));
      if (!spend.overflow && spend.month.totalMicroUsd === 0 && spend.month.requests === 0 && inReview === 0) continue;
      report.push(spend.overflow ? { salonId, timezone: spend.timezone, month_start: spend.monthStart, overflow: true, purchases_in_review: inReview }
        : { salonId, timezone: spend.timezone, month_start: spend.monthStart, today: spendReport(spend.today), month: spendReport(spend.month), purchases_in_review: inReview });
    }
    // More approved salons than one report reads: said, never silent.
    return NextResponse.json({ salons: report, truncated: salons.length === REPORT_SALONS }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof HqError) return NextResponse.json({ code: "HQ_FORBIDDEN" }, { status: 403 });
    console.error("SECRETARY_SPEND_REPORT_FAILED");
    return NextResponse.json({ code: "SECRETARY_SPEND_REPORT_FAILED" }, { status: 500 });
  }
}
