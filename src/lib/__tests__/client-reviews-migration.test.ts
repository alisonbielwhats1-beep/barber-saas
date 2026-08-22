import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("superfície de avaliações verificadas", () => {
  it("mantém a avaliação tenant-scoped e impede nota fora de 1 a 5 no banco", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/sql/manual/015_client_reviews.sql");
    expect(schema).toContain("model ClientReview");
    expect(schema).toContain('@@unique([appointmentId, clientId], map: "ClientReview_appointmentId_clientId_key")');
    expect(migration).toContain('CHECK ("rating" BETWEEN 1 AND 5)');
    expect(migration).toContain('USING ("salonId" = app_current_salon())');
    expect(migration).toContain("ALTER TABLE \"ClientReview\" FORCE ROW LEVEL SECURITY");
  });

  it("faz o preflight sem comandos mutáveis", () => {
    const preflight = source("prisma/sql/manual/015_client_reviews.preflight.sql")
      .replace(/--.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .toUpperCase();
    expect(preflight).not.toMatch(/\b(ALTER|CREATE|DELETE|DROP|INSERT|TRUNCATE|UPDATE)\b/);
  });

  it("só aceita avaliação autenticada de atendimento concluído e não expõe exclusão", () => {
    const action = source("src/app/book/[salonSlug]/reviews-actions.ts");
    const admin = source("src/app/(admin)/avaliacoes/actions.ts");
    expect(action).toContain('status: "COMPLETED"');
    expect(action).toContain("clientId: effectiveSession.clientId");
    expect(action).toContain("tx.clientReview.create");
    expect(admin).toContain('assertRole(ctx, ["OWNER", "MANAGER"])');
    expect(admin).toContain("tx.clientReview.updateMany");
    expect(admin).not.toContain("clientReview.delete");
  });

  it("exibe a reputação na entrada pública e oferece avaliação no histórico do cliente", () => {
    const home = source("src/app/book/[salonSlug]/page.tsx");
    const history = source("src/app/book/[salonSlug]/minhas/minhas-list.tsx");
    const publicPage = source("src/app/book/[salonSlug]/avaliacoes/page.tsx");
    expect(home).toContain("<ReviewsSection");
    expect(history).toContain("<ReviewDialog");
    expect(publicPage).toContain("Avaliações dos clientes");
  });
});
