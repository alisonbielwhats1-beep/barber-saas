import { SignupForm } from "./signup-form";
import { EstablishmentShell } from "@/components/marketing/establishment-shell";
import { MARKETING_SEGMENTS, SIGNUP_SEGMENTS } from "@/components/marketing/segments";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ segment?: string }> }) {
  const query = await searchParams;
  const selected = MARKETING_SEGMENTS.find(item => item.id === query.segment);
  return (
    <EstablishmentShell initialSegment={selected?.id}>
      <SignupForm initialSegment={selected ? SIGNUP_SEGMENTS[selected.id] : undefined} />
    </EstablishmentShell>
  );
}
