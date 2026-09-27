import { createHash } from "node:crypto";
import { z } from "zod";
import {inventorySourceScopes,type InventoryOperationScope,type InventoryReferenceEvidence} from "./inventory-source-scope";

/** This metadata is backend-owned. Executable fields contain only catalog units. */
export const inventoryQuantityResolution = z.object({
  status:z.enum(["ACCEPTED","NEEDS_INPUT"]), catalog_unit:z.literal("un"),
  quantity:z.number().int().min(1).max(100000).optional(),
  count:z.number().int().min(0).max(100000).optional(),
  expression:z.string().max(600).optional(),unit_text:z.string().max(200).optional(),
  cause:z.enum(["MISSING","UNIT_UNPROVEN","PRODUCT_UNPROVEN","VALUE_CONFLICT","COMPOUND_MEASURE","NEGATED","AMBIGUOUS","PROOF_INVALID"]).optional(),
  basis:z.enum(["EXPLICIT_UNIT","PRODUCT_COUNT","CLARIFICATION"]).optional(),
  source_hash:z.string().length(64).optional(),
  identity_status:z.enum(["UNRESOLVED","CONFLICT"]).optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.status==="ACCEPTED"&&(!value.quantity||!value.basis||!value.source_hash))ctx.addIssue({code:"custom",message:"QUANTITY_PROOF_REQUIRED"});
  if(value.status==="NEEDS_INPUT"&&value.quantity!==undefined)ctx.addIssue({code:"custom",message:"PENDING_QUANTITY_NOT_EXECUTABLE"});
});
export type InventoryQuantityResolution=z.infer<typeof inventoryQuantityResolution>;
export type InventoryQuantityContext={draft_ref:string;draft_revision:number;expires_at:string;product_ref:string;product_revision?:string;unit:"un";requested_field?:"quantity";published_question?:string};
/** Fresh, independently validated action scopes. Never persisted or supplied as model authority. */
export type InventoryQuantityWitness={quantity:number;literal:string;product_name:string;source_scope?:string|null;reference?:InventoryReferenceEvidence|null;reason?:string|null};
const normalize=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const values:Record<string,number>={zero:0,um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90,cem:100,cento:100,duzentos:200,duzentas:200,trezentos:300,trezentas:300,quatrocentos:400,quatrocentas:400,quinhentos:500,quinhentas:500,seiscentos:600,seiscentas:600,setecentos:700,setecentas:700,oitocentos:800,oitocentas:800,novecentos:900,novecentas:900};
function underHundred(tokens:string[]):number{
  const first=values[tokens[0]];
  if(tokens.length===1&&first!==undefined&&first<100)return first;
  if(tokens.length===3&&tokens[1]==="e"&&first>=20&&first<100&&first%10===0){
    const unit=values[tokens[2]];if(unit>0&&unit<10)return first+unit;
  }
  return NaN;
}
function underThousand(tokens:string[]):number{
  const small=underHundred(tokens);if(Number.isFinite(small))return small;
  const first=values[tokens[0]];
  if(first===undefined||first<100)return NaN;
  if(tokens.length===1&&tokens[0]!=="cento")return first;
  if(tokens[0]!=="cem"&&tokens[1]==="e"){
    const rest=underHundred(tokens.slice(2));if(rest>0&&rest<100)return first+rest;
  }
  return NaN;
}
function cardinal(text:string):number{
  const prefix=/^(?:menos\b\s*|[+\p{Pd}−]\s*)/u.exec(text);
  const magnitude=prefix?text.slice(prefix[0].length):text;
  if(/^(?:menos\b|[+\p{Pd}−])/u.test(magnitude))return NaN;
  return (prefix&&!prefix[0].startsWith("+")?-1:1)*unsignedCardinal(magnitude);
}
function unsignedCardinal(text:string):number{
  // pt-BR: dot groups thousands; comma is the decimal separator. A malformed
  // group/fraction stays one invalid atom, never a valid numeric substring.
  if(/^\d+(?:,\d+)?$/.test(text))return Number(text.replace(",","."));
  if(/^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/.test(text))return Number(text.replaceAll(".","").replace(",","."));
  if(/[\d.,/]/.test(text))return NaN;
  const tokens=text.split(/\s+/),scale=tokens.indexOf("mil");
  if(scale<0)return underThousand(tokens);
  if(tokens.lastIndexOf("mil")!==scale)return NaN;
  const thousands=scale===0?1:underThousand(tokens.slice(0,scale));
  const rest=tokens.slice(scale+1);if(rest[0]==="e")rest.shift();
  const remainder=rest.length?underThousand(rest):0;
  return thousands>0&&thousands<=100&&Number.isFinite(remainder)?thousands*1000+remainder:NaN;
}
const word=Object.keys(values).join("|");
// Factual number operators, not operation/intent language. Unknown exactness
// never becomes an executable count by discarding its prefix.
const numberQualifier="(?:menos|mais|maior|menor)(?:\\s+(?:de|que|do\\s+que))?|ate|minim[oa]s?|maxim[oa]s?|aproximadamente|aproximad[oa]s?|cerca|torno|volta|quase|uns|umas|estimad[oa]s?|entre|pouco";
const quantityOperator=new RegExp(`\\b(?:${numberQualifier})\\b`,"u");
function counts(text:string){
  const pattern=new RegExp(`(?<![\\p{L}\\p{N}.,/\\p{Sm}\\p{Pd}])(?:[\\p{Sm}\\p{Pd}]\\s*|(?:${numberQualifier})\\b(?:\\s|[:=])*(?:de\\s+)*)*(\\d+(?:[.,]\\d+)*(?:\\s*/\\s*[\\p{Sm}\\p{Pd}]?\\d+(?:[.,]\\d+)*)?|(?:${word}|mil)(?:\\s+(?:(?:e\\s+)?(?:${word}|mil)))*\\b)`,"gu");
  return [...text.matchAll(pattern)].map(match=>{const value=cardinal(match[0]);return {from:match.index!,to:match.index!+match[0].length,text:match[0],value,magnitudeValid:Number.isFinite(unsignedCardinal(match[1])),kind:Number.isFinite(value)?"EXACT" as const:"NON_EXACT" as const};});
}
// Explicit units of abstract activity and discourse. This is a dimension
// registry like currency/duration, not verbs, intent detection, or packaging.
// Generic collections (items/things/units) cannot establish this dimension.
const discourseUnit=/^\s*(?:acao|acoes|alteracao|alteracoes|ajustes?|mudancas?|tarefas?|observacao|observacoes|anotacao|anotacoes|comentarios?|instrucao|instrucoes|recados?)\b/;
type NumericRange={from:number;to:number};
function independentStatementStart(text:string){
  const boundaries=[...text.matchAll(/[;!?]|\.(?=\s|$)/g)],last=boundaries[boundaries.length-1];
  return last?last.index!+1:0;
}
function discoursePreludeDimensions(syntax:string,current:NumericRange|undefined,protectedFacts:readonly NumericRange[],operations:readonly NumericRange[]){
  if(!current)return [];
  const prefix=syntax.slice(0,current.from),separator=/:\s*$/.exec(prefix);
  if(!separator)return [];
  const to=separator.index,head=prefix.slice(0,to);
  const from=independentStatementStart(head);
  if([...protectedFacts,...operations].some(span=>span.from<to&&span.to>from))return [];
  const body=syntax.slice(from,to),atoms=counts(body);
  // Preserve the complete preamble whenever its dimension or exactness is
  // mixed. A typed text count never authorizes clipping an external factor,
  // stock unit, limit, negation, catalog identity, or unclassified numeral.
  if(!atoms.length||quantityOperator.test(body)||/\b(?:nao|nunca|jamais|nem|nenhum|nenhuma|cada|por|pel[oa]s?|vezes|dobro|triplo|metade|x|unidades?|un)\b|[\p{Sm}\p{Pd}*/]/u.test(body))return [];
  const measures=atoms.map(atom=>{
    const unit=discourseUnit.exec(body.slice(atom.to));
    return atom.kind==="EXACT"&&Number.isSafeInteger(atom.value)&&atom.value>=0&&unit?{from:from+atom.from,to:from+atom.to+unit[0].length}:undefined;
  });
  return measures.every((span):span is NumericRange=>span!==undefined)?measures:[];
}
const escapePattern=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const totalSuffix=/^\s*(?:,\s*)?(?:ao\s+todo|no\s+total)\b/;
function completeIdentityBoundary(remaining:string){
  if(!remaining.trim())return true;
  // Punctuation followed immediately by identifier content is not a sentence
  // boundary (2.0, X.Pro, X:Pro). Unknown attached continuations fail closed.
  if(/^\s*[;:.!?)]+(?=\s|$)/.test(remaining))return true;
  if(/^\s*,\s+(?:no\s+)?(?:total|totalizando|somando)\b/.test(remaining))return true;
  if(totalSuffix.test(remaining))return true;
  return /^\s+(?:e|mas)\b/.test(remaining)&&(counts(remaining).length>0||/^\s*(?:e|mas)\s*$/.test(remaining));
}
const quotePairs:Record<string,string>={'"':'"',"'":"'","“":"”","‘":"’","«":"»"};
function namePattern(name:string){
  const tokens=normalize(name).trim().match(/[\p{L}\p{N}]+|\s+|[^\s\p{L}\p{N}]+/gu)??[];
  return tokens.map(token=>{
    if(/^\s+$/.test(token))return "\\s+";
    if(!/^\p{L}{3,}$/u.test(token))return escapePattern(token);
    const forms=[token,token+"s",...(token.endsWith("s")?[token.slice(0,-1)]:[])].sort((a,b)=>b.length-a.length);
    return `(?:${forms.map(escapePattern).join("|")})`;
  }).join("");
}
/** Number agreement is linguistic evidence only. Identifier punctuation is exact. */
function productPrefix(text:string,names:readonly string[]){
  for(const name of [...names].sort((a,b)=>b.length-a.length)){
    const pattern=namePattern(name);
    const close=quotePairs[text[0]],patterns=close?[pattern,escapePattern(text[0])+pattern+escapePattern(close)]:[pattern];
    for(const candidate of patterns){
      const match=candidate?new RegExp("^"+candidate,"u").exec(text):null;
      if(match&&completeIdentityBoundary(text.slice(match[0].length)))return match[0].length;
    }
  }
}
function lexicalProductMentions(text:string,catalog:readonly {id:string;name:string}[]){
  return catalog.flatMap(product=>[...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${namePattern(product.name)}(?![\\p{L}\\p{N}]|[^\\s\\p{L}\\p{N}][\\p{L}\\p{N}])`,"gu"))].map(match=>({from:match.index!,to:match.index!+match[0].length,...product})))
    .filter((span,_index,all)=>!all.some(other=>other.from<=span.from&&other.to>=span.to&&(other.from<span.from||other.to>span.to)));
}
/** A prefix is only contradiction evidence, never a resolved product reference. */
function productReferencePrefixes(text:string,names:readonly string[]){
  return names.flatMap(name=>[...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${namePattern(name)}`,"gu"))]
    .map(match=>({from:match.index!,to:match.index!+match[0].length})));
}
/** A measure owns its attached nominal reference, not every homonymous token. */
function measureReferenceSpans(text:string,names:readonly string[],proof:string|undefined){
  const references=productReferencePrefixes(text,names);
  const proofRanges=proof?[...text.matchAll(new RegExp(escapePattern(proof),"g"))].map(match=>({from:match.index!,to:match.index!+proof.length})):[];
  return numericFacts(text).inventory.flatMap(atom=>{
    const unit=catalogUnit(text.slice(atom.to));
    const gap=connectors.exec(text.slice(atom.to+(unit?.[0].length??0)))![0];
    const from=atom.to+(unit?.[0].length??0)+gap.length;
    return references.filter(reference=>reference.from===from&&(
      !!unit&&!!gap.trim()||proofRanges.some(range=>atom.from>=range.from&&reference.to<=range.to)));
  });
}
function productMentions(text:string,names:readonly string[]){
  return [...text.matchAll(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu)].flatMap(match=>{const end=productPrefix(text.slice(match.index),names);return end?[{from:match.index!,to:match.index!+end}]:[];});
}
/** Protected identity spans cannot act as numbers, punctuation or operators. */
function outsideProductNames(text:string,mentions:ReturnType<typeof productMentions>){
  const chars=text.split("");for(const mention of mentions)for(let i=mention.from;i<mention.to;i++)chars[i]=" ";return chars.join("");
}
/** Dimensions are literal facts, never labels supplied by an action/model. */
function numericFacts(syntax:string){
  const spans:{from:number;to:number}[]=[];
  const dateValid=(year:number,month:number,day:number)=>{
    const date=new Date(Date.UTC(year,month-1,day));
    return year>=1000&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
  };
  const complete=/(?<![\p{L}\p{N}.,/:\p{Sm}\p{Pd}])(?:\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{1,2}:\d{2})(?![\p{L}\p{N}/:\p{Sm}\p{Pd}]|[.,][\p{L}\p{N}])/gu;
  for(const match of syntax.matchAll(complete)){
    const value=match[0];let valid=false;
    if(value.includes(":")){const [hour,minute]=value.split(":").map(Number);valid=hour<24&&minute<60;}
    else if(value.includes("/")){const [day,month,year]=value.split("/").map(Number);valid=dateValid(year,month,day);}
    else {const [year,month,day]=value.split("-").map(Number);valid=dateValid(year,month,day);}
    if(valid)spans.push({from:match.index!,to:match.index!+value.length});
  }
  const inventory=counts(syntax).filter(atom=>{
    if(spans.some(span=>atom.from>=span.from&&atom.to<=span.to))return false;
    // A qualified but well-formed count can belong to another dimension. A
    // malformed numeral cannot gain that exemption (e.g. the price R$2.00).
    if(!atom.magnitudeValid)return true;
    const before=syntax.slice(0,atom.from),after=syntax.slice(atom.to);
    const currencyPrefix=/(?:\br\$|\bbrl)\s*$/.exec(before),currencySuffix=/^\s*(?:reais|real|centavos?)\b/.exec(after);
    const duration=/^\s*(?:minutos?|min|horas?|segundos?|seg)\b/.exec(after);
    // Counts of existing ERP objects have their own dimension. This does not
    // decide whether um/uma is an article, nor recognize operation verbs.
    // A proved Product name has already been protected before this classifier.
    const object=/^\s*(?:servicos?|comandas?|agendamentos?|clientes?|profissional|profissionais)\b/.exec(after);
    const suffix=currencySuffix??duration??object;
    if(currencyPrefix||suffix){spans.push({from:currencyPrefix?.index??atom.from,to:atom.to+(suffix?.[0].length??0)});return false;}
    return true;
  });
  return {inventory,dimensions:spans};
}
const inventoryCounts=(syntax:string)=>numericFacts(syntax).inventory;
export function sourceHasInventoryCount(source:string|undefined,names:readonly string[]){
  if(source===undefined)return false;
  const text=normalize(source),mentions=productMentions(text,names);
  return inventoryCounts(outsideProductNames(text,mentions)).length>0;
}
const connectors=/^\s*(?:(?:de|do|da|dos|das|no|na|nos|nas|o|a|os|as)\s+)*/;
const catalogUnit=(text:string)=>/^\s*(?:unidades?\b|un\b\.?)/.exec(text);
// Factual dimensions, not operation/reason vocabulary. A denominator remains a
// rate even when the model calls it a reason. Protected catalog names have
// already been removed from this role before inspecting these unit heads.
const dimensionHead=/^\s*(?:(?:cada|o|a|os|as|um|uma)\s+)*(?:unidades?|un|servicos?|comandas?|agendamentos?|clientes?|profissional|profissionais|caixas?|pacotes?|sacos?|frascos?|conjuntos?|latas?|garrafas?|potes?|tambores?|ampolas?|cartelas?|rolos?|fardos?|bandejas?|lotes?|pares?|duzias?|centenas?|milhares?|quilogramas?|quilos?|gramas?|miligramas?|litros?|mililitros?|metros?|centimetros?|milimetros?|doses?|kg|g|mg|l|ml|m|cm|mm|horas?|minutos?|segundos?)\b/;
/** A following distribution clause explains an explicit total; it never
 * supplies one. Keep its own first numeric atom separate from later counts. */
