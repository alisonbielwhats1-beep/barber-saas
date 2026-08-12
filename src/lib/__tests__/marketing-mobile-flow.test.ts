import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/app/(admin)/marketing/marketing-campaigns.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  join(process.cwd(), "src/app/(admin)/marketing/page.tsx"),
  "utf8",
);

describe("fluxo mobile de campanhas", () => {
  it("mostra um seletor compacto antes do editor de mensagem", () => {
    const selector = source.indexOf('aria-label="Escolher campanha"');
    const editor = source.indexOf(">Mensagem</h3>");

    expect(selector).toBeGreaterThanOrEqual(0);
    expect(selector).toBeLessThan(editor);
    expect(source).toContain('className="lg:hidden"');
  });

  it("oferece um atalho explícito para a lista de destinatários", () => {
    expect(source).toContain('href="#marketing-destinatarios"');
    expect(source).toContain('id="marketing-destinatarios"');
    expect(source).toContain("Ver destinatários");
  });

  it("nomeia claramente a ação do WhatsApp em telas estreitas", () => {
    expect(source).toContain("Enviar pelo WhatsApp");
  });

  it("abre a base completa de clientes antes dos segmentos especiais", () => {
    expect(pageSource).toContain("allClients={clients.map(toTarget)}");
    expect(source).toContain('key: "all"');
    expect(source).toContain('title: "Todos os clientes"');
    expect(source.indexOf('key: "all"')).toBeLessThan(source.indexOf('key: "birthday"'));
  });
});
