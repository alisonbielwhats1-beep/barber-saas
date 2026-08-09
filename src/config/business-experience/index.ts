import { SEGMENTS, isSegmentId, type SegmentId } from "@/lib/segments";
import type { BusinessExperience, BusinessExperienceId } from "./types";

const segmentById = Object.fromEntries(SEGMENTS.map((segment) => [segment.id, segment])) as Record<
  SegmentId,
  (typeof SEGMENTS)[number]
>;

const experiences: Record<SegmentId, BusinessExperience> = {
  barbearia: {
    id: "barbearia",
    segmentId: "barbearia",
    label: "Barbearia",
    shortLabel: "Barbearia",
    icon: "scissors",
    personality: "Precisão, presença e ritmo para uma agenda sempre em movimento.",
    visual: {
      direction: "precision",
      density: "compact",
      dashboardLayout: "operations",
      catalogLayout: "split",
      publicLayout: "editorial",
    },
    terminology: {
      establishment: "barbearia",
      professional: "barbeiro",
      professionals: "barbeiros",
      service: "serviço",
      services: "serviços",
      client: "cliente",
      clients: "clientes",
    },
    navigation: { professionals: "Barbeiros", services: "Serviços" },
    dashboard: {
      eyebrow: "Operação da barbearia",
      title: "Sua barbearia em movimento",
      description: "Acompanhe a agenda, a ocupação dos barbeiros e o resultado de cada atendimento.",
      todayTitle: "Próximos clientes de hoje",
      setupTitle: "Deixe sua barbearia pronta para agendar",
      metricOrder: ["occupancy", "revenue", "ticket", "profit"],
    },
    pages: {
      professionalsDescription: "Organize sua equipe, especialidades e horários de cada barbeiro.",
      servicesDescription: "Apresente cortes, barba e combinações com preço e duração claros.",
      clientsDescription: "Acompanhe frequência, preferências e o retorno dos seus clientes.",
      agendaDescription: "Visualize o ritmo do dia por horário, cliente e barbeiro.",
    },
    booking: {
      serviceTitle: "Escolha os serviços",
      professionalTitle: "Escolha seu barbeiro",
      publicEyebrow: "Experiência de barbearia",
      publicDescription: "Escolha o serviço, seu barbeiro e o melhor horário.",
    },
    emptyStates: {
      professionals: "Você ainda não cadastrou nenhum barbeiro.",
      services: "Cadastre o primeiro serviço da sua barbearia.",
    },
    imagery: {
      accentImage: segmentById.barbearia.accentImage,
      heroImages: segmentById.barbearia.heroImages,
      objectPosition: "50% 45%",
    },
  },
  "salao-beleza": {
    id: "salao-beleza",
    segmentId: "salao-beleza",
    label: "Salão",
    shortLabel: "Salão",
    icon: "sparkles",
    personality: "Elegância leve para uma operação cuidadosa e bem coordenada.",
    visual: {
      direction: "editorial",
      density: "comfortable",
      dashboardLayout: "relationship",
      catalogLayout: "editorial",
      publicLayout: "studio",
    },
    terminology: {
      establishment: "salão",
      professional: "profissional",
      professionals: "profissionais",
      service: "serviço",
      services: "serviços",
      client: "cliente",
      clients: "clientes",
    },
    navigation: { professionals: "Profissionais", services: "Serviços" },
    dashboard: {
      eyebrow: "Gestão do salão",
      title: "Uma visão elegante da sua operação",
      description: "Agenda, equipe e relacionamento com clientes reunidos para você decidir com clareza.",
      todayTitle: "Próximos atendimentos de hoje",
      setupTitle: "Prepare seu salão para receber agendamentos",
      metricOrder: ["revenue", "ticket", "occupancy", "profit"],
    },
    pages: {
      professionalsDescription: "Mantenha equipe, especialidades e disponibilidade sempre organizadas.",
      servicesDescription: "Organize seu catálogo por categoria, duração, valor e profissionais.",
      clientsDescription: "Transforme histórico e recorrência em uma experiência mais pessoal.",
      agendaDescription: "Enxergue cada atendimento com leveza, contexto e organização.",
    },
    booking: {
      serviceTitle: "Escolha os serviços",
      professionalTitle: "Escolha um profissional",
      publicEyebrow: "Cuidado em cada detalhe",
      publicDescription: "Encontre o serviço, o profissional e o horário ideal para você.",
    },
    emptyStates: {
      professionals: "Você ainda não cadastrou nenhum profissional.",
      services: "Cadastre o primeiro serviço do seu salão.",
    },
    imagery: {
      accentImage: segmentById["salao-beleza"].accentImage,
      heroImages: segmentById["salao-beleza"].heroImages,
      objectPosition: "50% 42%",
    },
  },
  "manicure-nail": {
    id: "manicure-nail",
    segmentId: "manicure-nail",
    label: "Manicure",
    shortLabel: "Manicure",
    icon: "gem",
    personality: "Detalhe, resultado e recorrência em uma experiência altamente visual.",
    visual: {
      direction: "fashion",
      density: "comfortable",
      dashboardLayout: "recurrence",
      catalogLayout: "portfolio",
      publicLayout: "portfolio",
    },
    terminology: {
      establishment: "espaço de manicure",
      professional: "profissional",
      professionals: "profissionais",
      service: "procedimento",
      services: "procedimentos",
      client: "cliente",
      clients: "clientes",
    },
    navigation: { professionals: "Profissionais", services: "Procedimentos" },
    dashboard: {
      eyebrow: "Rotina do espaço",
      title: "Detalhes que fazem clientes voltar",
      description: "Acompanhe próximos horários, serviços procurados e a recorrência da sua agenda.",
      todayTitle: "Próximos horários de hoje",
      setupTitle: "Prepare seu espaço para os primeiros agendamentos",
      metricOrder: ["ticket", "occupancy", "revenue", "profit"],
    },
    pages: {
      professionalsDescription: "Organize profissionais, técnicas e horários com uma leitura visual clara.",
      servicesDescription: "Valorize cada procedimento com duração, preço e categoria bem apresentados.",
      clientsDescription: "Acompanhe recorrência e preferências para facilitar as próximas manutenções.",
      agendaDescription: "Veja os horários do dia e mantenha o ritmo entre procedimentos e manutenções.",
    },
    booking: {
      serviceTitle: "Escolha os procedimentos",
      professionalTitle: "Escolha um profissional",
      publicEyebrow: "Seu momento de cuidado",
      publicDescription: "Escolha o procedimento, o profissional e o horário que combina com você.",
    },
    emptyStates: {
      professionals: "Você ainda não cadastrou nenhum profissional.",
      services: "Cadastre o primeiro procedimento do seu espaço.",
    },
    imagery: {
      accentImage: segmentById["manicure-nail"].accentImage,
      heroImages: segmentById["manicure-nail"].heroImages,
      objectPosition: "50% 52%",
    },
  },
  "estetica-bemestar": {
    id: "estetica-bemestar",
    segmentId: "estetica-bemestar",
    label: "Estética",
    shortLabel: "Estética",
    icon: "waves",
    personality: "Clareza, confiança e bem-estar com espaço para o que importa.",
    visual: {
      direction: "wellness",
      density: "airy",
      dashboardLayout: "care",
      catalogLayout: "gallery",
      publicLayout: "retreat",
    },
    terminology: {
      establishment: "espaço de estética",
      professional: "especialista",
      professionals: "especialistas",
      service: "procedimento",
      services: "procedimentos",
      client: "cliente",
      clients: "clientes",
    },
    navigation: { professionals: "Especialistas", services: "Procedimentos" },
    dashboard: {
      eyebrow: "Cuidado e bem-estar",
      title: "Uma operação serena e organizada",
      description: "Acompanhe agenda, resultados e relacionamento com clientes sem excesso de informação.",
      todayTitle: "Próximas sessões de hoje",
      setupTitle: "Prepare seu espaço para receber clientes",
      metricOrder: ["revenue", "occupancy", "profit", "ticket"],
    },
    pages: {
      professionalsDescription: "Apresente especialistas, áreas de atuação e disponibilidade com confiança.",
      servicesDescription: "Organize procedimentos e sessões com informação objetiva e acolhedora.",
      clientsDescription: "Tenha uma visão cuidadosa do histórico e da frequência de cada cliente.",
      agendaDescription: "Organize sessões e intervalos com uma leitura calma e precisa do dia.",
    },
    booking: {
      serviceTitle: "Escolha os procedimentos",
      professionalTitle: "Escolha um especialista",
      publicEyebrow: "Cuidado com confiança",
      publicDescription: "Escolha o procedimento, o especialista e o melhor horário para seu cuidado.",
    },
    emptyStates: {
      professionals: "Você ainda não cadastrou nenhum especialista.",
      services: "Cadastre o primeiro procedimento do seu espaço.",
    },
    imagery: {
      accentImage: segmentById["estetica-bemestar"].accentImage,
      heroImages: segmentById["estetica-bemestar"].heroImages,
      objectPosition: "50% 48%",
    },
  },
  "espaco-misto": {
    id: "espaco-misto",
    segmentId: "espaco-misto",
    label: "Misto",
    shortLabel: "Misto",
    icon: "layout-grid",
    personality: "Uma visão versátil para várias especialidades no mesmo espaço.",
    visual: {
      direction: "modular",
      density: "comfortable",
      dashboardLayout: "overview",
      catalogLayout: "modular",
      publicLayout: "marketplace",
    },
    terminology: {
      establishment: "espaço",
      professional: "profissional",
      professionals: "profissionais",
      service: "serviço",
      services: "serviços",
      client: "cliente",
      clients: "clientes",
    },
    navigation: { professionals: "Profissionais", services: "Serviços" },
    dashboard: {
      eyebrow: "Operação multiespecialidade",
      title: "Todas as áreas, uma visão organizada",
      description: "Conecte agenda, profissionais e serviços diferentes sem perder clareza na operação.",
      todayTitle: "Próximos atendimentos de hoje",
      setupTitle: "Prepare seu espaço para todas as especialidades",
      metricOrder: ["revenue", "occupancy", "ticket", "profit"],
    },
    pages: {
      professionalsDescription: "Organize profissionais e especialidades diferentes em uma única equipe.",
      servicesDescription: "Apresente várias categorias em um catálogo claro e fácil de explorar.",
      clientsDescription: "Centralize o histórico dos clientes em todas as áreas do seu espaço.",
      agendaDescription: "Enxergue profissionais e especialidades diferentes em uma agenda coerente.",
    },
    booking: {
      serviceTitle: "Escolha os serviços",
      professionalTitle: "Escolha um profissional",
      publicEyebrow: "Tudo em um só espaço",
      publicDescription: "Explore os serviços, escolha um profissional e encontre o melhor horário.",
    },
    emptyStates: {
      professionals: "Você ainda não cadastrou nenhum profissional.",
      services: "Cadastre o primeiro serviço do seu espaço.",
    },
    imagery: {
      accentImage: segmentById["espaco-misto"].accentImage,
      heroImages: segmentById["espaco-misto"].heroImages,
      objectPosition: "50% 46%",
    },
  },
};

