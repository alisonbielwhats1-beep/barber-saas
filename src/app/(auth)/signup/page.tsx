import { SignupForm } from "./signup-form";
import { supabaseAuthEnabled } from "@/lib/supabase-auth-config";
import { EstablishmentShell } from "@/components/marketing/establishment-shell";
import { MARKETING_SEGMENTS, SIGNUP_SEGMENTS } from "@/components/marketing/segments";
import { MARKETING_PLAN_KEYS, billingIntentForLegacyPlan, resolvePlanIntent } from "@/lib/marketing-plan";
import { resolveBillingIntent } from "@/lib/billing/presentation";
import { billingEnabled, checkoutPaused } from "@/lib/billing/config";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ segment?: string; plan?: string; billingPlan?: string; cycle?: string; extraAgendas?: string }> }) {
  const query = await searchParams;
  const selected = MARKETING_SEGMENTS.find(item => item.id === query.segment);
  const billing = billingEnabled();
  // The retired ?plan= table is shown only while online billing is off.
  const plan = billing ? undefined : resolvePlanIntent(query.plan);
  const billingIntent = resolveBillingIntent(query) ?? (billing ? billingIntentForLegacyPlan(query.plan) : undefined);
  return (
    <EstablishmentShell initialSegment={selected?.id}>
      <SignupForm provider={supabaseAuthEnabled()} initialSegment={selected ? SIGNUP_SEGMENTS[selected.id] : undefined} planIntent={plan ? MARKETING_PLAN_KEYS[plan.plan] : undefined} billingIntent={billingIntent} billingAvailable={billing && !checkoutPaused()} />
    </EstablishmentShell>
  );
}
