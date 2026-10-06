import { afterEach, describe, expect, it, vi } from "vitest";
import { componentRoleRelation } from "../scheduling-temporal-source";

/** Owner 05/10 (flag SALON_SECRETARY_SERVICE_SWAP_V2): "do dia 17 para pedicure" is a service swap on the 17th, never a move from the
 * 17th to "pedicure". A real move keeps its origin→destination relation ("para o dia 20 às 11h", "pra terça às 14h", "pras 15h"). */
afterEach(() => vi.unstubAllEnvs());
const relation = (message: string) => componentRoleRelation(message, "appointment.change");

describe("origin→destination relation of a reschedule", () => {
  it("is not read from a service named after 'para'", () => {
    vi.stubEnv("SALON_SECRETARY_SERVICE_SWAP_V2", "true");
    expect(relation("Troque o serviço da Isabela do dia 17 para pedicure.")).toBeUndefined();
    expect(relation("Muda o serviço da Isabela do dia 17 para manicure e pedicure")).toBeUndefined();
  });

  it.each([
    "Remarca a Isabela do dia 17 para o dia 20 às 11h",
    "Passa a Isabela do dia 17 pra terça às 14h",
    "Muda a Isabela das 10 pras 15h",
    "Passa a Isabela de amanhã para depois de amanhã",
    "Passa a Isabela do dia 17 para a semana que vem",
    "Muda a Isabela do dia 17 para o mesmo horário de sexta",
  ])("is kept for a real move: %s", message => {
    vi.stubEnv("SALON_SECRETARY_SERVICE_SWAP_V2", "true");
    expect(relation(message)).toBeDefined();
  });

  it("flag off: the old relation (the owner's report) is unchanged", () => {
    vi.stubEnv("SALON_SECRETARY_SERVICE_SWAP_V2", "false");
    expect(relation("Troque o serviço da Isabela do dia 17 para pedicure.")).toBeDefined();
  });
});
