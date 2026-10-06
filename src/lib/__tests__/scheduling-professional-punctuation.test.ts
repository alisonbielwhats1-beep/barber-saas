import { describe, expect, it, vi } from "vitest";
import { listSchedulingProfessionals } from "../scheduling-catalog";
import type { Tx } from "../prisma-tenant";

const actor = { salonId: "salon-a", userId: "owner-a" };
function fixture(names = ["Tatiana A"]) {
  const findMany = vi.fn(async (input: { where: { user?: { name: { contains: string } } } }) =>
    names.filter(name => name.toLowerCase().includes(input.where.user?.name.contains.toLowerCase() ?? ""))
      .map((name, i) => ({ id: `professional-${i}`, user: { name } })));
  const tx = { $queryRaw: vi.fn().mockResolvedValueOnce([{ accessStatus: "APPROVED" }]).mockResolvedValueOnce([{ role: "OWNER" }]), professional: { findMany } };
  return { tx: tx as unknown as Tx, findMany };
}
describe("professional lookup from transcribed sentence punctuation", () => {
  it("resolves the observed Tatiana A. transcript while retaining tenant and service eligibility", async () => {
    const { tx, findMany } = fixture();
    expect(await listSchedulingProfessionals(tx, actor, { service_ref: "massage-a", query: "Tatiana A." })).toEqual([{ id: "professional-0", name: "Tatiana A" }]);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ salonId: actor.salonId, active: true, services: { some: { serviceId: "massage-a", service: { salonId: actor.salonId, active: true } } } });
  });
  it("returns all ambiguous candidates for downstream selection instead of choosing a person", async () => {
    const { tx } = fixture(["Tatiana A", "Tatiana A. Silva"]);
    expect(await listSchedulingProfessionals(tx, actor, { query: "Tatiana A." })).toHaveLength(2);
  });
  it("does not erase internal punctuation or identity-bearing characters", async () => {
    const { tx, findMany } = fixture(["Ana-Maria D'Ávila"]);
    await listSchedulingProfessionals(tx, actor, { query: "Ana-Maria D'Ávila!" });
    expect(findMany.mock.calls[0][0].where.user?.name.contains).toBe("Ana-Maria D'Ávila");
  });
  it("still rejects unauthorized actors before searching", async () => {
    const findMany = vi.fn();
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]), professional: { findMany } } as unknown as Tx;
    await expect(listSchedulingProfessionals(tx, actor, { query: "Tatiana A." })).rejects.toThrow("FORBIDDEN");
    expect(findMany).not.toHaveBeenCalled();
  });
});
