import { headers } from "next/headers";
import { requireRole } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getInitialSetup } from "@/lib/initial-setup-server";
import { getPublicBookingUrl } from "@/lib/public-booking-url";
import { setupReturnHref } from "@/lib/initial-setup";
import { SetupWizard } from "./setup-wizard";

export default async function InitialSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; next?: string }>;
}) {
  const ctx = await requireRole(["OWNER", "MANAGER"]);
  const data = await withTenant(ctx, (tx) => getInitialSetup(tx, ctx));
  const params = await searchParams;
  const step =
    params.step && /^[0-3]$/.test(params.step)
      ? Number(params.step)
      : data.step;
  const host = (await headers()).get("host") ?? "localhost:3000";
  const bookingUrl = getPublicBookingUrl(
    data.salon.slug,
    `${/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https"}://${host}`,
  );
  return (
    <SetupWizard
      data={data}
      initialStep={step}
      bookingUrl={bookingUrl}
      nextHref={setupReturnHref(params.next)}
      canCreateSelf={ctx.role === "OWNER"}
    />
  );
}
