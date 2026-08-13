import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("superficies dos novos fluxos operacionais", () => {
  it("habilita pagamentos na navegacao e oferece abertura e fechamento de caixa", () => {
    const sidebar = source("src/app/(admin)/sidebar-nav.tsx");
    const payments = source("src/app/(admin)/pagamentos/page.tsx");
    expect(sidebar).toContain('{ href: "/pagamentos", label: "Pagamentos", icon: CreditCard, roles: FINANCIAL_ROLES }');
    expect(payments).toContain("Abertura e fechamento");
    expect(payments).toContain("Recebimentos recentes");
  });

  it("mostra historico de campanhas e registra interacao manual", () => {
    const page = source("src/app/(admin)/marketing/page.tsx");
    const actions = source("src/app/(admin)/marketing/actions.ts");
    expect(page).toContain("Histórico de campanhas");
    expect(actions).toContain("recordCampaignInteraction");
  });

  it("rastreia movimentacoes de estoque com motivo", () => {
    const actions = source("src/app/(admin)/produtos/actions.ts");
    const service = source("src/lib/appointment-product-service.ts");
    const catalog = source("src/app/(admin)/produtos/products-catalog.tsx");
    expect(actions).toContain("await adjustProductStockReliably(tx");
    expect(service).toContain('action: "STOCK_ADJUSTED"');
    expect(service).toContain("previousStock: product.stock");
    expect(catalog).toContain("Movimentar estoque");
    expect(catalog).toContain("Motivo");
  });

  it("permite resgatar recompensa e importar clientes", () => {
    const clients = source("src/app/(admin)/clientes/clients-crm.tsx");
    const actions = source("src/app/(admin)/clientes/actions.ts");
    expect(clients).toContain("Resgatar recompensa");
    expect(actions).toContain("importClientsCsv");
    expect(actions).toContain("redeemLoyaltyReward");
  });

  it("recebe comanda concluída sem repetir transição nem sobrescrever pagamento", () => {
    const actions = source("src/app/(admin)/agenda/actions.ts");
    const service = source("src/lib/comanda-service.ts");
    const detail = source("src/app/(admin)/agenda/appointment-detail.tsx");
    expect(actions).toContain("await closeComandaReliably(tx");
    expect(service).toContain('if (appointment.status === "COMPLETED")');
    expect(service).toContain("await tx.payment.create");
    expect(service).toContain('action: "COMANDA_CLOSED"');
    expect(service).toContain("await lockAppointmentOperationalScope(tx");
    expect(service).not.toContain('ON CONFLICT ("appointmentId") DO UPDATE');
    expect(detail).toContain("Registrar recebimento");
  });

  it("monta recibos a partir do Payment e snapshots recarregados no servidor", () => {
    const actions = source("src/app/(admin)/agenda/actions.ts");
    const panel = source("src/app/(admin)/agenda/comanda-panel.tsx");
    const detail = source("src/app/(admin)/agenda/appointment-detail.tsx");
    expect(actions).toContain("amountCents: true");
    expect(actions).toContain("discountCents: true");
    expect(actions).toContain("paidAt: true");
    expect(actions).toContain("priceCentsUnit: true");
    expect(panel).toContain("const receipt = await getComandaData(apptId)");
    expect(panel).toContain("payment.amountCents");
    expect(panel).toContain("payment.id");
    expect(detail).toContain("const receipt = await getComandaData(appt.id)");
    expect(detail).toContain("receipt.payment.amountCents");
    expect(detail).toContain("receipt.payment.id");
  });

  it("valida desconto pela role no núcleo transacional, não apenas na UI", () => {
    const actions = source("src/app/(admin)/agenda/actions.ts");
    const service = source("src/lib/comanda-service.ts");
    expect(actions).toContain("role: ctx.role");
    expect(service).toContain('role === "RECEPTIONIST" && discountCents > 0');
    expect(service).toContain('"DISCOUNT_FORBIDDEN"');
  });

  it("executa a integração PostgreSQL da comanda no schema-smoke do CI", () => {
    const packageJson = source("package.json");
    const workflow = source(".github/workflows/ci.yml");
    expect(packageJson).toContain("comanda-postgres.integration.test.ts");
    expect(workflow).toContain("npm run test:appointment-integration");
    expect(workflow).toContain("appointment and comanda concurrency with PostgreSQL");
  });

  it("reconcilia produtos pré-reservados por delta e compartilha o lock com a reserva pública", () => {
    const service = source("src/lib/comanda-service.ts");
    const domain = source("src/lib/comanda.ts");
    const publicRoute = source("src/app/api/appointments/route.ts");
    const reservation = source("src/lib/appointment-product-service.ts");
    expect(domain).toContain("reservedQuantity - input.desiredQuantity");
    expect(domain).toContain("row.priceCentsUnit");
    expect(service).toContain('"RESERVATION_RETURN"');
    expect(service).toContain("lockProductMutations(tx, productIds)");
    expect(publicRoute).toContain("createAppointmentWithProductReservation(tx");
    expect(publicRoute).not.toContain("idempotencyContext: normalizedCart");
    expect(reservation).toContain("await lockProductMutations(tx");
    expect(reservation).toContain("await lockAppointmentOperationalScope(tx");
    expect(reservation).not.toContain("appointmentVisibility");
    expect(reservation).toContain(
      'appointment: OmitFromEach<CreateAppointmentInput, "idempotencyContext">',
    );
    expect(reservation).toContain("idempotencyContext: items");
    expect(reservation).toContain('kind: "RESERVATION"');
  });

  it("encerra a fila sem promoção em cancelamento do estabelecimento", () => {
    const service = source("src/lib/appointment-service.ts");
    const detail = source("src/app/(admin)/agenda/appointment-detail.tsx");
    expect(service).toMatch(
      /if \(input\.actor\.type === "CLIENT"\) \{[\s\S]*?nextWaitlistSlot/,
    );
    expect(service).toContain("cancelActiveWaitlistForAppointment");
    expect(detail).toContain("a fila será encerrada sem promoção automática");
  });

  it("mantém o preflight cross-tenant somente leitura até migration autorizada", () => {
    const preflight = source("prisma/sql/preflight/appointment_product_tenant_integrity.sql");
    const normalized = preflight
      .replace(/--.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .toUpperCase();
    expect(preflight).toContain("a.\"salonId\" <> p.\"salonId\"");
    expect(normalized).not.toMatch(/\b(ALTER|CREATE|DELETE|DROP|INSERT|TRUNCATE|UPDATE)\b/);
  });
});
