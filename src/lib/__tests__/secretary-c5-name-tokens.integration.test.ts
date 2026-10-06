import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { searchSalonCustomer } from "../customer-catalog";
import { listSchedulingProfessionals } from "../scheduling-catalog";

/** C5 (flag SALON_SECRETARY_WHOLE_NAME_MATCH) against PostgreSQL (runtime role, RLS): the whole-token prefilter statements (text[]
 * parameter, NOT EXISTS over unnest, translate + lower, escaped patterns, integer LIMIT) and the tenant scope; with the flag off
 * the historical substring search is unchanged. Needs the coordinator (RUN_SERVICE_MVP_INTEGRATION=1, disposable database only).
 * Synthetic names of an esmalteria and a spa; no gender inferred from a name. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
/** Created in beforeAll (as secretary-name-suggestions.integration.test.ts does), so the file loads and skips without a database URL. */
let admin: PrismaClient;

async function salon(label: string, customers: string[], professionals: string[]) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: `Responsável ${label}`, email: `c5nt-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: `Synthetic C5 names ${label}`, slug: `c5nt-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: "America/Sao_Paulo" } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    for (const name of customers) await tx.clientProfile.create({ data: { salonId, name } });
    for (const [index, name] of professionals.entries()) {
      const user = await tx.user.create({ data: { name, email: `c5nt-pro-${index}-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
      await tx.professional.create({ data: { salonId, userId: user.id } });
    }
    return { actor: { salonId, userId: owner.id } };
  });
}
type Actor = Awaited<ReturnType<typeof salon>>["actor"];
const customerNames = async (actor: Actor, query: string) => (await withTenant(actor, tx => searchSalonCustomer(tx, actor, query))).map(row => row.name).sort();
const professionalNames = async (actor: Actor, query: string) => (await withTenant(actor, tx => listSchedulingProfessionals(tx, actor, { query }))).map(row => row.name).sort();

suite("C5 whole name tokens against PostgreSQL (runtime role, RLS)", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
    console.log("C5_NAME_TOKENS_PREFLIGHT", await assertMvpTestDatabase(admin)); vi.stubGlobal("fetch", network);
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await admin?.$disconnect(); await prisma.$disconnect(); });

  it("flag on: whole tokens only; hyphens, accents and particles fold; homonyms stay several; another salon never appears", async () => {
    vi.stubEnv("SALON_SECRETARY_WHOLE_NAME_MATCH", "true");
    const a = await salon("A", ["Nara Uchoa", "Nara Quispe", "Tainara Bezerra", "Ana Paula Viana", "Mariana Okafor", "Anabela Reis", "Hee-Jin Park",
      "Anne-Sophie Moreau", "Ícaro Mendes", "Iolanda da Cunha"], ["Ana Beatriz Kowalski", "Mariana Duarte", "Luana Ferraz", "Hee-Jin Choi"]);
    const b = await salon("B", ["Nara Tavares"], ["Ana Sato"]);
    expect(await customerNames(a.actor, "Nara")).toEqual(["Nara Quispe", "Nara Uchoa"]);
    expect(await customerNames(a.actor, "Ana")).toEqual(["Ana Paula Viana"]);
    expect(await customerNames(a.actor, "paula ana")).toEqual(["Ana Paula Viana"]);
    expect(await customerNames(a.actor, "hee jin")).toEqual(["Hee-Jin Park"]);
    expect(await customerNames(a.actor, "anne sophie")).toEqual(["Anne-Sophie Moreau"]);
    expect(await customerNames(a.actor, "icaro")).toEqual(["Ícaro Mendes"]);
    expect(await customerNames(a.actor, "ÍCARO MENDES")).toEqual(["Ícaro Mendes"]);
    expect(await customerNames(a.actor, "Iolanda Cunha")).toEqual(["Iolanda da Cunha"]);
    expect(await customerNames(a.actor, "dona nara")).toEqual(["Nara Quispe", "Nara Uchoa"]);
    for (const query of ["Tai", "Mari", "soph", "Na%ra", "de da", "%_"]) expect(await customerNames(a.actor, query)).toEqual([]);
    expect(await customerNames(b.actor, "Nara")).toEqual(["Nara Tavares"]);
    expect(await professionalNames(a.actor, "Ana")).toEqual(["Ana Beatriz Kowalski"]);
    expect(await professionalNames(a.actor, "hee jin")).toEqual(["Hee-Jin Choi"]);
    expect(await professionalNames(a.actor, "Mari")).toEqual([]);
    expect(await professionalNames(b.actor, "Ana")).toEqual(["Ana Sato"]);
  });
  it("flag off: the historical substring search is unchanged (Nara still finds Tainara; the hyphen still misses)", async () => {
    vi.stubEnv("SALON_SECRETARY_WHOLE_NAME_MATCH", "false");
    const a = await salon("C", ["Nara Uchoa", "Tainara Bezerra", "Anne-Sophie Moreau"], ["Ana Beatriz Kowalski", "Mariana Duarte"]);
    expect(await customerNames(a.actor, "Nara")).toEqual(["Nara Uchoa", "Tainara Bezerra"]);
    expect(await customerNames(a.actor, "anne sophie")).toEqual([]);
    expect(await professionalNames(a.actor, "Ana")).toEqual(["Ana Beatriz Kowalski", "Mariana Duarte"]);
  });
});