function distributionClauseStart(text:string,from:number,to:number){
  const prefix=text.slice(from,to),links=[...prefix.matchAll(/,\s*cada\b/g)],last=links[links.length-1];
  if(!last)return;
  const head=prefix.slice(last.index!+last[0].length);
  // "Cada" supplies the distribution relation. The head need not belong to a
  // container vocabulary: no conversion is performed, and the total is already
  // independently literal. Another numeric atom cannot borrow this relation.
  if(/\p{L}/u.test(head)&&counts(head).length===0)return from+last.index!;
}
function measureTail(text:string,syntax=text){
  const unitEnd=catalogUnit(text)?.[0].length??0,separator=syntax.slice(unitEnd).search(/[;.!?]/);
  return separator<0?text:text.slice(0,unitEnd+separator);
}
export function inventoryProductInSource(source:string|undefined,names:readonly string[]){
  if(!source)return false;
  const text=normalize(source);
  return productMentions(text,names).length>0;
}
export function inventoryProductCorrectionInSource(source:string|undefined,names:readonly string[]){
  if(!inventoryProductInSource(source,names))return false;
  const text=normalize(source!),mentions=productMentions(text,names);
  const syntax=outsideProductNames(text,mentions);
  return !/\b(?:nao|nunca|jamais|nem)\b/.test(syntax)&&inventoryCounts(syntax).length===0;
}
export function missingInventoryQuantity():InventoryQuantityResolution{return {status:"NEEDS_INPUT",catalog_unit:"un",cause:"MISSING"};}
type QuantityInput={quantity:number;literal?:string|null;source?:string;product_names:readonly string[];context?:InventoryQuantityContext;now?:Date;sibling_witnesses?:readonly InventoryQuantityWitness[];
  source_scope?:string|null;reference?:InventoryReferenceEvidence|null;reason?:string|null;operation_scopes?:readonly InventoryOperationScope[];catalog?:readonly {id:string;name:string}[]};
