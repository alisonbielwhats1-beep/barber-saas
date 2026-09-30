import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { customerInput, customerPatch, type CustomerPatch, type CustomerDTO } from "./customer-contract";
import { clientIdentityData, potentialClientMatchWhere, maskPhone } from "./client-identity";
import { normalizePhone } from "./phone";
import { FOLD_FROM, FOLD_TO, foldedIds, foldedLikePattern, withoutArticle, withoutHonorific } from "./name-search";
import { NAME_TOKEN_SCAN, nameTokenQuery, nameTokensEnabled, tokenMatchedIds } from "./secretary-name-tokens";

export const customerSelect = { id: true, name: true, phone: true, email: true } as const;
export async function assertCustomerAccess(tx: Tx, actor: ServiceActor) {
  const salons = await tx.$queryRaw<{ accessStatus: string }[]>`SELECT "accessStatus" FROM "Salon" WHERE id=${actor.salonId} FOR SHARE`;
  const members = await tx.$queryRaw<{ role: string }[]>`SELECT role FROM "Membership" WHERE "salonId"=${actor.salonId} AND "userId"=${actor.userId} FOR SHARE`;
  if (salons[0]?.accessStatus !== "APPROVED" || !["OWNER", "MANAGER", "RECEPTIONIST"].includes(members[0]?.role ?? "")) throw new Error("FORBIDDEN");
}
const candidateSelect = { id: true, name: true, phone: true } as const;
const candidates = (rows: { id: string; name: string; phone: string | null }[]) => rows.map(r => ({ id: r.id, name: r.name, phone: maskPhone(r.phone) }));
/** T01: no auth fields fetched, bounded results; callers must disambiguate. C7: a leading article is not part of the
 * name ("a carla"); an honorific is searched as written and dropped only when nothing matches ("dona cida"). */
export async function searchSalonCustomer(tx: Tx, actor: ServiceActor, query: string) {
  await assertCustomerAccess(tx, actor);
  const term = withoutArticle(z.string().trim().min(2).max(200).parse(query)), rows = await customerRows(tx, actor, term);
  const bare = rows.length ? undefined : withoutHonorific(term);
  return bare ? customerRows(tx, actor, bare) : rows;
}
async function customerRows(tx: Tx, actor: ServiceActor, term: string) {
  const email = z.string().email().safeParse(term);
  // A malformed email cannot silently change identity role to a phone suffix.
  if(term.includes("@")&&!email.success)throw new Error("INVALID_EMAIL_REFERENCE");
  const digits = normalizePhone(term);
  // C5 (flag SALON_SECRETARY_WHOLE_NAME_MATCH): a name matches by whole tokens only ("Nara" never finds "Tainara"); phone digits keep
  // their path; same tenant scope, order and bound. Past the scan (undefined) the historical search below answers.
  const byTokens = email.success || !nameTokensEnabled() ? undefined : await customerTokenIds(tx, actor, term);
  if (byTokens) return byTokens.length || digits.length >= 4 ? candidates(await tx.clientProfile.findMany({ where: { salonId: actor.salonId, mergedIntoId: null,
    OR: [...(byTokens.length ? [{ id: { in: byTokens } }] : []), ...(digits.length >= 4 ? [{ phoneNormalized: { contains: digits } }, { phone: { contains: digits } }] : [])] },
    select: candidateSelect, orderBy: [{ name: "asc" }, { id: "asc" }], take: 21 })) : [];
  // Names match ignoring case and accents ("joao" finds "João"); same tenant scope and bound.
  const folded = email.success ? [] : foldedIds(await tx.$queryRaw`SELECT id FROM "ClientProfile" WHERE "salonId"=${actor.salonId} AND "mergedIntoId" IS NULL AND lower(translate(name, ${FOLD_FROM}, ${FOLD_TO})) LIKE lower(translate(${foldedLikePattern(term)}, ${FOLD_FROM}, ${FOLD_TO})) ESCAPE '\\' ORDER BY name, id LIMIT 21`);
  return candidates(await tx.clientProfile.findMany({ where: { salonId: actor.salonId, mergedIntoId: null,
    OR: email.success ? [{email:{equals:email.data.toLowerCase(),mode:"insensitive"}}] : [{ name: { contains: term, mode: "insensitive" } }, ...(folded.length ? [{ id: { in: folded } }] : []), ...(digits.length >= 4 ? [{ phoneNormalized: { contains: digits } }, { phone: { contains: digits } }] : [])] },
    select: candidateSelect, orderBy: [{ name: "asc" }, { id: "asc" }], take: 21 }));
}
/** C5: ids of this salon's unmerged customers whose name holds every token of `term` (secretary-name-tokens); the SQL only
 * prefilters by each written token as a folded substring. Undefined past the scan. */
