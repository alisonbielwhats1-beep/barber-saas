export type DiscoverableService = {
  name: string;
  description?: string | null;
  category: string | null;
};

export function normalizeServiceSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function serviceCategoryLabel(service: Pick<DiscoverableService, "category">): string {
  return service.category?.trim() || "Outros";
}

export function getServiceCategories<T extends DiscoverableService>(services: T[]): string[] {
  return [...new Set(services.map(serviceCategoryLabel))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}

export function filterServiceOptions<T extends DiscoverableService>(
  services: T[],
  query: string,
  category: string | null,
): T[] {
  const normalizedQuery = normalizeServiceSearch(query);

  return services.filter((service) => {
    if (category && serviceCategoryLabel(service) !== category) return false;
    if (!normalizedQuery) return true;

    return normalizeServiceSearch(
      [service.name, service.description, serviceCategoryLabel(service)]
        .filter(Boolean)
        .join(" "),
    ).includes(normalizedQuery);
  });
}
