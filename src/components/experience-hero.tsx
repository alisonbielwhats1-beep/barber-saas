import Image from "next/image";
import type { BusinessExperience } from "@/config/business-experience";
import { BusinessExperienceIcon } from "@/components/business-experience-icon";

export function ExperienceHero({
  experience,
  eyebrow,
  title,
  description,
  children,
}: {
  experience: BusinessExperience;
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="dashboard-experience-hero experience-surface-raised relative isolate min-h-56 overflow-hidden p-5 sm:p-7 lg:min-h-64 lg:p-9">
      <div className="absolute inset-y-0 right-0 hidden w-[46%] sm:block">
        <Image
          src={experience.imagery.accentImage}
          alt=""
          fill
          sizes="(max-width: 1023px) 42vw, 560px"
          className="object-cover opacity-85"
          style={{ objectPosition: experience.imagery.objectPosition }}
        />
        <span className="absolute inset-0 bg-gradient-to-r from-elevated via-elevated/60 to-transparent" />
        <span className="absolute inset-0 bg-gradient-to-t from-elevated/70 via-transparent to-elevated/15" />
      </div>

      <div className="relative z-10 max-w-2xl">
        <span className="experience-icon-surface mb-6 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.17em] backdrop-blur-md">
          <BusinessExperienceIcon name={experience.icon} className="h-3.5 w-3.5" />
          {eyebrow}
        </span>
        <h1 className="max-w-xl font-display text-[34px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-[44px]">
          {title}
        </h1>
        <p className="mt-4 max-w-xl text-[13px] leading-6 text-muted-foreground sm:text-[15px] sm:leading-7">
          {description}
        </p>
        {children && <div className="mt-6 flex flex-wrap gap-2">{children}</div>}
      </div>
    </section>
  );
}