/** Validate a measure, not the operation or intent. No packaging conversions exist. */
export function groundInventoryQuantity(input:QuantityInput):InventoryQuantityResolution{return groundMeasure(input,false);}
function groundMeasure(input:QuantityInput,independentScope:boolean):InventoryQuantityResolution{
  const {quantity,source,literal}=input;
  const sourceHash=source===undefined?undefined:createHash("sha256").update(source).digest("hex");
  const pending=(cause:InventoryQuantityResolution["cause"],expression=literal??source,count?:number,unit?:string):InventoryQuantityResolution=>({
    status:"NEEDS_INPUT",catalog_unit:"un",cause,...(expression?{expression:expression.slice(0,600)}:{}),
    ...(count!==undefined&&Number.isInteger(count)&&count>=0&&count<=100000?{count}:{}),...(unit?{unit_text:unit.slice(0,200)}:{}),...(sourceHash?{source_hash:sourceHash}:{})});
  if(source===undefined||!source.trim())return pending("PROOF_INVALID");
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100000)return pending("VALUE_CONFLICT");
  if(literal!=null&&(!literal.trim()||!source.includes(literal)))return pending("PROOF_INVALID");
  const text=normalize(source), proof=literal==null?undefined:normalize(literal);
  const scopes=inventorySourceScopes(source,{scope:input.source_scope,reason:input.reason,reference:input.reference,others:input.operation_scopes});
  if(!scopes.valid)return {...pending("PROOF_INVALID"),...(input.context?{identity_status:"UNRESOLVED" as const}:{})};
  const normalizedRange=(range:{from:number;to:number})=>({from:normalize(source.slice(0,range.from)).length,to:normalize(source.slice(0,range.to)).length});
  const exclusions=scopes.identityExclusions.map(normalizedRange),named=scopes.named&&normalizedRange(scopes.named);
  const catalog=lexicalProductMentions(text,input.catalog??[]);
  const querySpans=lexicalProductMentions(text,input.product_names.map(name=>({id:"query",name})));
  const moreSpecific=catalog.some(actual=>querySpans.some(query=>actual.from===query.from&&actual.to>query.to));
  const currentConflict=!!input.context?.product_ref&&(input.reference?.kind==="CURRENT_FIELD"||input.context.requested_field==="quantity")&&catalog.some(actual=>actual.id!==input.context?.product_ref&&!exclusions.some(span=>actual.from>=span.from&&actual.to<=span.to));
  // A semantic boundary may exclude a whole sibling reference, but cannot
  // consume part of an identifier recognized in the original source. This
  // protects factual name tokens even without a NAMED hint, before masking.
  const splitReference=[...catalog,...querySpans].some(reference=>exclusions.some(span=>
    span.from<reference.to&&span.to>reference.from&&!(span.from<=reference.from&&span.to>=reference.to)));
  // Derived separator bytes are not the sibling's literal content. They must
  // never consume even an entire reference attached to the original measure.
  const extensions=scopes.boundaryExtensions.map(normalizedRange);
  const consumedMeasureReference=measureReferenceSpans(text,input.product_names,proof).some(reference=>
    extensions.some(span=>span.from<reference.to&&span.to>reference.from));
  if(moreSpecific||currentConflict||splitReference||consumedMeasureReference)return {...pending("PRODUCT_UNPROVEN"),identity_status:"CONFLICT"};
  const identityText=outsideProductNames(text,exclusions);
  if(named&&(productPrefix(text.slice(named.from,named.to),input.product_names)!==named.to-named.from||exclusions.some(span=>named.from<span.to&&named.to>span.from)))return {...pending("PRODUCT_UNPROVEN"),identity_status:"CONFLICT"};
  const mentions=[...productMentions(text,input.product_names),...productMentions(identityText,input.product_names)].filter((span,index,all)=>all.findIndex(other=>other.from===span.from&&other.to===span.to)===index);
  const syntax=outsideProductNames(text,mentions);
  const currentRange=scopes.current&&normalizedRange(scopes.current),siblingScopes=scopes.siblings.map(normalizedRange);
  const facts=numericFacts(syntax);
  const discourseDimensions=discoursePreludeDimensions(syntax,currentRange,[...catalog,...querySpans,...facts.dimensions],siblingScopes);
  facts.inventory=facts.inventory.filter(atom=>!discourseDimensions.some(span=>atom.from>=span.from&&atom.to<=span.to));
  facts.dimensions.push(...discourseDimensions);
  const occurrences=facts.inventory;
  const context=input.context;
  const live=context&&context.unit==="un"&&context.product_ref&&context.draft_ref&&Number.isInteger(context.draft_revision)&&context.draft_revision>0&&Date.parse(context.expires_at)>(input.now??new Date()).getTime();
  // The server's targeted pending field already binds a reply. A model tag may
  // describe that relation but cannot create it or be required to duplicate it.
  const currentField=input.reference?.kind!=="NAMED"&&live&&/^[a-f0-9]{64}$/i.test(context.product_revision??"")&&context.requested_field==="quantity"&&/\bunidades?\b/.test(normalize(context.published_question??""));
  // A targeted reply may omit the product, but cannot override an explicit
  // identifier whose literal continuation contradicts the accepted reference.
  if((currentField||input.reference?.kind==="CURRENT_FIELD")&&productReferencePrefixes(identityText,input.product_names).some(prefix=>
    // A catalog name can itself be a cardinal. An occurrence inside a literal
    // count+unit has the numeric role, not an asserted product identifier.
    !occurrences.some(atom=>prefix.from>=atom.from&&prefix.to<=atom.to&&catalogUnit(text.slice(atom.to)))&&
    !mentions.some(mention=>prefix.from>=mention.from&&prefix.to<=mention.to))){
    return {...pending("PRODUCT_UNPROVEN"),identity_status:"CONFLICT"};
  }
  if(input.reference?.kind==="CURRENT_FIELD"&&!currentField){
    // A model hint cannot create a binding or contradict an independently
    // proved name. Without either proof, no quantity becomes executable.
    const own=scopes.current&&normalizedRange(scopes.current);
    const independentName=mentions.some(mention=>(!own||mention.from>=own.from&&mention.to<=own.to)&&
      !exclusions.some(span=>mention.from<span.to&&mention.to>span.from));
    if(!independentName)return {...pending(context?"PROOF_INVALID":"PRODUCT_UNPROVEN"),identity_status:"UNRESOLVED"};
  }
  if(!live&&!mentions.length)return pending("PRODUCT_UNPROVEN",literal??source,occurrences.find(atom=>atom.value===quantity)?.value);
  const proofs=proof===undefined?[{from:0,to:text.length}]:[...text.matchAll(new RegExp(proof.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"g"))].map(match=>({from:match.index!,to:match.index!+proof.length}));
  const ownedProofs=proofs.filter(range=>proof===undefined||
    (!currentRange||range.from>=currentRange.from&&range.to<=currentRange.to)&&!siblingScopes.some(span=>range.from<span.to&&range.to>span.from));
  if(!ownedProofs.length)return pending("PROOF_INVALID");
  const bare=text.trim().replace(/[.!?]+$/,"");
  const bareCount=counts(bare);
  if(bareCount.length===1&&bareCount[0].from===0&&bareCount[0].to===bare.length&&bareCount[0].value===quantity&&live&&
    context.requested_field==="quantity"&&/\bunidades?\b/.test(normalize(context.published_question??""))){
    const from=text.length-text.trimStart().length,to=from+bare.length;
    if(!ownedProofs.some(range=>from>=range.from&&to<=range.to)||currentRange&&(from<currentRange.from||to>currentRange.to)||siblingScopes.some(span=>from<span.to&&to>span.from))return pending("PROOF_INVALID");
    return {status:"ACCEPTED",catalog_unit:"un",quantity,basis:"CLARIFICATION",expression:source.slice(0,600),source_hash:sourceHash!};
  }
  const candidates=occurrences.filter(atom=>ownedProofs.some(range=>atom.from>=range.from&&atom.to<=range.to)&&(!currentRange||atom.from>=currentRange.from&&atom.to<=currentRange.to)&&!siblingScopes.some(span=>atom.from<span.to&&atom.to>span.from));
  const siblingRanges=independentScope?[]:(input.sibling_witnesses??[]).flatMap(witness=>{
    const scopeStart=witness.source_scope?source.indexOf(witness.source_scope):0;
    const scopeEnd=witness.source_scope?scopeStart+witness.source_scope.length:source.length;
    const start=source.indexOf(witness.literal,scopeStart),next=source.indexOf(witness.literal,start+1);
    if(scopeStart<0||start<0||start+witness.literal.length>scopeEnd||next>=0&&next+witness.literal.length<=scopeEnd)return [];
    if(!witness.reference&&!inventoryProductInSource(witness.literal,[witness.product_name]))return [];
    const others=[...(input.operation_scopes??[]).filter(scope=>scope.literal!==witness.source_scope),
      ...(input.source_scope&&input.source_scope!==witness.source_scope?[{key:"$current",operation:"stock.movement",literal:input.source_scope}]:[])];
    const grounded=groundMeasure({quantity:witness.quantity,literal:witness.literal,source,product_names:[witness.product_name],now:input.now,
      source_scope:witness.source_scope,reference:witness.reference,reason:witness.reason,catalog:input.catalog,operation_scopes:others},true);
    return grounded.status==="ACCEPTED"?[{from:normalize(source.slice(0,start)).length,to:normalize(source.slice(0,start+witness.literal.length)).length,value:witness.quantity}]:[];
  });
  const accepted:InventoryQuantityResolution[]=[];let rejected=pending("UNIT_UNPROVEN");
  for(const atom of candidates){
    const originalPrefix=syntax.slice(0,atom.from);
    const statementStart=independentStatementStart(originalPrefix);
    const statementPrefix=originalPrefix.slice(statementStart),colon=statementPrefix.lastIndexOf(":");
    const prelude=colon<0?"":statementPrefix.slice(0,colon);
    // A colon does not prove that an unknown noun is an action heading rather
    // than a measure. Preserve any attached numeric/operator prelude, even if
    // the proposed own scope starts at a later verb. Only a strong independent
    // separator releases it; no dictionary of container/heading nouns is used.
    const untypedPrelude=counts(prelude).some(value=>!discourseDimensions.some(span=>value.from+statementStart>=span.from&&value.to+statementStart<=span.to));
    if(prelude&&(untypedPrelude||quantityOperator.test(prelude)||/(?<![\p{L}\p{N}])[\p{Sm}\p{Pd}]+(?![\p{L}\p{N}])/u.test(prelude))){
      rejected=pending("PROOF_INVALID",literal??source,atom.value);continue;
    }
    const next=occurrences.find(other=>other.from>atom.from),originalPrevious=[...occurrences].reverse().find(other=>other.from<atom.from);
    const outsidePrevious=originalPrevious&&currentRange&&originalPrevious.to<=currentRange.from;
    const originalBridge=originalPrevious?syntax.slice(originalPrevious.to,atom.from):"";
    // A heading's cardinality is not a factor of this action. Only an actual
    // separator permits locality; dimensions/operators across it remain facts
    // of the original, uncut source (e.g. "duas caixas: três unidades").
    const independentPrefix=outsidePrevious&&/[;:.!?]\s*$/.test(text.slice(originalPrevious.to,currentRange.from));
    const relatedPrefix=dimensionHead.test(originalBridge)||/\b(?:vezes|cada|por)\b|[×*]|\bx\b/.test(originalBridge)||originalBridge.lastIndexOf("(")>originalBridge.lastIndexOf(")");
    const previous=independentPrefix&&!relatedPrefix?undefined:originalPrevious;
    const prefix=syntax.slice(0,atom.from), clauseStart=Math.max(prefix.lastIndexOf("."),prefix.lastIndexOf(";"),prefix.lastIndexOf(","),prefix.lastIndexOf("!"),prefix.lastIndexOf("?"))+1;
    const after=text.slice(atom.to,next?.from??text.length),tail=measureTail(after,syntax.slice(atom.to,next?.from??text.length));
    const expression=source.slice(atom.from,atom.to+tail.length).trim();
    const unit=catalogUnit(tail);
    const rest=unit?tail.slice(unit[0].length):tail;
    const gap=connectors.exec(rest)![0], productEnd=productPrefix(identityText.slice(atom.to+(unit?.[0].length??0)+gap.length),input.product_names);
    const product=productEnd!==undefined?{to:atom.to+(unit?.[0].length??0)+gap.length+productEnd}:undefined;
    if(/\b(?:nao|nunca|jamais|nem)\b/.test(syntax.slice(clauseStart,atom.from))){rejected=pending("NEGATED",expression,atom.value);continue;}
    // Multipliers/ratios relate two measures; an inner number is not their total.
    const bridge=previous?text.slice(previous.to,atom.from):text.slice(clauseStart,atom.from);
    const bridgeSyntax=syntax.slice(previous?.to??clauseStart,atom.from),grouped=bridgeSyntax.lastIndexOf("(")>bridgeSyntax.lastIndexOf(")");
    // Total is an operator attached to this measure, on either side. The value
    // must still be literally present; packaging arithmetic is never inferred.
    const aggregate=/\b(?:total|totalizando|somando)\s*(?:(?:de|sao|e)\s*|:\s*)*$/.test(prefix)||
      !!unit&&totalSuffix.test(text.slice(product?.to??atom.to+unit[0].length));
    const previousUnit=previous&&catalogUnit(bridge)!==null;
    const previousDirect=previous&&productPrefix(bridge.slice(connectors.exec(bridge)![0].length),input.product_names)!==undefined;
    // A semantic role can delimit identity, never remove a numeric operator.
    const roleBounded=!!input.reference||!!input.source_scope||scopes.identityExclusions.length>0;
    const nextRole=scopes.siblings.map(normalizedRange).filter(span=>span.from>atom.to).sort((a,b)=>a.from-b.from)[0];
    const explanation=aggregate&&next?distributionClauseStart(syntax,atom.to,next.from):undefined;
    const factorEnd=Math.min(explanation??text.length,roleBounded?Math.min(nextRole?.from??text.length,atom.to+tail.length):product?.to??atom.to+tail.length);
    const factorTail=syntax.slice(atom.to,factorEnd),causalRole=scopes.reason&&normalizedRange(scopes.reason);
    const ratio=[...factorTail.matchAll(/\b(?:por|pel[oa]s?)\b/g)].some(match=>{
      const at=atom.to+match.index!;
      const denominator=syntax.slice(at+match[0].length),first=counts(denominator)[0];
      return causalRole?.from!==at||dimensionHead.test(denominator)||!!first&&first.from===denominator.length-denominator.trimStart().length;
    });
    if(!aggregate&&previous&&(grouped||!previousUnit&&!previousDirect)&&!/[;.!?]/.test(bridgeSyntax)||
       ratio||/\b(?:cada|vezes)\b|[×*]|\bx\s*$/.test(factorTail)||/\bcada\b/.test(syntax.slice(clauseStart,atom.from))){rejected=pending("COMPOUND_MEASURE",expression,atom.value);continue;}
    if(atom.kind!=="EXACT"||!Number.isInteger(atom.value)||atom.value!==quantity){rejected=pending("VALUE_CONFLICT",expression,atom.value);continue;}
    // A unit proves dimension, not product identity. Its attached complement
    // cannot name a different product and be clipped out of the witness.
    if(unit&&!product&&rest.slice(gap.length).trim()&&!currentField){
      rejected=pending("PRODUCT_UNPROVEN",expression,atom.value);continue;
    }
    const requiredEnd=unit?atom.to+unit[0].length:product?.to;
    if(!requiredEnd){rejected=pending("UNIT_UNPROVEN",expression,atom.value,tail.trim().split(/\s+/)[0]);continue;}
    // The quantity literal can be just count+unit; its action scope must also
    // contain any attached identity that supplies the factual measure binding.
    if(currentRange&&(product?.to??requiredEnd)>currentRange.to){rejected=pending("PROOF_INVALID",expression,atom.value);continue;}
    if(proof!==undefined&&!ownedProofs.some(range=>atom.from>=range.from&&requiredEnd<=range.to)){rejected=pending("PROOF_INVALID",expression,atom.value);continue;}
    // Multiple independent quantities must remain attached to their own product.
    const identityStart=Math.max(prefix.lastIndexOf("."),prefix.lastIndexOf(";"),prefix.lastIndexOf("!"),prefix.lastIndexOf("?"))+1;
    const mention=[...mentions].reverse().find(item=>item.from>=identityStart&&item.to<=atom.from);
    const priorMeasure=previous?text.slice(previous.to,atom.from):"",priorTail=priorMeasure.slice(catalogUnit(priorMeasure)?.[0].length??0);
    const priorProduct=previous&&productPrefix(priorTail.slice(connectors.exec(priorTail)![0].length),input.product_names);
    const retrospective=mention&&(!currentRange||mention.from>=currentRange.from&&mention.to<=currentRange.to)&&(aggregate||!previous||mention.from>=previous.to&&!priorProduct);
    const scoped=live&&atom.from===text.length-text.trimStart().length&&/^\s*(?:unidades?|un)\s*[.!?]*\s*$/.test(text.slice(atom.to))||currentField&&!!unit;
    if(!product&&!retrospective&&!scoped){rejected=pending("PRODUCT_UNPROVEN",expression,atom.value);continue;}
    if(!independentScope){
      const unassigned=occurrences.some(other=>{
        if(other===atom)return false;
        if(siblingRanges.some(range=>other.from>=range.from&&other.to<=range.to&&range.value===other.value&&!(atom.from>=range.from&&atom.to<=range.to)))return false;
        const following=occurrences.find(value=>value.from>other.from),otherTail=measureTail(text.slice(other.to,following?.from??text.length),syntax.slice(other.to,following?.from??text.length));
         const unitEnd=catalogUnit(otherTail)?.[0].length;
         const complement=unitEnd===undefined?otherTail:otherTail.slice(unitEnd),gap=connectors.exec(complement)![0];
         const ownProduct=productPrefix(complement.slice(gap.length),input.product_names)!==undefined;
         // Residual numbers outside an independently delimited own action are
         // not competing quantities merely because they occur in the turn.
         // Keep literal measures and same-product counts conservative; factual
         // operators/negation/identity are still checked on the original text.
         const separate=currentRange&&(other.to<=currentRange.from&&/[;:.!?]/.test(text.slice(other.to,currentRange.from))||
           other.from>=currentRange.to&&/[;:.!?]/.test(text.slice(currentRange.to,other.from)));
         if(separate&&unitEnd===undefined&&!ownProduct&&!dimensionHead.test(otherTail))return false;
        const namedComplement=[...complement.matchAll(/\b(?:de|do|da|dos|das)\s+(?=\p{L})/gu)].some(link=>{
          const noun=other.to+(unitEnd??0)+link.index!+link[0].length;
          return !facts.dimensions.some(span=>noun>=span.from&&noun<span.to);
        });
        if(namedComplement&&!ownProduct&&!mentions.some(item=>item.from>=other.to&&item.to<=other.to+otherTail.length))return aggregate;
        // An explicit aggregate may account for earlier factors, but never
        // another product's quantity. All other residual values need an action.
         if(aggregate&&(other.from<atom.from||distributionClauseStart(syntax,atom.to,other.from)!==undefined))return false;
        return true;
      });
      if(unassigned){rejected=pending("AMBIGUOUS",expression,atom.value);continue;}
    }
    accepted.push({status:"ACCEPTED",catalog_unit:"un",quantity,basis:unit?"EXPLICIT_UNIT":"PRODUCT_COUNT",expression:source.slice(atom.from,requiredEnd).slice(0,600),source_hash:sourceHash!});
  }
  const result=accepted.length===1?accepted[0]:accepted.length>1?pending("AMBIGUOUS"):rejected;
  return result.status==="NEEDS_INPUT"&&result.cause==="PRODUCT_UNPROVEN"&&input.catalog&&context?{...result,identity_status:"UNRESOLVED"}:result;
}
export function inventoryQuantityQuestion(resolution?:InventoryQuantityResolution){
  return resolution?.cause&&resolution.cause!=="MISSING"?`O estoque é contado em unidades. Quantas unidades ao todo?`:"Quantas unidades?";
}
