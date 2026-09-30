import { searchSalonCustomer } from "./customer-catalog";
import { withTenant } from "./prisma-tenant";
// Static on purpose: a dynamic import fails under the tsx/cjs evaluation runtime.
import { listSchedulingServices } from "./scheduling-catalog";
import { directorySubsetProof, foldName } from "./name-search";
import { salonDirectoryNames } from "./entity-suggestions";
import type { ServiceActor } from "./service-catalog";

type Span = { start: number; end: number };
// Case and accents are not identity: "coloracao" in the message proves "Coloração".
const normalize = foldName;
const word = (character: string | undefined) => !!character && /[\p{L}\p{N}\p{M}_]/u.test(character);
/** Literal token-bounded mentions, not a Portuguese grammar/name parser. */
function spans(source: string, value: string): Span[] {
  const found: Span[] = [];
  if (!value) return found;
  for (let start = source.indexOf(value); start !== -1; start = source.indexOf(value, start + 1)) {
    const end = start + value.length;
    if (!word(source[start - 1]) && !word(source[end])) found.push({ start, end });
  }
  return found;
}

/** Never repairs, concatenates or resolves an identity based on rejected fragments. */
export function assertSeparateServiceMention(message: string, serviceName: string, customerNames: string[]) {
  const source = normalize(message);
  const services = spans(source, normalize(serviceName));
  const customers = customerNames.flatMap(name => spans(source, normalize(name)));
  if (!services.length || services.every(service => customers.some(customer =>
    service.start >= customer.start && service.end <= customer.end))) {
    throw Error("ENTITY_MENTION_CONFLICT");
  }
}

/** C7 (SALON_SECRETARY_NAME_SUGGESTIONS): a service name Luna expanded from the owner's words ("corte" → "Corte
 * Completo") that failed its literal proof is proven when the name's tokens the message holds OUTSIDE the customer's
 * name (same customer spans as the literal proof) are a subset of exactly one active service of the salon, and that
 * service is the name (directorySubsetProof). A typo, a fragment of the customer's name or a subset shared by two
 * services proves nothing: the service is asked as before. */
export async function serviceDirectoryProof(actor: ServiceActor, message: string, serviceName: string, customerName?: string) {
  const text = await withoutCustomerMentions(actor, message, customerName);
  const directory = await withTenant(actor, tx => salonDirectoryNames(tx, actor, "service"));
  return !!directory && directorySubsetProof(serviceName, text, directory);
}
/** The (folded) message with the customer's name blanked: the name the action carries and every matching customer row.
 * A directory proof (service or professional) never counts a token of the customer's own name ("Carla Lima" never
 * proves "Rodrigo Lima"). */
export async function withoutCustomerMentions(actor: ServiceActor, message: string, customerName?: string) {
  const customers = customerName ? await withTenant(actor, tx => searchSalonCustomer(tx, actor, customerName)) : [];
  const source = normalize(message), blank = source.split("");
  for (const name of [...customers.map(customer => customer.name), ...(customerName ? [customerName] : [])])
    for (const span of spans(source, normalize(name))) for (let i = span.start; i < span.end; i++) blank[i] = " ";
  return blank.join("");
}

export async function validateSchedulingEntityMentions(
  actor: ServiceActor, message: string,
  fields: { customer_name?: string; service_name?: string },
  selection?: {query:string;candidates:readonly {id:string;name:string}[]},
) {
  if (!fields.service_name) return;
  // Bounded, authorized catalog query only; customer identity is not service evidence.
  const customers = fields.customer_name
    ? await withTenant(actor, tx => searchSalonCustomer(tx, actor, fields.customer_name!)) : [];
  if(selection){
    const offered=selection.candidates.filter(row=>normalize(row.name)===normalize(fields.service_name!));
    const fresh=await withTenant(actor,tx=>listSchedulingServices(tx,actor,selection.query));
    // A short answer can witness the name Luna chose among the actual options.
    // Revalidate the complete choice set; no stale, invented or homonymous choice.
    if(offered.length===1&&fresh.length===selection.candidates.length&&fresh.every(row=>selection.candidates.some(old=>old.id===row.id&&old.name===row.name))){
      const selected=offered[0];
      const selectedText=normalize(selected.name),options=fresh.map(row=>normalize(row.name));
      let prefix=0,suffix=0;
      while(prefix<selectedText.length&&options.every(value=>value[prefix]===selectedText[prefix]))prefix++;
      while(suffix<selectedText.length-prefix&&options.every(value=>value.length-prefix>suffix&&value[value.length-1-suffix]===selectedText[selectedText.length-1-suffix]))suffix++;
      // Remove only text shared at the same edges of EVERY offered name. The
      // remainder is expanded to whole words, preserving all original punctuation.
      // A punctuation-only distinction must carry its adjacent identity words.
      let end=selectedText.length-suffix;
      if(prefix<end){
        if(word(selectedText[prefix-1])&&word(selectedText[prefix]))while(prefix>0&&word(selectedText[prefix-1]))prefix--;
        if(word(selectedText[end-1])&&word(selectedText[end]))while(end<selectedText.length&&word(selectedText[end]))end++;
        if(!/[\p{L}\p{N}]/u.test(selectedText.slice(prefix,end))){
          while(prefix>0&&word(selectedText[prefix-1]))prefix--;
          while(end<selectedText.length&&word(selectedText[end]))end++;
        }
      }
      const component=prefix<end?selectedText.slice(prefix,end):"";
      if(component){
        try{assertSeparateServiceMention(message,component,customers.map(row=>row.name));return;}catch{/* Full literal grounding below remains the fallback. */}
      }
    }
  }
  assertSeparateServiceMention(message, fields.service_name, customers.map(customer => customer.name));
}
