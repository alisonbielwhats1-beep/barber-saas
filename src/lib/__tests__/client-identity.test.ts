import { describe, expect, it, vi } from "vitest";
import {
  clientIdentityKeys,
  findPotentialClientMatches,
  maskPhone,
  matchReasons,
  normalizeClientIdentity,
  resolveClientProfileId,
} from "../client-identity";
import { resolveClientSessionInTenant } from "../public-appointment";

describe("identidade de cliente", () => {
  it("normaliza telefone brasileiro com máscara, DDI e e-mail", () => {
    expect(normalizeClientIdentity({
      phone: "+55 (11) 99999-8888",
      email: "  Alison@Example.COM ",
    })).toEqual({
      phone: "11999998888",
      phoneNormalized: "11999998888",
      email: "alison@example.com",
    });
  });

  it("não inventa identidade telefônica para um telefone inválido", () => {
    expect(normalizeClientIdentity({ phone: "(20) 99999-8888" })).toEqual({
      phone: "(20) 99999-8888",
      phoneNormalized: null,
      email: null,
    });
    expect(maskPhone("(20) 99999-8888")).toBeNull();
  });

  it("compara apenas e-mail ou telefone, nunca nome parecido", () => {
    expect(clientIdentityKeys({ phone: "11999998888", email: "A@EXAMPLE.COM" }))
      .toEqual(["email:a@example.com", "phone:11999998888"]);
    expect(matchReasons(
      { phone: "11999998888" },
      { phone: "(11) 99999-8888" },
    )).toEqual(["phone"]);
    expect(matchReasons(
      { email: "a@example.com" },
      { email: "other@example.com" },
    )).toEqual([]);
  });

  it("não mistura candidatos de outro salão e mantém a busca como revisão", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await expect(findPotentialClientMatches(
      { clientProfile: { findMany } } as never,
      "salon-a",
      { phone: "11999998888" },
    )).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        salonId: "salon-a",
        mergedIntoId: null,
        OR: expect.arrayContaining([
          { phoneNormalized: "11999998888" },
        ]),
      }),
    }));
  });

  it("segue a origem até o cadastro canônico depois da mesclagem", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "guest", mergedIntoId: "account" })
      .mockResolvedValueOnce({ id: "account", mergedIntoId: null });

    await expect(resolveClientProfileId(
      { clientProfile: { findFirst } } as never,
      "salon-a",
      "guest",
    )).resolves.toBe("account");
    expect(findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "guest", salonId: "salon-a" },
    }));
  });

  it("interrompe uma cadeia de mesclagem corrompida em vez de iterar indefinidamente", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "same", mergedIntoId: "next" });

    await expect(resolveClientProfileId(
      { clientProfile: { findFirst } } as never,
      "salon-a",
      "same",
    )).rejects.toThrow("limite de segurança");
    expect(findFirst).toHaveBeenCalledTimes(8);
  });

  it("atualiza o nome e o id da sessão para o alvo da mesclagem", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "guest", mergedIntoId: "account", name: "Visitante", email: null })
      .mockResolvedValueOnce({ id: "account", mergedIntoId: null, name: "Maria Silva", email: "maria@example.com" });

    await expect(resolveClientSessionInTenant(
      { clientProfile: { findFirst } } as never,
      {
        clientId: "guest",
        salonId: "salon-a",
        name: "Visitante",
        email: "visitante@example.com",
      },
      "salon-a",
    )).resolves.toEqual({
      clientId: "account",
      salonId: "salon-a",
      name: "Maria Silva",
      email: "maria@example.com",
    });
  });
});
