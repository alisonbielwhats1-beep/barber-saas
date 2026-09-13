import { redirect } from "next/navigation";
import { requireRole, FINANCE_ROLES } from "@/lib/tenant";

export default async function LegacyFinancePage() {
  await requireRole(FINANCE_ROLES);
  redirect("/financeiro");
}