export const genericBusinessExperience: BusinessExperience = {
  ...experiences["espaco-misto"],
  id: "generic",
  segmentId: null,
  label: "Estabelecimento",
  shortLabel: "Estabelecimento",
  personality: "Uma experiência organizada para sua operação.",
  dashboard: {
    ...experiences["espaco-misto"].dashboard,
    eyebrow: "Visão do estabelecimento",
    title: "Sua operação em um só lugar",
    description: "Acompanhe agenda, equipe, serviços e resultados com clareza.",
    setupTitle: "Deixe seu estabelecimento pronto para agendar",
  },
  booking: {
    ...experiences["espaco-misto"].booking,
    publicEyebrow: "Agendamento online",
  },
};

export function getBusinessExperience(
  value: string | null | undefined,
): BusinessExperience {
  return isSegmentId(value) ? experiences[value] : genericBusinessExperience;
}

export function getBusinessExperienceById(
  id: BusinessExperienceId,
): BusinessExperience {
  return id === "generic" ? genericBusinessExperience : experiences[id];
}

export type {
  BusinessExperience,
  BusinessExperienceIconName,
  BusinessExperienceId,
  DashboardMetricKey,
  ExperienceCatalogLayout,
  ExperienceDensity,
  ExperienceDirection,
} from "./types";
