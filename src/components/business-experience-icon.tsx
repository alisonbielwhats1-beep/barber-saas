import {
  Gem,
  LayoutGrid,
  Scissors,
  Sparkles,
  Waves,
  type LucideIcon,
} from "lucide-react";
import type { BusinessExperienceIconName } from "@/config/business-experience";
import { cn } from "@/lib/utils";

const icons: Record<BusinessExperienceIconName, LucideIcon> = {
  scissors: Scissors,
  sparkles: Sparkles,
  gem: Gem,
  waves: Waves,
  "layout-grid": LayoutGrid,
};

export function BusinessExperienceIcon({
  name,
  className,
}: {
  name: BusinessExperienceIconName;
  className?: string;
}) {
  const Icon = icons[name];
  return <Icon aria-hidden="true" className={cn("h-4 w-4", className)} />;
}
