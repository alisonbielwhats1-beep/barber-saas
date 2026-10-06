import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, expect, it, describe, vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { searchSalonCustomer } from "../customer-catalog";
import { listSchedulingProfessionals } from "../scheduling-catalog";
import { salonDirectoryNames } from "../entity-suggestions";
import { directorySubsetProof } from "../name-search";

/** C7 against PostgreSQL (runtime role, RLS): a leading article is not part of a name, an honorific is searched as written
 * and dropped only when nothing matches, and the directory a subset proof reads is the tenant's own. Needs the coordinator
 * (RUN_SERVICE_MVP_INTEGRATION=1, disposable database only). */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });

async function salon(label: string, customers: string[], professionals: string[]) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: `Dona ${label}`, email: `c7-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: `Synthetic C7 ${label}`, slug: `c7-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: "America/Sao_Paulo" } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    for (const name of customers) await tx.clientProfile.create({ data: { salonId, name } });
    for (const [index, name] of professionals.entries()) {
      const user = await tx.user.create({ data: { name, email: `c7-pro-${index}-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
      await tx.professional.create({ data: { salonId, userId: user.id } });
    }
    return { actor: { salonId, userId: owner.id } };
  });
}

suite("C7 names against PostgreSQL (runtime role, RLS)", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => { console.log("C7_NAMES_PREFLIGHT", await assertMvpTestDatabase(admin)); vi.stubGlobal("fetch", network); });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await admin.$disconnect(); await prisma.$disconnect(); });

  it("articles and honorifics: 'a carla' asks among both Carlas; 'dona cida' finds Cida Souza only after nothing matches with 'dona'", async () => {
    const a = await salon("A", ["Carla Mendes", "Ana Carla", "Cida Souza", "Dona Neide"], ["Rodrigo Lima"]), b = await salon("B", ["Cida Lima", "Carla Nunes"], ["Rodrigo Alves"]);
    const names = async (query: string) => (await withTenant(a.actor, tx => searchSalonCustomer(tx, a.actor, query))).map(row => row.name).sort();
    expect(await names("a carla")).toEqual(["Ana Carla", "Carla Mendes"]);
    expect(await names("dona cida")).toEqual(["Cida Souza"]);
    expect(await names("dona neide")).toEqual(["Dona Neide"]);
    expect(await names("dona lima")).toEqual([]); // salon B's Cida Lima never appears
    expect((await withTenant(b.actor, tx => searchSalonCustomer(tx, b.actor, "a carla"))).map(row => row.name)).toEqual(["Carla Nunes"]);
    expect((await withTenant(a.actor, tx => listSchedulingProfessionals(tx, a.actor, { query: "o rodrigo" }))).map(row => row.name)).toEqual(["Rodrigo Lima"]);
  });
  it("the directory a subset proof reads is the tenant's own active professionals", async () => {
    const a = await salon("C", [], ["Rodrigo Lima", "Tatiana Rocha"]), b = await salon("D", [], ["Rodrigo Alves"]);
    const directory = await withTenant(a.actor, tx => salonDirectoryNames(tx, a.actor, "professional"));
    expect([...directory!].sort()).toEqual(["Rodrigo Lima", "Tatiana Rocha"]);
    expect(directorySubsetProof("Rodrigo Lima", "fecha a agenda do rodrigo", directory!)).toBe(true);
    expect(await withTenant(b.actor, tx => salonDirectoryNames(tx, b.actor, "professional"))).toEqual(["Rodrigo Alves"]);
  });
});
