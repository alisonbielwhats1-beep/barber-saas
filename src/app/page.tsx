import { LandingExperience } from "@/components/marketing/landing-experience";
import { billingEnabled } from "@/lib/billing/config";

export default function LandingPage() {
  return <LandingExperience billingAvailable={billingEnabled()} />;
}
