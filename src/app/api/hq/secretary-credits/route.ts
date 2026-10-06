import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { withHq } from "@/lib/hq/access";
import { HqError } from "@/lib/hq/validation";
import { creditsEnabled, grantCredits } from "@/lib/secretary-credits";
export const runtime = "nodejs";

const input = z.object({ salonId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), units: z.number().int().min(1).max(10_000_000),
  reason: z.string().trim().min(3).max(200), grantKey: z.string().uuid() }).strict();
/** HQ only (owner decision 06/10/2026): courtesy credit for a salon (units of R$ 0,0001; the presentation salon, partners). Adds to the balance
 * like a purchase; the grant key makes a repeated submit a single grant. */
export async function POST(request: Request) {
  try {
    // A cookie-authenticated write: only from the app's own origin.
    const origin = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null;
    if (!origin || request.headers.get("origin") !== origin) return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403 });
    const actorUserId = await withHq(async (_tx, actor) => actor);
    if (!creditsEnabled()) return NextResponse.json({ code: "CREDITS_DISABLED" }, { status: 503 });
    const body = input.parse(await request.json());
    const row = await grantCredits({ ...body, actorUserId });
    return NextResponse.json({ balance: row.balanceAfter, base: row.baseAfter }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof HqError) return NextResponse.json({ code: "HQ_FORBIDDEN" }, { status: 403 });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
    console.error("SECRETARY_CREDIT_GRANT_FAILED");
    return NextResponse.json({ code: "SECRETARY_CREDIT_GRANT_FAILED" }, { status: 500 });
  }
}
