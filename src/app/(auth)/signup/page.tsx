import { SignupForm } from "./signup-form";
import { EstablishmentShell } from "@/components/marketing/establishment-shell";
import { MARKETING_SEGMENTS, SIGNUP_SEGMENTS } from "@/components/marketing/segments";
import { MARKETING_PLAN_KEYS, resolvePlanIntent } from "@/lib/marketing-plan";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ segment?: string; plan?: string }> }) {
  const query = await searchParams;
  const selected = MARKETING_SEGMENTS.find(item => item.id === query.segment);
  const plan = resolvePlanIntent(query.plan);
  return (
    <EstablishmentShell initialSegment={selected?.id}>
      <SignupForm initialSegment={selected ? SIGNUP_SEGMENTS[selected.id] : undefined} planIntent={plan ? MARKETING_PLAN_KEYS[plan.plan] : undefined} />
    </EstablishmentShell>
  );
}
