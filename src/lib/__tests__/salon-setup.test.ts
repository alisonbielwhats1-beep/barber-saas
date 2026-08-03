import { describe, expect, it } from "vitest";
import { resolveSalonSetup } from "../salon-setup";
import { SEGMENTS, getSegment } from "../segments";

const BARBEARIA = getSegment("barbearia");
const nomesDaBarbearia = BARBEARIA.exampleServices.map((s) => s.name);

describe("resolveSalonSetup — validação do segmento", () => {
  it("aceita todo segmento real", () => {
    for (const s of SEGMENTS) {
      const res = resolveSalonSetup(s.id, []);
      expect(res.ok).toBe(true);
    }
  });

  it("recusa segmento inexistente em vez de cair no default", () => {
    // Cair no default silenciosamente gravaria um segmento que o dono nunca
    // escolheu, e ele apareceria na vitrine pública dele.
    const res = resolveSalonSetup("cassino", []);
    expect(res).toEqual({ ok: false, error: "Tipo de negócio inválido." });
  });

  it("recusa string vazia", () => {
    expect(resolveSalonSetup("", []).ok).toBe(false);
  });
});

describe("resolveSalonSetup — serviços aceitos", () => {
  it("mantém os nomes que vieram das sugestões do segmento", () => {
    const res = resolveSalonSetup("barbearia", nomesDaBarbearia);
    if (!res.ok) throw new Error("deveria ter passado");
    expect(res.setup.services.map((s) => s.name)).toEqual(nomesDaBarbearia);
  });

  it("descarta nome que não é sugestão do segmento", () => {
    // O cliente manda a lista de nomes. Sem este filtro ele cadastraria
    // serviço arbitrário no banco chamando a action direto.
    const res = resolveSalonSetup("barbearia", [
      "Corte masculino",
      "Serviço inventado pelo cliente",
      "<script>alert(1)</script>",
    ]);
    if (!res.ok) throw new Error("deveria ter passado");
    expect(res.setup.services.map((s) => s.name)).toEqual(["Corte masculino"]);
  });

  it("descarta sugestão que pertence a outro segmento", () => {
    const res = resolveSalonSetup("barbearia", ["Alongamento", "Barba"]);
    if (!res.ok) throw new Error("deveria ter passado");
    expect(res.setup.services.map((s) => s.name)).toEqual(["Barba"]);
  });

  it("não duplica quando o mesmo nome vem repetido", () => {
    const res = resolveSalonSetup("barbearia", ["Barba", "Barba", "Barba"]);
    if (!res.ok) throw new Error("deveria ter passado");
    expect(res.setup.services).toHaveLength(1);
  });

  it("aceita lista vazia — o dono pode desmarcar tudo", () => {
    const res = resolveSalonSetup("barbearia", []);
    if (!res.ok) throw new Error("deveria ter passado");
    expect(res.setup.services).toEqual([]);
  });
});

describe("resolveSalonSetup — dados gerados", () => {
  it("nunca inventa preço", () => {
    for (const segment of SEGMENTS) {
      const res = resolveSalonSetup(
        segment.id,
        segment.exampleServices.map((s) => s.name),
      );
      if (!res.ok) throw new Error("deveria ter passado");
      for (const service of res.setup.services) {
        expect(service.priceCents).toBe(0);
      }
    }
  });

  it("copia a duração declarada na sugestão, sem arredondar", () => {
    const res = resolveSalonSetup("barbearia", ["Pezinho"]);
    if (!res.ok) throw new Error("deveria ter passado");
    const esperado = BARBEARIA.exampleServices.find((s) => s.name === "Pezinho")!;
    expect(res.setup.services[0].durationMin).toBe(esperado.durationMin);
  });

  it("devolve o id do segmento já validado, pronto para gravar", () => {
    const res = resolveSalonSetup("estetica-bemestar", []);
    if (!res.ok) throw new Error("deveria ter passado");
    expect(res.setup.segmentId).toBe("estetica-bemestar");
    expect(res.setup.segment.shortLabel).toBe("Estética");
  });
});
