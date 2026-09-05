import Link from "next/link";
import { Aperture } from "lucide-react";
export function MarketingBrand() {
  return <Link href="/" className="mk-brand" aria-label="SalonSaaS, início"><Aperture aria-hidden="true" strokeWidth={1.4} /><span>Salon<span className="mk-brand-suffix">SaaS</span></span></Link>;
}
