import { LandingExperience } from "@/components/marketing/landing-experience";
import { billingEnabled, checkoutPaused } from "@/lib/billing/config";

export default function LandingPage() {
  return <LandingExperience billingAvailable={billingEnabled() && !checkoutPaused()} />;
}
