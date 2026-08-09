"use client";

import { createContext, useContext, useMemo } from "react";
import {
  genericBusinessExperience,
  getBusinessExperience,
  type BusinessExperience,
} from "@/config/business-experience";

const BusinessExperienceContext = createContext<BusinessExperience>(
  genericBusinessExperience,
);

export function BusinessExperienceProvider({
  segment,
  children,
}: {
  segment: string | null | undefined;
  children: React.ReactNode;
}) {
  const experience = useMemo(() => getBusinessExperience(segment), [segment]);

  return (
    <BusinessExperienceContext.Provider value={experience}>
      {children}
    </BusinessExperienceContext.Provider>
  );
}

export function useBusinessExperience(): BusinessExperience {
  return useContext(BusinessExperienceContext);
}
