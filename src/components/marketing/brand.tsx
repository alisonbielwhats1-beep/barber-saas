import Link from "next/link";
import { BrandLogo } from "@/components/brand";
export function MarketingBrand() {
  return <Link href="/" className="mk-brand" aria-label="Everflair, início"><BrandLogo decorative /></Link>;
}
