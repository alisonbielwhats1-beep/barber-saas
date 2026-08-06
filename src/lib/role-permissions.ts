/**
 * Matriz central de visibilidade e acesso do painel.
 *
 * Estes arrays podem ser importados por Server e Client Components. A guarda
 * real continua sendo `requireRole()`/`assertRole()`; os menus apenas refletem
 * a mesma decisão para não oferecer atalhos que terminarão em acesso negado.
 */
export const MANAGEMENT_ROLES = ["OWNER", "MANAGER"] as const;

export const FINANCIAL_ROLES = ["SUPER_ADMIN", "OWNER", "MANAGER"] as const;

export const DASHBOARD_ROLES = [
  "SUPER_ADMIN",
  "OWNER",
  "MANAGER",
  "RECEPTIONIST",
] as const;

export const MARKETING_ROLES = ["OWNER", "MANAGER", "RECEPTIONIST"] as const;
