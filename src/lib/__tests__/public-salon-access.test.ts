import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salon: { findFirst: mocks.findFirst },
    $transaction: mocks.transaction,
  },
}));

import { withSalonBySlug } from "@/lib/prisma-tenant";

describe("acesso público ao estabelecimento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({ $executeRaw: mocks.executeRaw }),
    );
  });

  it("resolve somente estabelecimentos aprovados", async () => {
    mocks.findFirst.mockResolvedValue({ id: "salon-a" });
    const callback = vi.fn(async () => "ok");

    await expect(withSalonBySlug("studio-a", callback)).resolves.toBe("ok");
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { slug: "studio-a", accessStatus: "APPROVED" },
      select: { id: true },
    });
  });

  it("não abre transação quando o salão está pendente ou não existe", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const callback = vi.fn();

    await expect(withSalonBySlug("pendente", callback)).resolves.toBeNull();
    expect(callback).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
