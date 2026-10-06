import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, describe, vi } from "vitest";

/** C3 suggestions against PostgreSQL (disposable MVP database, runtime role, RLS). Runs only with
 * RUN_SERVICE_MVP_INTEGRATION=1 (coordinator); the client is created lazily so the file loads without a database. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;

suite("name suggestions against PostgreSQL (runtime role, RLS)", () => {
  let admin: PrismaClient;
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  async function salon(label: string, customers: string[]) {
    const salonId = randomUUID();
    return admin.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
      const owner = await tx.user.create({ data: { name: "Tatiana Rocha", email: `suggest-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
      const other = await tx.user.create({ data: { name: "Rodrigo Lima", email: `suggest-other-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
      await tx.salon.create({ data: { id: salonId, name: `Synthetic suggestions ${label}`, slug: `suggest-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: "America/Sao_Paulo" } });
      await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
      const ids: Record<string, string> = {};
      for (const name of customers) ids[name] = (await tx.clientProfile.create({ data: { salonId, name } })).id;
      const escova = await tx.service.create({ data: { salonId, name: "Escova Progressiva", priceCents: 20000, durationMin: 120 } });
      await tx.service.create({ data: { salonId, name: "Corte Feminino", priceCents: 8000, durationMin: 60 } });
      const tatiana = await tx.professional.create({ data: { salonId, userId: owner.id } });
      await tx.professional.create({ data: { salonId, userId: other.id } });
      await tx.professionalService.create({ data: { professionalId: tatiana.id, serviceId: escova.id } });
      return { actor: { salonId, userId: owner.id }, ids, escova: escova.id, tatiana: tatiana.id };
    });
  }
  beforeAll(async () => {
    const { assertMvpTestDatabase } = await import("../../../scripts/service-mvp-test-safety");
    admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
    console.log("NAME_SUGGESTIONS_PREFLIGHT", await assertMvpTestDatabase(admin)); vi.stubGlobal("fetch", network);
  });
  afterAll(async () => {
    expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await admin?.$disconnect();
    const { prisma } = await import("../prisma"); await prisma.$disconnect();
  });

  it("customers: token-start prefilter, same salon only, merged profiles hidden, deterministic", async () => {
    const { withTenant } = await import("../prisma-tenant");
    const { suggestSalonCustomers } = await import("../entity-suggestions");
    const a = await salon("A", ["Tatiana Rocha", "Tamires Lima", "Ana Tatiane", "Tatiana Velha"]);
    const b = await salon("B", ["Tatiana Souza"]);
    await admin.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.current_salon',${a.actor.salonId},true)`;
      await tx.clientProfile.update({ where: { id: a.ids["Tatiana Velha"] }, data: { mergedIntoId: a.ids["Tatiana Rocha"] } });
    });
    const found = await withTenant(a.actor, tx => suggestSalonCustomers(tx, a.actor, "Tatiane Rocha"));
    expect(found).toMatchObject({ status: "SUGGEST", rows: [{ id: a.ids["Tatiana Rocha"], name: "Tatiana Rocha" }] });
    // A surname token also opens the prefilter ("... Tatiane"), never another salon's rows or a merged profile.
    const single = await withTenant(a.actor, tx => suggestSalonCustomers(tx, a.actor, "Tatiana"));
    expect(single.status).toBe("SUGGEST");
    const names = single.status === "SUGGEST" ? single.rows.map(row => row.name) : [];
    expect(names).toEqual(["Tatiana Rocha", "Ana Tatiane"]);
    expect(await withTenant(a.actor, tx => suggestSalonCustomers(tx, a.actor, "Tatiana"))).toEqual(single);
    expect(JSON.stringify(single)).not.toContain(Object.values(b.ids)[0]); expect(names).not.toContain("Tatiana Velha");
  });
  it("professionals and services: eligible pool only when a service is given", async () => {
    const { withTenant } = await import("../prisma-tenant");
    const { suggestSchedulingProfessionals, suggestSchedulingServices } = await import("../entity-suggestions");
    const a = await salon("catalog", []);
    expect(await withTenant(a.actor, tx => suggestSchedulingProfessionals(tx, a.actor, { query: "Rodirgo" }))).toMatchObject({ status: "SUGGEST", rows: [{ name: "Rodrigo Lima" }] });
    expect(await withTenant(a.actor, tx => suggestSchedulingProfessionals(tx, a.actor, { service_ref: a.escova, query: "Rodirgo" }))).toEqual({ status: "NONE" });
    expect(await withTenant(a.actor, tx => suggestSchedulingProfessionals(tx, a.actor, { service_ref: a.escova, query: "Tatiane" }))).toEqual({ status: "SUGGEST", rows: [{ id: a.tatiana, name: "Tatiana Rocha" }] });
    expect(await withTenant(a.actor, tx => suggestSchedulingServices(tx, a.actor, "Escova Progresiva"))).toMatchObject({ status: "SUGGEST", rows: [{ id: a.escova, name: "Escova Progressiva" }] });
  });
});
