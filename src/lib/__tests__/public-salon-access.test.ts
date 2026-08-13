import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salon: { findFirst: mocks.findFirst },
    $transaction: mocks.transaction,
  },
}));

import { withApprovedSalon, withSalonBySlug } from "@/lib/prisma-tenant";

describe("acesso público ao estabelecimento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        $queryRaw: mocks.queryRaw,
        $executeRaw: mocks.executeRaw,
      }),
    );
  });

  it("resolve somente estabelecimentos aprovados", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "salon-a" }])
      .mockResolvedValueOnce([{ id: "salon-a" }]);
    const callback = vi.fn(async () => "ok");

    await expect(withSalonBySlug("studio-a", callback)).resolves.toBe("ok");
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    const resolveQuery = mocks.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray;
    const lockQuery = mocks.queryRaw.mock.calls[1]?.[0] as TemplateStringsArray;
    expect(resolveQuery.join(" ")).not.toContain("FOR SHARE");
    expect(lockQuery.join(" ")).toContain("FOR SHARE");
    expect(mocks.queryRaw.mock.calls[0]?.[1]).toBe("studio-a");
    expect(mocks.queryRaw.mock.calls[1]?.[1]).toBe("salon-a");
    expect(mocks.queryRaw.mock.calls[1]?.[2]).toBe("studio-a");
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queryRaw.mock.invocationCallOrder[1],
    );
    expect(callback).toHaveBeenCalledOnce();
  });

  it("não seta GUC nem chama callback quando o slug não está aprovado", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const callback = vi.fn();

    await expect(withSalonBySlug("pendente", callback)).resolves.toBeNull();
    expect(callback).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("revalida a aprovação depois de setar a GUC e antes do callback", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "salon-a" }])
      .mockResolvedValueOnce([]);
    const callback = vi.fn();

    await expect(withSalonBySlug("studio-a", callback)).resolves.toBeNull();

    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
  });

  it("revalida o slug no lock final para fechar rotação concorrente", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "salon-a" }])
      .mockResolvedValueOnce([]);
    const callback = vi.fn();

    await expect(withSalonBySlug("slug-antigo", callback)).resolves.toBeNull();

    expect(mocks.queryRaw.mock.calls[1]?.[1]).toBe("salon-a");
    expect(mocks.queryRaw.mock.calls[1]?.[2]).toBe("slug-antigo");
    expect(callback).not.toHaveBeenCalled();
  });

  it("valida a aprovação e seta o tenant na mesma transação", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: "salon-a" }]);
    const callback = vi.fn(async () => "ok");

    await expect(withApprovedSalon("salon-a", callback)).resolves.toBe("ok");

    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    const queryParts = mocks.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray;
    expect(queryParts.join(" ")).toContain("FOR SHARE");
    expect(mocks.queryRaw.mock.calls[0]?.[1]).toBe("salon-a");
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queryRaw.mock.invocationCallOrder[0],
    );
    expect(callback).toHaveBeenCalledOnce();
  });

  it.each(["PENDING", "REJECTED", "SUSPENDED"])(
    "não chama o callback para estabelecimento %s",
    async () => {
      mocks.queryRaw.mockResolvedValue([]);
      const callback = vi.fn();

      await expect(withApprovedSalon("salon-a", callback)).resolves.toBeNull();

      expect(callback).not.toHaveBeenCalled();
      expect(mocks.executeRaw).toHaveBeenCalledOnce();
    },
  );
});
