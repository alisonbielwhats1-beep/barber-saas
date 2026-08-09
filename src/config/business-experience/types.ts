import type { SegmentId } from "@/lib/segments";

export type BusinessExperienceId = SegmentId | "generic";

export type BusinessExperienceIconName =
  | "scissors"
  | "sparkles"
  | "gem"
  | "waves"
  | "layout-grid";

export type DashboardMetricKey = "revenue" | "profit" | "occupancy" | "ticket";

export type ExperienceDirection =
  | "precision"
  | "editorial"
  | "fashion"
  | "wellness"
  | "modular";

export type ExperienceDensity = "compact" | "comfortable" | "airy";

export type ExperienceCatalogLayout =
  | "split"
  | "editorial"
  | "portfolio"
  | "gallery"
  | "modular";

export type BusinessExperience = {
  id: BusinessExperienceId;
  segmentId: SegmentId | null;
  label: string;
  shortLabel: string;
  icon: BusinessExperienceIconName;
  personality: string;
  visual: {
    direction: ExperienceDirection;
    density: ExperienceDensity;
    dashboardLayout: "operations" | "relationship" | "recurrence" | "care" | "overview";
    catalogLayout: ExperienceCatalogLayout;
    publicLayout: "editorial" | "studio" | "portfolio" | "retreat" | "marketplace";
  };
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
