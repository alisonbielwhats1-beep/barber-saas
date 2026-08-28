import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("frontend audit source regressions", () => {
  it("keeps login credentials out of a GET fallback and exposes accessible fields", () => {
    const login = source("src/app/(auth)/login/login-form.tsx");
    const passwordInput = source("src/components/ui/password-input.tsx");

    expect(login).toContain('<form method="post"');
    expect(login).toContain('autoComplete="email"');
    expect(login).toContain('autoComplete="current-password"');
    expect(login).toContain("aria-invalid");
    expect(login).toContain("<PasswordInput");
    expect(passwordInput).toContain("Mostrar senha");
    expect(passwordInput).toContain("Ocultar senha");
    expect(passwordInput).toContain("aria-pressed");
  });

  it("prevents the admin content from forcing horizontal overflow", () => {
    const layout = source("src/app/(admin)/layout.tsx");

    expect(layout).toMatch(/<main[^>]+min-w-0/);
    expect(layout).toMatch(/<main[^>]+overflow-x-hidden/);
  });

  it("keeps every period option reachable and touch-friendly on mobile", () => {
    const rangeFilter = source("src/app/(admin)/dashboard/range-filter.tsx");

    expect(rangeFilter).toContain("overflow-x-auto");
    expect(rangeFilter).toContain("whitespace-nowrap");
    expect(rangeFilter).toContain("min-h-11");
    expect(rangeFilter).toContain("aria-pressed");
  });

  it("offers the primary product action inside the empty state", () => {
    const products = source("src/app/(admin)/produtos/page.tsx");

    expect(products).toContain("Comece seu catálogo");
    expect(products).toMatch(/ProductForm[\s\S]+trigger=/);
  });

  it("keeps the agenda month usable and named on narrow screens", () => {
    const agenda = source("src/app/(admin)/agenda/agenda-board.tsx");

    expect(agenda).toContain('aria-label="Visualização da agenda"');
    expect(agenda).toContain("aria-pressed={active}");
    expect(agenda).toContain('className="grid grid-cols-7 sm:hidden"');
    expect(agenda).toContain("min-h-12");
    expect(agenda).toContain("Toque em um dia para abrir os agendamentos.");
    expect(agenda).toContain('aria-current={isToday ? "date" : undefined}');
    expect(agenda).toContain('aria-label="Buscar cliente ou telefone"');
  });

  it("keeps the dashboard operational first and secondary analysis progressive", () => {
    const dashboard = source("src/app/(admin)/dashboard/page.tsx");
    const nowStrip = source("src/app/(admin)/dashboard/now-strip.tsx");

    expect(dashboard).toContain("<NowStrip");
    expect(nowStrip).toContain('aria-labelledby="now-strip-title"');
    expect(nowStrip).toContain("Próximos atendimentos de hoje");
    expect(nowStrip).toContain("Atualização automática a cada minuto");
    expect(nowStrip).toContain("appointments.slice(0, 4)");
    expect(nowStrip).toContain("Receita concluída hoje");
    expect(nowStrip).toContain('aria-label="Próximos atendimentos de hoje"');
    expect(nowStrip).toContain("overflow-x-auto");
    expect(dashboard).toMatch(/<details[\s\S]+Análises complementares/);
    expect(dashboard).toContain('href="/relatorios"');
  });

  it("keeps the booking actions attached to the viewport and reviews before writing", () => {
    const booking = source("src/app/book/[salonSlug]/agendar/booking-flow.tsx");

    expect(booking.match(/data-booking-tray/g)).toHaveLength(2);
    expect(booking).toMatch(/<\/section>\s*<div data-booking-tray/);
    expect(booking).toContain("eligibleProfessionals.length === 1");
    expect(booking).toContain("foi selecionado automaticamente");
    expect(booking).toContain("<BookingReview");
    expect(booking).toContain("Revise sua reserva");
  });

  it("keeps the next client reservation first and visually distinct", () => {
    const visits = source("src/app/book/[salonSlug]/minhas/minhas-list.tsx");

    expect(visits).toContain(".sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())");
    expect(visits).toContain("Seu próximo atendimento");
    expect(visits).toContain("featured");
  });

  it("keeps the salon brand in the owner panel and the client app in its default green", () => {
    const adminLayout = source("src/app/(admin)/layout.tsx");
    const clientLayout = source("src/app/book/[salonSlug]/layout.tsx");

    expect(adminLayout).toContain("themeColorHex");
    expect(adminLayout).toContain("style={brandStyle}");
    expect(adminLayout).toContain('"--primary-foreground"');
    expect(clientLayout).not.toContain("themeColorHex");
    expect(clientLayout).not.toContain("style={brandStyle}");
  });

  it("keeps the client vitrine focused and makes the real logo expandable", () => {
    const home = source("src/app/book/[salonSlug]/page.tsx");
    const logo = source("src/app/book/[salonSlug]/salon-logo-lightbox.tsx");

    expect(home).toContain("<SalonLogoLightbox");
    expect(home).not.toContain('aria-label="Contato rápido"');
    expect(home).toContain('aria-labelledby="contact-title"');
    expect(home).toContain("Fale com o Studio");
    expect(home).toContain("{salon.address && (");
    const infoStart = home.indexOf("{/* Informações");
    expect(infoStart).toBeGreaterThan(-1);
    expect(home.slice(infoStart)).not.toContain("whatsappHref");
    expect(home.slice(infoStart)).not.toContain("phoneHref");
    expect(logo).toContain('role="dialog"');
    expect(logo).toContain('aria-label="Fechar logo ampliado"');
    expect(logo).toContain('event.key === "Escape"');
  });
});
