import certificatesFile from "../model-certificates.json";

/** Quality gate of a model switch (owner decision 04/10/2026: changing the model must never cost the results). A model answers
 * the Secretary outside local development and tests only when packages/salon-secretary/model-certificates.json holds a certificate
 * for it AND for the exact live contract version (prompt, wire, flags, output limit, model and its request profile): the Golden
 * battery repeated at least MODEL_CERTIFICATION_POLICY.minRepeat times with every case passing in every attempt and no safety
 * failure. Certificates are written only by scripts/secretary-certify-model.ts from a finished Golden run; any later change of the
 * contract leaves the model uncertified until the battery runs again. */
export const MODEL_CERTIFICATES_FILE = "packages/salon-secretary/model-certificates.json";
export const MODEL_CERTIFICATION_SCHEMA = "secretary-model-certificates-v1";
export const MODEL_CERTIFICATION_POLICY = Object.freeze({ suite: "golden-free-use-30", minRepeat: 3, safetyFailures: 0 });
export type ModelCertificateEvidence = Readonly<{ suite: string; run: string; binding: string; repeat: number; cases: number; passed: number; total: number;
  safetyFailures: number; p50Ms: number | null; p90Ms: number | null }>;
/** `contractEnv`: the contract variables of the certified run (all others unset), so the certificate can be re-derived from code. */
export type ModelCertificate = Readonly<{ model: string; contractVersion: string; contractEnv: Readonly<Record<string, string>>; evidence: ModelCertificateEvidence;
  certifiedAt: string }>;
export type ModelCertificateFile = Readonly<{ schema: string; note: string; certificates: readonly ModelCertificate[] }>;

const HASH = /^[0-9a-f]{64}$/, LABEL = /^[A-Za-z0-9][A-Za-z0-9_.:#+-]{0,159}$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
/** Exactly these keys, in any order. */
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).sort().join() === [...expected].sort().join();
function bad(): never { throw new Error("SECRETARY_MODEL_CERTIFICATES"); }
function parseCertificate(value: unknown): ModelCertificate {
  if (!record(value) || !keys(value, ["model", "contractVersion", "contractEnv", "evidence", "certifiedAt"])) bad();
  const { model, contractVersion, contractEnv, evidence, certifiedAt } = value;
  if (typeof model !== "string" || !model || model.length > 100 || typeof contractVersion !== "string" || !HASH.test(contractVersion) ||
      !record(contractEnv) || Object.entries(contractEnv).some(([name, flag]) => !/^SALON_SECRETARY_[A-Z0-9_]+$/.test(name) || typeof flag !== "string") ||
      typeof certifiedAt !== "string" || Number.isNaN(Date.parse(certifiedAt)) || !record(evidence) ||
      !keys(evidence, ["suite", "run", "binding", "repeat", "cases", "passed", "total", "safetyFailures", "p50Ms", "p90Ms"])) bad();
  const e = evidence as Record<string, unknown>;
  if (typeof e.suite !== "string" || typeof e.run !== "string" || !LABEL.test(e.run) || typeof e.binding !== "string" || !HASH.test(e.binding) ||
      !count(e.repeat) || !count(e.cases) || !count(e.passed) || !count(e.total) || !count(e.safetyFailures) ||
      (e.p50Ms !== null && !count(e.p50Ms)) || (e.p90Ms !== null && !count(e.p90Ms))) bad();
  return Object.freeze({ model, contractVersion, contractEnv: Object.freeze({ ...contractEnv }) as Record<string, string>,
    evidence: Object.freeze({ ...e }) as ModelCertificateEvidence, certifiedAt });
}
export function parseModelCertificates(value: unknown): ModelCertificateFile {
  if (!record(value) || !keys(value, ["schema", "note", "certificates"]) || value.schema !== MODEL_CERTIFICATION_SCHEMA || typeof value.note !== "string" ||
      !Array.isArray(value.certificates)) bad();
  return Object.freeze({ schema: value.schema as string, note: value.note as string, certificates: Object.freeze((value.certificates as unknown[]).map(parseCertificate)) });
}
/** The policy bar: the suite, repeated enough, every case passing in every attempt, no safety failure. */
export const certificateMeetsPolicy = (certificate: ModelCertificate) => {
  const e = certificate.evidence;
  return e.suite === MODEL_CERTIFICATION_POLICY.suite && e.repeat >= MODEL_CERTIFICATION_POLICY.minRepeat && e.cases > 0 && e.total === e.cases * e.repeat &&
    e.passed === e.total && e.safetyFailures <= MODEL_CERTIFICATION_POLICY.safetyFailures;
};
export const SECRETARY_MODEL_CERTIFICATES = parseModelCertificates(certificatesFile);
/** The certificate that admits `modelId` under `contractVersion`, if any. */
export function secretaryModelCertificate(modelId: string, contractVersion: string, file: ModelCertificateFile = SECRETARY_MODEL_CERTIFICATES) {
  return file.certificates.find(certificate => certificate.model === modelId && certificate.contractVersion === contractVersion && certificateMeetsPolicy(certificate));
}
export function assertSecretaryModelCertified(modelId: string, contractVersion: string, file: ModelCertificateFile = SECRETARY_MODEL_CERTIFICATES) {
  const certificate = secretaryModelCertificate(modelId, contractVersion, file);
  if (!certificate) throw new Error("SECRETARY_MODEL_NOT_CERTIFIED");
  return certificate;
}
/** Where the gate applies: everywhere except local development and tests (staging, production, an unknown APP_ENV), or wherever
 * SALON_SECRETARY_REQUIRE_CERTIFIED_MODEL=true asks for it (to rehearse the gate locally). */
export const modelCertificationRequired = (env: Record<string, string | undefined>) =>
  env.SALON_SECRETARY_REQUIRE_CERTIFIED_MODEL === "true" || env.VERCEL_ENV === "production" || !["development", "test"].includes(env.APP_ENV ?? "");
