import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECRETARY_MODEL, MODEL_CERTIFICATES_FILE, MODEL_CERTIFICATION_POLICY, SECRETARY_MODEL_CERTIFICATES, assertSecretaryModelCertified, certificateMeetsPolicy,
  modelCertificationRequired, parseModelCertificates, secretaryModelCertificate, type ModelCertificate,
} from "@everflair/salon-secretary";
import { contractProfileDigest } from "../../../packages/salon-secretary/evaluation/contract-version-profiles";

/** Quality gate of a model switch (owner decision 04/10/2026): Golden pass^k certificate for the exact live contract. */
const certificate = (over: Partial<ModelCertificate["evidence"]> = {}): ModelCertificate => ({ model: "deepseek/deepseek-v4.1-flash", contractVersion: "a".repeat(64),
  contractEnv: { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: "true" }, certifiedAt: "2026-10-04T18:00:00.000Z",
  evidence: { suite: MODEL_CERTIFICATION_POLICY.suite, run: "golden-x", binding: "b".repeat(64), repeat: 3, cases: 30, passed: 90, total: 90, safetyFailures: 0, p50Ms: 1500, p90Ms: 1900, ...over } });
const file = (...certificates: ModelCertificate[]) => parseModelCertificates({ schema: "secretary-model-certificates-v1", note: "test", certificates });

describe("model certification", () => {
  it("the policy: the Golden suite, at least 3 attempts, every case in every attempt, no safety failure", () => {
    expect(certificateMeetsPolicy(certificate())).toBe(true);
    for (const weak of [{ repeat: 2, total: 60, passed: 60 }, { passed: 89 }, { safetyFailures: 1 }, { suite: "golden-free-use-30-subset" }, { cases: 29 }])
      expect(certificateMeetsPolicy(certificate(weak)), JSON.stringify(weak)).toBe(false);
  });

  it("admits a model only for the certified contract version, and refuses a malformed file", () => {
    const ok = file(certificate());
    expect(secretaryModelCertificate("deepseek/deepseek-v4.1-flash", "a".repeat(64), ok)).toBeDefined();
    expect(() => assertSecretaryModelCertified("deepseek/deepseek-v4.1-flash", "c".repeat(64), ok)).toThrow("SECRETARY_MODEL_NOT_CERTIFIED");
    expect(() => assertSecretaryModelCertified("gpt-6-luna", "a".repeat(64), ok)).toThrow("SECRETARY_MODEL_NOT_CERTIFIED");
    expect(() => assertSecretaryModelCertified("deepseek/deepseek-v4.1-flash", "a".repeat(64), file(certificate({ passed: 80 })))).toThrow("SECRETARY_MODEL_NOT_CERTIFIED");
    for (const bad of [{}, { schema: "x", note: "", certificates: [] }, { schema: "secretary-model-certificates-v1", note: "", certificates: [{ ...certificate(), extra: 1 }] },
      { schema: "secretary-model-certificates-v1", note: "", certificates: [{ ...certificate(), contractVersion: "short" }] }])
      expect(() => parseModelCertificates(bad)).toThrow("SECRETARY_MODEL_CERTIFICATES");
  });

  it("applies outside local development and tests, or when asked", () => {
    expect(modelCertificationRequired({ APP_ENV: "development" })).toBe(false);
    expect(modelCertificationRequired({ APP_ENV: "test" })).toBe(false);
    for (const env of [{ APP_ENV: "staging" }, { APP_ENV: "production" }, {}, { APP_ENV: "test", VERCEL_ENV: "production" },
      { APP_ENV: "development", SALON_SECRETARY_REQUIRE_CERTIFIED_MODEL: "true" }]) expect(modelCertificationRequired(env), JSON.stringify(env)).toBe(true);
  });

  it("the checked-in file: every certificate meets the policy, and the Secretary's model is certified for the live contract", () => {
    const recorded = parseModelCertificates(JSON.parse(readFileSync(join(process.cwd(), MODEL_CERTIFICATES_FILE), "utf8")));
    expect(recorded).toEqual(SECRETARY_MODEL_CERTIFICATES);
    for (const c of recorded.certificates) expect(certificateMeetsPolicy(c), `${c.model} ${c.evidence.run}`).toBe(true);
    // Re-derived from code under each certificate's own contract variables: a prompt, wire, flag or request-profile change leaves the
    // model uncertified until the Golden runs again (npx tsx scripts/secretary-certify-model.ts <run>).
    const live = recorded.certificates.filter(c => c.model === DEFAULT_SECRETARY_MODEL && contractProfileDigest(c.contractEnv, c.model).version === c.contractVersion);
    if (!live.length) throw Error(`SECRETARY MODEL NOT CERTIFIED: ${DEFAULT_SECRETARY_MODEL} has no Golden certificate for the live contract in ${MODEL_CERTIFICATES_FILE}. ` +
      "Run the Golden pass^k (k >= 3) for it and record it with: npx tsx scripts/secretary-certify-model.ts <run>");
  });
});
