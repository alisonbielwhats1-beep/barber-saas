import { createHash } from "node:crypto";
import { skillRegistry } from "../src/skill-registry";
import { financialRequirements } from "../src/financial-skill";
import { inventoryOperation } from "../src/inventory-skill";
import { inventoryClosedSemanticsV1 } from "../src/inventory-closed-semantics";
import { communicationRequirements, communicationSkill } from "../src/communication-skill";
import { choiceSets, operations, type Decision, type QuestionId } from "./contract";
import type { Skill } from "./conditional-plan";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Read-only imports of published descriptors. No runtime, Tool, DB or provider. */
export function publishedDecisionCatalog() {
  return {
    registry: skillRegistry.map(s => ({ skill: s.skill_id, version: s.version, enabled: s.enabled, operations: [...s.operations] })),
    financial: financialRequirements(),
    inventory: { operations: inventoryOperation.options, manualHash: hash(inventoryClosedSemanticsV1) },
    communication: { requirements: communicationRequirements(), manualHash: hash(communicationSkill) },
  };
}
export type Publication = ReturnType<typeof publishedDecisionCatalog>;
// Deliberately pinned: changes to published semantics require a new offline audit, not automatic learning.
export const AUDITED_PUBLICATION_HASH = "5fbee1d13f738e4a7e57c678dbe701590e757c8dde3367cba754b551ea715d0b";
export const publicationHash = (publication: Publication) => hash(publication);
export const isAuditedPublication = (publication: Publication) => publicationHash(publication) === AUDITED_PUBLICATION_HASH;

type Operation = typeof operations[number];
type Binding =
  | { skill: "financial"; dimension: "metric"; value: Decision["metric"] }
  | { skill: "inventory"; dimension: "inventory"; value: Decision["inventory"] }
  | { skill: "communication"; dimension: "communication"; value: Decision["communication"] };
export type DerivationBinding = Binding & { operations: readonly Operation[]; evidence: string };
export type DerivationCatalog = { version: string; publicationHash: string; bindings: readonly DerivationBinding[] };
/** Canonical language-to-operation bindings from the published manuals/requirements, not a new domain rule. */
const bindings: DerivationBinding[] = [
  ...(["service_revenue", "realized_revenue", "received_revenue", "completed_count", "average_ticket", "outstanding_receivables"] as const)
    .map(value => ({ skill: "financial" as const, dimension: "metric" as const, value, operations: ["financial.report" as const], evidence: "src/financial-skill.ts#financialRequirements" })),
  ...([
    ["low_stock", "product.search"], ["search", "product.search"], ["balance", "stock.balance"], ["IN", "stock.movement"], ["OUT", "stock.movement"],
  ] as const).map(([value, operation]) => ({ skill: "inventory" as const, dimension: "inventory" as const, value, operations: [operation], evidence: "src/inventory-skill.ts#inventorySkill + src/skill-registry.ts#discoveryInstructions" })),
  ...(["EXACT", "GENERATED"] as const).map(value => ({ skill: "communication" as const, dimension: "communication" as const, value, operations: ["customer.message" as const], evidence: "src/communication-skill.ts#communicationRequirements" })),
];
export const derivationCatalog: DerivationCatalog = Object.freeze({ version: "decision-derivations-v1", publicationHash: AUDITED_PUBLICATION_HASH,
  bindings: Object.freeze(bindings.map(b => Object.freeze({ ...b, operations: Object.freeze([...b.operations]) }))) });
export const derivationCatalogHash = (catalog: DerivationCatalog) => hash(catalog);
export const derivableDimension = (skill: Skill): QuestionId | undefined => skill === "financial" ? "metric" : skill === "inventory" ? "inventory" : skill === "communication" ? "communication" : undefined;
export type Derivation = { dimension: "operation"; operation: Operation; source: { skill: Skill; dimension: QuestionId; value: string }; catalogVersion: string; catalogHash: string; publicationHash: string; evidence: string };
export type DerivationOutcome = { ok: true; derivation: Derivation } | { ok: false; reason: string };

/** Fail closed for missing/ambiguous mappings, stale publication, cross-skill values and modified snapshots. */
export function deriveOperation(skill: Skill, shape: Decision["shape"], dimension: QuestionId, value: string,
  catalog: DerivationCatalog = derivationCatalog, publication: Publication = publishedDecisionCatalog()): DerivationOutcome {
  const fail = (reason: string): DerivationOutcome => ({ ok: false, reason });
  if (shape !== "single") return fail("DEPENDENT_OR_COMPOUND_PLAN");
  if (!derivableDimension(skill) || dimension !== derivableDimension(skill)) return fail("INCOMPATIBLE_DECISION");
  if (!(choiceSets[dimension] as readonly string[]).includes(value)) return fail("UNKNOWN_DECISION");
  const matches = catalog.bindings.filter(b => b.skill === skill && b.dimension === dimension && b.value === value);
  if (!matches.length) return fail("MAPPING_MISSING");
  if (matches.length !== 1 || matches[0].operations.length > 1) return fail("MAPPING_AMBIGUOUS");
  const binding = matches[0], operation = binding.operations[0];
  if (!operation) return fail("MAPPING_MISSING");
  const owner = publication.registry.filter(s => s.enabled && s.operations.includes(operation));
  if (!(operations as readonly string[]).includes(operation) || owner.length !== 1 || owner[0].skill !== skill) return fail("UNPUBLISHED_OR_INCOMPATIBLE_OPERATION");
  if (!isAuditedPublication(publication) || catalog.publicationHash !== AUDITED_PUBLICATION_HASH || derivationCatalogHash(catalog) !== derivationCatalogHash(derivationCatalog)) return fail("CATALOG_DRIFT");
  return { ok: true, derivation: { dimension: "operation", operation, source: { skill, dimension, value }, catalogVersion: catalog.version,
    catalogHash: derivationCatalogHash(catalog), publicationHash: AUDITED_PUBLICATION_HASH, evidence: binding.evidence } };
}
