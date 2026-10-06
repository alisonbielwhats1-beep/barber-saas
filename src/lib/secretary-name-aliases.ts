import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { withTenant, type Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { assertCustomerAccess } from "./customer-catalog";
import { maskPhone } from "./client-identity";
import { foldName, withoutArticle } from "./name-search";

/** D1 learned aliases (owner item 1), behind SALON_SECRETARY_NAME_ALIASES (default off). When the owner CLICKS a candidate
 * of a suggestion or homonym card for a name the owner typed, the salon learns (kind, folded typed text → chosen id) and
 * the exact search's candidate set at that moment. Next time, when the exact/substring search for that folded text returns
 * nothing, or exactly the set the alias was learned from, the alias PROPOSES that entity: one highlighted option to confirm
 * ("Fabinho → Fábio Santos · (11) *****-0003 — confirmar?") plus "não é essa pessoa". It never resolves anything on its
 * own; the entity must still be active in the same salon; "não é essa pessoa" deletes the alias (OWNER/MANAGER, RLS) and
 * shows the ordinary card. Storage: prisma/sql/manual/027_secretary_state.sql ("SecretaryNameAlias", RLS by salon). */
export const nameAliasesEnabled = (env: Record<string, string | undefined> = process.env) => env.SALON_SECRETARY_NAME_ALIASES === "true";
export type AliasKind = "customer" | "professional" | "service";
export type AliasRef = "customer_ref" | "service_ref" | "professional_ref";
export const aliasKindOf = (ref: AliasRef): AliasKind => ref === "customer_ref" ? "customer" : ref === "service_ref" ? "service" : "professional";
/** The reserved option id of an alias card's refusal (entity ids are cuids/uuids: never this). */
export const ALIAS_REJECT_REF = "alias-not-this";
export const aliasRejectLabel = (kind: AliasKind) => kind === "service" ? "Não é esse serviço" : "Não é essa pessoa";
export const aliasQuestion = (typed: string, label: string) => `${typed.trim()} → ${label} — confirmar?`;
/** The alias card: the proposed entity first (highlighted on the screen), then the refusal. */
export const aliasCard = (ref: AliasRef, target: { id: string; label: string }) =>
  ({ kind: ref, source: "alias" as const, items: [{ id: target.id, name: target.label }, { id: ALIAS_REJECT_REF, name: aliasRejectLabel(aliasKindOf(ref)) }] });
/** The folded typed text an alias is keyed by: no leading article, accents or case; spaces collapsed. */
export function aliasKey(text: string | undefined) {
  if (typeof text !== "string") return undefined;
  const key = foldName(withoutArticle(text.trim())).replace(/\s+/g, " ").trim();
  return key.length >= 2 && key.length <= 200 ? key : undefined;
}
/** sha256 of the sorted, unique ids an exact/substring search returned (the empty set too). */
export const candidateSetHash = (ids: readonly string[]) => createHash("sha256").update(JSON.stringify([...new Set(ids)].sort())).digest("hex");

export type StoredAlias = { targetId: string; candidateSet: string | null };
export type AliasEntry = { kind: AliasKind; key: string; targetId: string; candidateSet: string | null };
/** Salon-wide storage. `forget` answers whether a row was deleted (RLS: only OWNER/MANAGER may delete). */
export interface NameAliasStore {
  find(actor: ServiceActor, kind: AliasKind, key: string): Promise<StoredAlias | undefined>;
  learn(actor: ServiceActor, entry: AliasEntry): Promise<void>;
  used(actor: ServiceActor, kind: AliasKind, key: string, targetId: string): Promise<void>;
  forget(actor: ServiceActor, kind: AliasKind, key: string, targetId: string): Promise<boolean>;
}
const kinds = z.enum(["customer", "professional", "service"]), keyShape = z.string().min(2).max(200), ref = z.string().min(1).max(100);
const hashShape = z.string().regex(/^[0-9a-f]{64}$/).nullable();
/** Tagged $queryRaw inside withTenant (RLS by salon; the learner is the authenticated user). */
export const postgresNameAliasStore: NameAliasStore = {
  async find(actor, kind, key) {
    const [row] = await withTenant(actor, tx => tx.$queryRaw<StoredAlias[]>`SELECT "targetId","candidateSet" FROM "SecretaryNameAlias"
      WHERE "salonId" = ${actor.salonId} AND "kind" = ${kinds.parse(kind)} AND "aliasFolded" = ${keyShape.parse(key)} LIMIT 1`);
    return row ? { targetId: row.targetId, candidateSet: row.candidateSet } : undefined;
  },
  async learn(actor, entry) {
    const kind = kinds.parse(entry.kind), key = keyShape.parse(entry.key), target = ref.parse(entry.targetId), set = hashShape.parse(entry.candidateSet);
    // The latest explicit pick for the same typed text wins; picking the same entity again counts as a use.
    await withTenant(actor, tx => tx.$queryRaw`INSERT INTO "SecretaryNameAlias" ("id","salonId","kind","aliasFolded","targetId","candidateSet","createdBy")
      VALUES (${randomUUID()}::uuid, ${actor.salonId}, ${kind}, ${key}, ${target}, ${set}, ${actor.userId})
      ON CONFLICT ("salonId","kind","aliasFolded") DO UPDATE SET "targetId" = EXCLUDED."targetId", "candidateSet" = EXCLUDED."candidateSet", "lastUsedAt" = now(),
        "useCount" = CASE WHEN "SecretaryNameAlias"."targetId" = EXCLUDED."targetId" THEN LEAST("SecretaryNameAlias"."useCount" + 1, 1000000000) ELSE 1 END
      RETURNING "id"`);
  },
  async used(actor, kind, key, targetId) {
    await withTenant(actor, tx => tx.$queryRaw`UPDATE "SecretaryNameAlias" SET "lastUsedAt" = now(), "useCount" = LEAST("useCount" + 1, 1000000000)
      WHERE "salonId" = ${actor.salonId} AND "kind" = ${kinds.parse(kind)} AND "aliasFolded" = ${keyShape.parse(key)} AND "targetId" = ${ref.parse(targetId)} RETURNING "id"`);
  },
  async forget(actor, kind, key, targetId) {
    const rows = await withTenant(actor, tx => tx.$queryRaw<{ id: string }[]>`DELETE FROM "SecretaryNameAlias"
      WHERE "salonId" = ${actor.salonId} AND "kind" = ${kinds.parse(kind)} AND "aliasFolded" = ${keyShape.parse(key)} AND "targetId" = ${ref.parse(targetId)} RETURNING "id"::text AS "id"`);
    return rows.length > 0;
  },
};
/** The same contract in memory (tests): rows per salon; `canDelete` stands for the OWNER/MANAGER delete policy. */
export class InMemoryNameAliasStore implements NameAliasStore {
  readonly rows = new Map<string, AliasEntry & { salonId: string; createdBy: string; useCount: number }>();
  constructor(private readonly canDelete: (actor: ServiceActor) => boolean = () => true) {}
  private id(actor: ServiceActor, kind: AliasKind, key: string) { return JSON.stringify([actor.salonId, kinds.parse(kind), keyShape.parse(key)]); }
  async find(actor: ServiceActor, kind: AliasKind, key: string) {
    const row = this.rows.get(this.id(actor, kind, key));
    return row ? { targetId: row.targetId, candidateSet: row.candidateSet } : undefined;
  }
  async learn(actor: ServiceActor, entry: AliasEntry) {
    const id = this.id(actor, entry.kind, entry.key), previous = this.rows.get(id);
    this.rows.set(id, { kind: entry.kind, key: entry.key, targetId: ref.parse(entry.targetId), candidateSet: hashShape.parse(entry.candidateSet), salonId: actor.salonId,
      createdBy: previous?.createdBy ?? actor.userId, useCount: previous?.targetId === entry.targetId ? previous.useCount + 1 : 1 });
  }
  async used(actor: ServiceActor, kind: AliasKind, key: string, targetId: string) {
    const row = this.rows.get(this.id(actor, kind, key));
    if (row?.targetId === targetId) row.useCount++;
  }
  async forget(actor: ServiceActor, kind: AliasKind, key: string, targetId: string) {
    const id = this.id(actor, kind, key);
    if (!this.canDelete(actor) || this.rows.get(id)?.targetId !== targetId) return false;
    return this.rows.delete(id);
  }
}
let active: NameAliasStore = postgresNameAliasStore;
/** Tests only: swap the storage; returns the restore function. */
export function useNameAliasStore(store: NameAliasStore) { const previous = active; active = store; return () => { active = previous; }; }

/** The entity behind an alias, only while it is still active in the actor's salon (a professional: eligible for the service
 * when one is given). Labels as the ordinary cards show them (a customer's phone masked). */
async function aliasTargetRow(tx: Tx, actor: ServiceActor, kind: AliasKind, id: string, context: { service_ref?: string }) {
  await assertCustomerAccess(tx, actor);
  const target = ref.parse(id);
  if (kind === "customer") {
    const row = await tx.clientProfile.findFirst({ where: { id: target, salonId: actor.salonId, mergedIntoId: null }, select: { id: true, name: true, phone: true } });
    const phone = row ? maskPhone(row.phone) : null;
    return row ? { id: row.id, label: `${row.name}${phone ? ` · ${phone}` : ""}` } : undefined;
  }
  if (kind === "service") {
    const row = await tx.service.findFirst({ where: { id: target, salonId: actor.salonId, active: true }, select: { id: true, name: true } });
    return row ? { id: row.id, label: row.name } : undefined;
  }
  const row = await tx.professional.findFirst({ where: { id: target, salonId: actor.salonId, active: true,
    ...(context.service_ref ? { services: { some: { serviceId: context.service_ref, service: { salonId: actor.salonId, active: true } } } } : {}) },
    select: { id: true, user: { select: { name: true } } } });
  return row?.user.name ? { id: row.id, label: row.user.name } : undefined;
}
/** The alias a typed name proposes, or undefined: only when the exact search returned nothing or exactly the learned set,
 * and only while its entity is still active here. Storage trouble never changes the turn (no alias then). */
export async function proposeAlias(actor: ServiceActor, kind: AliasKind, typed: string | undefined, searchedIds: readonly string[], context: { service_ref?: string } = {}) {
  const key = aliasKey(typed);
  if (!key || !nameAliasesEnabled()) return undefined;
  try {
    const alias = await active.find(actor, kind, key);
    if (!alias || (searchedIds.length > 0 && alias.candidateSet !== candidateSetHash(searchedIds))) return undefined;
    return await withTenant(actor, tx => aliasTargetRow(tx, actor, kind, alias.targetId, context));
  } catch { return undefined; }
}
/** Writes happen only on the owner's click (never on a model's choice), best-effort: a failure never fails the selection. */
export async function learnAlias(actor: ServiceActor, kind: AliasKind, typed: string | undefined, targetId: string, candidateSet: string) {
  const key = aliasKey(typed);
  if (!key || !nameAliasesEnabled()) return false;
  try { await active.learn(actor, { kind, key, targetId, candidateSet }); return true; } catch { return false; }
}
export async function aliasUsed(actor: ServiceActor, kind: AliasKind, typed: string | undefined, targetId: string) {
  const key = aliasKey(typed);
  if (!key || !nameAliasesEnabled()) return;
  try { await active.used(actor, kind, key, targetId); } catch { /* Usage counting never changes the selection. */ }
}
export async function forgetAlias(actor: ServiceActor, kind: AliasKind, typed: string | undefined, targetId: string) {
  const key = aliasKey(typed);
  if (!key || !nameAliasesEnabled()) return false;
  try { return await active.forget(actor, kind, key, targetId); } catch { return false; }
}