async function customerTokenIds(tx: Tx, actor: ServiceActor, term: string) {
  const { tokens, patterns } = nameTokenQuery(term);
  return tokens.length ? tokenMatchedIds(tokens, await tx.$queryRaw`SELECT id, name FROM "ClientProfile" WHERE "salonId"=${actor.salonId} AND "mergedIntoId" IS NULL AND NOT EXISTS (SELECT 1 FROM unnest(${patterns}::text[]) AS t(pattern) WHERE lower(translate(name, ${FOLD_FROM}, ${FOLD_TO})) NOT LIKE lower(translate(t.pattern, ${FOLD_FROM}, ${FOLD_TO})) ESCAPE '\\') ORDER BY name, id LIMIT ${NAME_TOKEN_SCAN + 1}::int`) : [];
}
/** T02: fixed whitelist; no caller-controlled projection. */
export async function getCustomer(tx: Tx, actor: ServiceActor, customerRef: string) {
  await assertCustomerAccess(tx, actor);
  const customer = await tx.clientProfile.findFirst({ where: { id: z.string().min(1).max(100).parse(customerRef), salonId: actor.salonId, mergedIntoId: null }, select: customerSelect });
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
  return customer;
}
export async function customerSnapshot(tx: Tx, actor: ServiceActor, id: string, write = false) {
  await assertCustomerAccess(tx, actor);
  const rows = write
    ? await tx.$queryRaw<{ revision: string }[]>`SELECT xmin::text AS revision FROM "ClientProfile" WHERE id=${id} AND "salonId"=${actor.salonId} AND "mergedIntoId" IS NULL FOR UPDATE`
    : await tx.$queryRaw<{ revision: string }[]>`SELECT xmin::text AS revision FROM "ClientProfile" WHERE id=${id} AND "salonId"=${actor.salonId} AND "mergedIntoId" IS NULL FOR SHARE`;
  if (!rows.length) throw new Error("CUSTOMER_NOT_FOUND");
  return { customer: await getCustomer(tx, actor, id), revision: rows[0].revision };
}
export async function customerDuplicates(tx: Tx, actor: ServiceActor, fields: CustomerPatch, excludeId?: string) {
  await assertCustomerAccess(tx, actor);
  const where = potentialClientMatchWhere(actor.salonId, fields, excludeId);
  return where ? candidates(await tx.clientProfile.findMany({ where, select: candidateSelect, orderBy: { id: "asc" }, take: 21 })) : [];
}
export function normalizedCustomerPatch(input: unknown) {
  const parsed = customerPatch.parse(input);
  const data = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined)) as CustomerPatch;
  const identity = clientIdentityData(data);
  if (data.phone !== undefined) data.phone = identity.phone;
  if (data.email !== undefined) data.email = identity.email;
  return data;
}
export async function executeCustomerPatch(tx: Tx, actor: ServiceActor, input: unknown, target?: { id: string; revision: string }) {
  await assertCustomerAccess(tx, actor);
  // Serializes Secretary duplicate checks in this salon. Other legacy writers still use their existing checks.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customers:${actor.salonId}`},0))`;
  const patch = normalizedCustomerPatch(input);
  if (!Object.keys(patch).length) throw new Error("EMPTY_PATCH");
  const before = target ? await customerSnapshot(tx, actor, target.id, true) : undefined;
  if (before && before.revision !== target!.revision) throw new Error("CUSTOMER_CHANGED");
  const fields = customerInput.parse({ ...(before ? { name: before.customer.name, phone: before.customer.phone, email: before.customer.email } : {}), ...patch });
  if ((await customerDuplicates(tx, actor, fields, target?.id)).length) throw new Error("DUPLICATE_CANDIDATE");
  const data = { ...patch, ...(patch.phone !== undefined ? { phoneNormalized: clientIdentityData(patch).phoneNormalized } : {}) };
  if (!target) {
    // Prisma create supplies sessionVersion/createdAt itself. Keep auth columns outside
    // runtime grants: parameterized, fixed-column INSERT lets database defaults apply.
    const identity = clientIdentityData(patch);
    const rows = await tx.$queryRaw<CustomerDTO[]>`INSERT INTO "ClientProfile" (id,"salonId",name,phone,"phoneNormalized",email)
      VALUES (${randomUUID()},${actor.salonId},${fields.name},${identity.phone},${identity.phoneNormalized},${identity.email})
      RETURNING id,name,phone,email`;
    if (rows.length !== 1) throw new Error("CUSTOMER_CREATE_FAILED");
    return rows[0];
  }
  const result = await tx.clientProfile.updateMany({ where: { id: target.id, salonId: actor.salonId, mergedIntoId: null }, data });
  if (result.count !== 1) throw new Error("CUSTOMER_NOT_FOUND");
  return getCustomer(tx, actor, target.id);
}
