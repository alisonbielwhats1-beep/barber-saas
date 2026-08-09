import type { SegmentId } from "@/lib/segments";

export type BusinessExperienceId = SegmentId | "generic";

export type BusinessExperienceIconName =
  | "scissors"
  | "sparkles"
  | "gem"
  | "waves"
  | "layout-grid";

export type DashboardMetricKey = "revenue" | "profit" | "occupancy" | "ticket";

export type BusinessExperience = {
  id: BusinessExperienceId;
  segmentId: SegmentId | null;
  label: string;
  shortLabel: string;
  icon: BusinessExperienceIconName;
  personality: string;
  terminology: {
    establishment: string;
    professional: string;
    professionals: string;
    service: string;
    services: string;
    client: string;
    clients: string;
  };
  navigation: {
    professionals: string;
    services: string;
  };
  dashboard: {
    eyebrow: string;
    title: string;
    description: string;
    todayTitle: string;
    setupTitle: string;
    metricOrder: readonly DashboardMetricKey[];
  };
  pages: {
    professionalsDescription: string;
    servicesDescription: string;
    clientsDescription: string;
    agendaDescription: string;
  };
  booking: {
    serviceTitle: string;
    professionalTitle: string;
    publicEyebrow: string;
    publicDescription: string;
  };
  emptyStates: {
    professionals: string;
    services: string;
  };
  imagery: {
    accentImage: string;
    heroImages: readonly string[];
    objectPosition: string;
  };
};
