import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { searchSalonCustomer } from "../customer-catalog";
import { listSchedulingProfessionals, listSchedulingServices } from "../scheduling-catalog";
import { FOLD_FROM, FOLD_TO, foldName, foldedLikePattern } from "../name-search";
import { assertSeparateServiceMention } from "../scheduling-entity-mentions";
import { sameAcceptedQuery } from "../secretary-entity-context";

const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });

describe("name folding (offline)", () => {
  it("ignores case and accents only", () => {
    expect(foldName("João Pereira")).toBe("joao pereira");
    expect(foldName("COLORAÇÃO")).toBe("coloracao");
    expect(foldName("Fábio")).toBe(foldName("fabio"));
    expect(foldName("Rosa")).not.toBe(foldName("Rose"));
  });
  it("a service typed without accents still proves the accented catalog name", () => {
    expect(() => assertSeparateServiceMention("marca a amanda amanhã para coloracao", "Coloração", ["Amanda Souza"])).not.toThrow();
    expect(() => assertSeparateServiceMention("marca a amanda amanhã", "Coloração", ["Amanda Souza"])).toThrow("ENTITY_MENTION_CONFLICT");
  });
  it("repeating an accepted name with other accents is the same query", () => {
    expect(sameAcceptedQuery("joao", "João")).toBe(true);
    expect(sameAcceptedQuery("Joana", "João")).toBe(false);
  });
});

async function salon(label: string) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: "Tatiana Rocha", email: `fold-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    const other = await tx.user.create({ data: { name: "Fábio Lima", email: `fold-other-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: `Synthetic folding ${label}`, slug: `fold-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: "America/Sao_Paulo" } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    for (const name of ["João Pereira", "Joana Dias", "Ana 50% Silva"]) await tx.clientProfile.create({ data: { salonId, name } });
    const coloracao = await tx.service.create({ data: { salonId, name: "Coloração", priceCents: 20000, durationMin: 120 } });
    await tx.service.create({ data: { salonId, name: "Corte", priceCents: 8000, durationMin: 60 } });
    for (const user of [owner, other]) {
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      await tx.professionalService.create({ data: { professionalId: professional.id, serviceId: coloracao.id } });
    }
    return { actor: { salonId, userId: owner.id } };
  });
}

suite("name folding against PostgreSQL (runtime role, RLS)", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => { console.log("NAME_FOLDING_PREFLIGHT", await assertMvpTestDatabase(admin)); vi.stubGlobal("fetch", network); });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await admin.$disconnect(); await prisma.$disconnect(); });

  it("customers are found ignoring case and accents, never across salons", async () => {
    const a = await salon("A"), b = await salon("B");
    for (const query of ["joao", "JOAO", "joão", "João", "pereira", "joao pereira"]) {
      const rows = await withTenant(a.actor, tx => searchSalonCustomer(tx, a.actor, query));
      expect(rows.map(row => row.name), query).toEqual(["João Pereira"]);
    }
    // "jo" is ambiguous: both names come back so the Secretary asks which one.
    expect((await withTenant(a.actor, tx => searchSalonCustomer(tx, a.actor, "jo"))).map(row => row.name).sort()).toEqual(["Joana Dias", "João Pereira"]);
    // Salon B has its own João; A never sees it.
    const idsA = new Set((await withTenant(a.actor, tx => searchSalonCustomer(tx, a.actor, "joao"))).map(row => row.id));
    const idsB = (await withTenant(b.actor, tx => searchSalonCustomer(tx, b.actor, "joao"))).map(row => row.id);
    expect(idsB).toHaveLength(1); expect(idsA.has(idsB[0])).toBe(false);
  });
  it("the accent-folded clause treats typed LIKE wildcards as literal characters", async () => {
    const a = await salon("wildcard");
    expect((await withTenant(a.actor, tx => searchSalonCustomer(tx, a.actor, "50%"))).map(row => row.name)).toEqual(["Ana 50% Silva"]);
    const folded = (term: string) => admin.$queryRaw<{ name: string }[]>`SELECT name FROM "ClientProfile" WHERE "salonId"=${a.actor.salonId} AND lower(translate(name, ${FOLD_FROM}, ${FOLD_TO})) LIKE lower(translate(${foldedLikePattern(term)}, ${FOLD_FROM}, ${FOLD_TO})) ESCAPE '\\' ORDER BY name`;
    expect((await folded("%%")).map(row => row.name)).toEqual([]);
    expect((await folded("_o")).map(row => row.name)).toEqual([]);
    expect((await folded("50%")).map(row => row.name)).toEqual(["Ana 50% Silva"]);
    // Pre-existing, unchanged: the case-insensitive Prisma `contains` clause does not escape
    // wildcards, so "%%" lists the salon's customers as choices (never an automatic pick).
    expect((await withTenant(a.actor, tx => searchSalonCustomer(tx, a.actor, "%%"))).length).toBe(3);
  });
  it("services and professionals are found ignoring case and accents", async () => {
    const a = await salon("catalog");
    for (const query of ["coloracao", "COLORAÇÃO", "coloração"]) expect((await withTenant(a.actor, tx => listSchedulingServices(tx, a.actor, query))).map(row => row.name), query).toEqual(["Coloração"]);
    for (const query of ["fabio", "FÁBIO", "fábio lima"]) expect((await withTenant(a.actor, tx => listSchedulingProfessionals(tx, a.actor, { query }))).map(row => row.name), query).toEqual(["Fábio Lima"]);
    expect((await withTenant(a.actor, tx => listSchedulingProfessionals(tx, a.actor, { query: "tatiana" }))).map(row => row.name)).toEqual(["Tatiana Rocha"]);
  });
});
