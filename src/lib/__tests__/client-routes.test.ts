import { describe, expect, it } from "vitest";
import {
  clientBookingPath,
  clientBookingReturnTo,
  safeClientReturnTo,
} from "../client-routes";

describe("rotas do app do cliente", () => {
  it("preserva serviços e contexto ao enviar o visitante para autenticação", () => {
    expect(clientBookingReturnTo("studio-a", {
      services: "service-a,service-b",
      pro: "pro-a",
      version: "4",
    })).toBe(
      "/book/studio-a/agendar?services=service-a%2Cservice-b&pro=pro-a&version=4",
    );
  });

  it("rejeita retorno para outro salão ou rota desconhecida", () => {
    const fallback = clientBookingPath("studio-a");
    expect(safeClientReturnTo("studio-a", "/book/studio-b/agendar", fallback)).toBe(fallback);
    expect(safeClientReturnTo("studio-a", "/book/studio-a/admin", fallback)).toBe(fallback);
    expect(safeClientReturnTo("studio-a", "https://example.com", fallback)).toBe(fallback);
  });

  it("aceita somente o retorno interno do salão atual", () => {
    expect(safeClientReturnTo(
      "studio-a",
      "/book/studio-a/agendar?services=service-a",
    )).toBe("/book/studio-a/agendar?services=service-a");
  });
});
