import { describe, expect, it } from "vitest";
import {
  parseClientCareProfile,
  serializeClientCareProfile,
} from "../client-care-profile";

describe("perfil de cuidados do cliente", () => {
  it("preserva observacoes legadas como anotacao geral", () => {
    expect(parseClientCareProfile("Prefere cafe sem acucar")).toEqual({
      notes: "Prefere cafe sem acucar",
      allergies: "",
      preferences: "",
      consentGiven: false,
    });
  });

  it("grava e recupera campos estruturados sem perder acentos", () => {
    const profile = {
      notes: "Cliente prefere atendimento silencioso.",
      allergies: "Alergia a amonia.",
      preferences: "Água morna e corte baixo.",
      consentGiven: true,
    };

    expect(parseClientCareProfile(serializeClientCareProfile(profile))).toEqual(profile);
  });

  it("trata conteudo estruturado invalido como nota legada", () => {
    const invalid = "SALONSAAS_CARE_V1:{invalido";
    expect(parseClientCareProfile(invalid).notes).toBe(invalid);
  });
});
