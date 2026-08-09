import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/app/book/[salonSlug]/agendar/booking-flow.tsx"),
  "utf8",
);

describe("cartões de serviço no agendamento", () => {
  it("não corta nome, descrição nem resumo dos serviços escolhidos", () => {
    expect(source).toContain('className="mt-3 break-words font-medium leading-snug"');
    expect(source).toContain('className="mt-1 break-words text-xs leading-relaxed text-muted-foreground"');
    expect(source).toContain('className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground"');
    expect(source).not.toContain('className="mt-3 line-clamp-2 font-medium leading-snug"');
  });
});
