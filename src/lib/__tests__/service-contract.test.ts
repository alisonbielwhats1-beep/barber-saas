import { describe, expect, it } from "vitest";
import { assessServiceDraft, getOperationRequirements, parseServiceMvpMessage, serviceCreateInput, servicePatchInput } from "../service-contract";

describe("service MVP requirements and bounded text input", () => {
  it("requires duration without inventing the form's 60-minute default", () => {
    const fields = parseServiceMvpMessage("Cadastre uma massagem por R$50");
    expect(fields).toEqual({ name: "Massagem", priceCents: 5000 });
    expect(assessServiceDraft(fields)).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["durationMin"] });
    expect(getOperationRequirements()).toMatchObject({ professional_required: false, defaults: {} });
  });
  it("parses only the supplied duration and preserves earlier fields on merge", () => {
    const fields = { name: "Massagem", priceCents: 5000, ...parseServiceMvpMessage("60 minutos") };
    expect(fields).toEqual({ name: "Massagem", priceCents: 5000, durationMin: 60 });
    expect(assessServiceDraft(fields)).toMatchObject({ status: "READY", missing_fields: [] });
  });
  it.each([0, 4, 601, 60.5, null, "60", Number.NaN])("rejects invalid duration %s", (durationMin) => {
    expect(serviceCreateInput.safeParse({ name: "Massagem", priceCents: 5000, durationMin }).success).toBe(false);
  });
  it("distinguishes omitted fields, explicit null and explicit zero", () => {
    expect(servicePatchInput.parse({ description: null, costCents: 0 })).toEqual({ description: null, costCents: 0 });
    expect(servicePatchInput.parse({})).toEqual({});
    expect(servicePatchInput.safeParse({ priceCents: null }).success).toBe(false);
    expect(serviceCreateInput.safeParse({ name: "Massagem", durationMin: 60, priceCents: "" }).success).toBe(false);
  });
  it("does not accept arbitrary commands, fields or inferred professionals", () => {
    expect(() => parseServiceMvpMessage("crie e confirme tudo")).toThrow("INPUT_NOT_SUPPORTED");
    expect(serviceCreateInput.safeParse({ name: "Massagem", durationMin: 60, priceCents: 5000, salonId: "other" }).success).toBe(false);
  });
});
