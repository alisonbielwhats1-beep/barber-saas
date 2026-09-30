import { referencesV2Enabled, type SelectedOperation } from "@everflair/salon-secretary";
import { projectSchedulingOperation } from "./secretary-operation-projection";
import { foldedLiteral, literalSpans, normalizedOffsets } from "../../packages/salon-secretary/src/literal-match";
import { governingNegators } from "./scheduling-temporal-source";
import { exclusionAtomSpans, exclusionSpans } from "./scheduling-temporal-polarity";
import { foldTemporal, temporalScan } from "./scheduling-temporal-reference";
import { distributiveReferenceProven, singlesOut } from "./secretary-same-as";

/** In a compound request each scheduling action is grounded against the message
 * with the temporal literals that Luna attributed to OTHER actions blanked out
 * (same length, so offsets stay valid). "Muda o Fábio para as 17h e cancela a
 * Carla de sexta" must not make "sexta" look like a date the Fábio action dropped.
 * A literal also claimed by this action stays visible. */
export function siblingScopedMessage(message:string,ownOperation:SelectedOperation,siblings?:readonly SelectedOperation[]){
  if(!siblings||siblings.length<2)return message;
  // Affirmed quotes only: a C4 exclusion ("não 10h") is masked below only once its fragment is proven.
  const literals=(op:SelectedOperation)=>{try{return (projectSchedulingOperation(op).temporal_evidence??[]).filter(item=>item.excluded===undefined).map(item=>item.text);}catch{return [];}};
  const exclusions=(op:SelectedOperation)=>{try{return exclusionSpans(message,projectSchedulingOperation(op).temporal_evidence);}catch{return [];}};
  // A sibling's exclusion is blanked without its marker: its negator stays visible to this action (review).
  const atoms=(op:SelectedOperation)=>{try{return exclusionAtomSpans(message,projectSchedulingOperation(op).temporal_evidence);}catch{return [];}};
  // Tolerant whole-token spans: "amanhã" quoted by Luna also covers the user's "amanha".
  const spans=(text:string)=>literalSpans(message,text);
  // Positions of this action's own literals are never blanked, even when a sibling
  // quotes a shorter overlapping text ("10h" inside "às 10h").
  const own=[...literals(ownOperation).flatMap(spans),...exclusions(ownOperation)];
  const chars=message.split("");
  for(const sibling of siblings){
    if(sibling===ownOperation||sibling.item_key===ownOperation.item_key)continue;
    for(const [start,end] of [...literals(sibling).filter(text=>text.trim()).flatMap(spans),...atoms(sibling)]){
      if(own.some(([a,b])=>start<b&&a<end))continue;
      for(let i=start;i<end;i++)chars[i]=" ";
    }
  }
  return chars.join("");
}

/** The single exact occurrence of a quoted clause, or undefined. */
function uniqueAt(message:string,scope:unknown){
  if(typeof scope!=="string"||!scope.trim())return;
  const at=message.indexOf(scope);
  return at>=0&&message.indexOf(scope,at+1)<0?at:undefined;
}
const evidenceOf=(op:SelectedOperation)=>{try{return (projectSchedulingOperation(op).temporal_evidence??[]).filter(item=>item.excluded===undefined).map(item=>item.text);}catch{return undefined;}};
const quotesOf=(op:SelectedOperation,keys:readonly string[])=>keys.map(key=>(op as Record<string,unknown>)[key]).filter((value):value is string=>typeof value==="string");
/** Every quote the message has occurs at least once inside [at,end). */
const holds=(message:string,quotes:readonly string[],at:number,end:number)=>
  quotes.every(text=>{const spans=literalSpans(message,text);return !spans.length||spans.some(([start,stop])=>start>=at&&stop<=end);});
const sameAction=(a:SelectedOperation,b:SelectedOperation)=>a===b||a.item_key===b.item_key;
const occurrences=(message:string,text:string)=>{const found:[number,number][]=[];for(let at=message.indexOf(text);at>=0;at=message.indexOf(text,at+1))found.push([at,at+text.length]);return found;};
/** A day said once for coordinated actions: its only occurrence and the actions quoting it there (with their own text). */
type SharedDay={span:[number,number];members:{op:SelectedOperation;text:string}[]};
const exemptOf=(shared:readonly SharedDay[],op:SelectedOperation)=>shared.flatMap(group=>group.members.filter(member=>sameAction(member.op,op)).map(member=>member.text));
/** The clause of `op` verified by the rule actionScopedSource applies to its own clause (unique, overlapping no other
 * action's unique clause, holding its quotes except the `exempt` ones, with mappable governing negators). */
function ownClause(message:string,op:SelectedOperation,operations:readonly SelectedOperation[],exempt:readonly string[]):[number,number]|undefined{
  const at=uniqueAt(message,op.source_scope);
  if(at===undefined)return;
  const end=at+op.source_scope!.length;
  if(operations.some(other=>{if(sameAction(other,op))return false;const start=uniqueAt(message,other.source_scope);return start!==undefined&&start<end&&at<start+other.source_scope!.length;}))return;
  const evidence=evidenceOf(op);
  if(!evidence||!holds(message,[...evidence.filter(text=>!exempt.includes(text)),...quotesOf(op,["reason","override_reason","service_name"])],at,end))return;
  return governingNegators(message,at,end)?[at,end]:undefined;
}
/** V2 (flag SALON_SECRETARY_REFERENCES_V2; the D4 distributive rule, for DIRECT quotes): a day said ONCE for coordinated
 * actions in a shared prefix/suffix ("passa a Lia pras 2 e o Téo pras 3, os dois na quinta") that each of them quotes as its
 * own day. Accepted outside an action's clause only when: the quote has exactly one occurrence in the message, outside every
 * action's clause; at least two actions quote that same span as their `date`; and, for EACH of them, the D4 rule holds
 * (distributiveReferenceProven: its own region states no day of its own and holds no negator or alterity word; the occurrence
 * is not denied), with the clauses verified as they would be with every such day accepted. A day that fails is dropped and the
 * clauses verified again without it. Structure only; the value is still proven in each action's own view. */
function sharedDays(message:string,operations:readonly SelectedOperation[]):SharedDay[]{
  const occupied=operations.flatMap(op=>typeof op.source_scope==="string"&&op.source_scope.trim()?occurrences(message,op.source_scope):[]);
  const groups=new Map<string,SharedDay>();
  for(const op of operations){
    let days:string[];
    try{days=(projectSchedulingOperation(op).temporal_evidence??[]).filter(item=>item.excluded===undefined&&item.field==="date"&&item.text.trim()).map(item=>item.text);}catch{continue;}
    for(const text of new Set(days)){
      const spans=literalSpans(message,text);
      if(spans.length!==1||occupied.some(([a,b])=>spans[0][0]<b&&a<spans[0][1]))continue;
      const key=spans[0].join(":"),group=groups.get(key)??{span:spans[0],members:[]};
      if(!group.members.some(member=>sameAction(member.op,op)))group.members.push({op,text});
      groups.set(key,group);
    }
  }
  let shared=[...groups.values()].filter(group=>group.members.length>=2);
  while(shared.length){
    const current=shared,clauses=new Map(operations.map(op=>[op,ownClause(message,op,operations,exemptOf(current,op))] as const));
    const verified=[...clauses.values()].filter((clause):clause is [number,number]=>!!clause);
    const failing=current.filter(group=>!group.members.every(member=>{
      const own=clauses.get(member.op),other=group.members.find(item=>!sameAction(item.op,member.op))!;
      return !!own&&distributiveReferenceProven(message,member.text,"date",own,{op:other.op,clause:clauses.get(other.op)},verified,member.op.operation);
    }));
    if(!failing.length)break;
    shared=current.filter(group=>!failing.includes(group));
  }
  return shared;
}
const clauseBoundary=/[,.;!?()\n]/;
/** Closed grammatical class (written justification): the masculine plural definite article "os" directly before a cardinal
 * numeral ("os dois", "os 3") is a nominal quantifier naming people, never a day ("o dia 2" is singular) nor a clock (hours are
 * feminine: "às/as duas"). In the clause of a day said once for N coordinated actions (outside every verified clause), the one
 * whose numeral is exactly N is the distributive subject ("…, os dois na quinta"). It is blanked in each such action's view so
 * that it is never read as a free number beside that day; any numeral the grammar binds (a clock, a day, a count) is not free
 * and stays, and nothing else of the clause is touched. Removing it only drops a rejection; it never supplies a value. */
function distributiveQuantifiers(message:string,group:SharedDay,clauses:readonly (readonly [number,number])[]):[number,number][]{
  const map=normalizedOffsets(message,foldTemporal),scan=temporalScan(message);
  if(!map||!scan)return [];
  let lead=group.span[0],tail=group.span[1];
  while(lead>0&&!clauseBoundary.test(message[lead-1])&&!clauses.some(clause=>clause[1]===lead))lead--;
  while(tail<message.length&&!clauseBoundary.test(message[tail])&&!clauses.some(clause=>clause[0]===tail))tail++;
  const [from,to,quoteFrom,quoteTo]=[lead,tail,...group.span].map(at=>map.toNormalized(at));
  return scan.facts(from,to).freeNums.filter(token=>token.n===group.members.length&&(token.to<=quoteFrom||token.at>=quoteTo)&&/(?:^|[^\p{L}\p{N}])os\s+$/u.test(map.text.slice(from,token.at)))
    .map(token=>[map.toOriginal(token.at),map.toOriginal(token.to)]);
}
/** Fixer (read by governingNegators only under SALON_SECRETARY_DATE_RULES_V2): the spans of a verified sibling clause [at,stop)
 * holding that sibling's own quoted reason ("cancela a Lia que ela não vem mais"): what a negator there denies is the reason's
 * content (why the sibling happens), never another operation. A reason that heads its own clause (starts at the clause's first
 * word: "não precisa desmarcar…" quoted as a reason) is not one. */
function ownedReasons(message:string,sibling:SelectedOperation,at:number,stop:number):[number,number][]{
  const head=at+(/^\s*\S+/.exec(message.slice(at,stop))?.[0].length??0);
  return quotesOf(sibling,["reason","override_reason"]).filter(text=>text.trim()).flatMap(text=>literalSpans(message,text).filter(([start,end])=>start>=head&&end<=stop));
}
/** FX6: closed class of the distributive subjects of coordinated actions: "ambos/ambas", "todos/todas", or the plural article
 * before a cardinal ("os dois", "as duas", "os 3"). */
const DISTRIBUTIVE=new Set(["ambos","ambas","todos","todas"]),CARDINALS=new Set(["dois","duas","tres","quatro","cinco"]);
function distributiveSubject(text:string){
  const list=foldedLiteral(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return list.some((word,i)=>DISTRIBUTIVE.has(word)||(word==="os"||word==="as")&&(CARDINALS.has(list[i+1]??"")||/^\d+$/.test(list[i+1]??"")));
}
/** C4 R-B1 (V2, the D4 rule of sharedDays): Luna may close the LAST coordinated action's clause after the shared suffix (or open
 * the FIRST one before the shared prefix) that states a day said once for all of them ("…e o Téo pras 3, os dois na quinta").
 * When that edge is the clause's last (first) punctuation segment, holds the day's only occurrence, quoted as `date` by this
 * action and by another one, and the rest of the clause holds every other quote of the action (temporal, names, service,
 * reason), the clause is read without that segment, exactly as if Luna had closed it at the punctuation. Kept only when every
 * such day then passes sharedDays' verification; otherwise every clause stays Luna's own. Offsets never move. */
function sharedEdges(message:string,operations:readonly SelectedOperation[]):readonly SelectedOperation[]{
  const days=(op:SelectedOperation)=>{try{return (projectSchedulingOperation(op).temporal_evidence??[]).filter(item=>item.excluded===undefined&&item.field==="date"&&item.text.trim()).map(item=>item.text);}catch{return [];}};
  const only=(text:string)=>{const spans=literalSpans(message,text);return spans.length===1?spans[0]:undefined;};
  const cuts=new Map<SelectedOperation,[number,number]>();
  const edged=operations.map(op=>{
    const at=uniqueAt(message,op.source_scope),evidence=evidenceOf(op);
    if(at===undefined||!evidence)return op;
    const end=at+op.source_scope!.length;
    for(const text of new Set(days(op))){
      const span=only(text);
      if(!span||span[0]<at||span[1]>end||!operations.some(other=>!sameAction(other,op)&&days(other).some(day=>{const found=only(day);return !!found&&found[0]===span[0]&&found[1]===span[1];})))continue;
      // UTF-16 offsets (never code points): the boundary characters are single units.
      const head=message.slice(at,span[0]),tail=message.slice(span[1],end);
      let last=-1,first=-1;
      for(let i=0;i<head.length;i++)if(clauseBoundary.test(head[i]))last=i;
      for(let i=0;i<tail.length&&first<0;i++)if(clauseBoundary.test(tail[i]))first=i;
      let [from,to]=last>=0&&first<0?[at,at+last]:last<0&&first>=0?[span[1]+first+1,end]:[0,0];
      while(from<to&&/\s/.test(message[from]))from++;
      while(to>from&&/\s/.test(message[to-1]))to--;
      // FX6 (review, safety): Luna scoped a trailing segment inside the LAST action, so it is read as shared only when it says so itself:
      // a distributive subject ("os dois", "as duas", "ambos", "todos") in the segment cut out (a leading day before every action is not
      // this case: it keeps the rule as it was). A segment singling one person out is never shared (sharedDays, singledDays).
      if(last>=0&&first<0&&!distributiveSubject(message.slice(at+last,end)))continue;
      if(from>=to||uniqueAt(message,message.slice(from,to))!==from||
        !holds(message,[...evidence.filter(item=>item!==text),...quotesOf(op,["reason","override_reason","service_name","customer_name","professional_name"])],from,to))continue;
      const copy={...op,source_scope:message.slice(from,to)} as SelectedOperation;
      cuts.set(copy,span);
      return copy;
    }
    return op;
  });
  if(!cuts.size)return operations;
  const shared=sharedDays(message,edged);
  return [...cuts].every(([op,span])=>shared.some(group=>group.span[0]===span[0]&&group.span[1]===span[1]&&group.members.some(member=>sameAction(member.op,op))))?edged:operations;
}
/** FX6 (review): the single occurrences of this action's own day quotes that another action quotes too (a day said once for several of
 * them) lying outside this action's clause [at,end) in a segment singling one person out (singlesOut: a restrictor or a singular
 * third-person pronoun, up to the punctuation or clause edges around it). */
function singledDays(message:string,op:SelectedOperation,operations:readonly SelectedOperation[],at:number,end:number):[number,number][]{
  const days=(item:SelectedOperation)=>{try{return (projectSchedulingOperation(item).temporal_evidence??[]).filter(entry=>entry.excluded===undefined&&entry.field==="date"&&entry.text.trim()).map(entry=>entry.text);}catch{return [];}};
  const only=(text:string)=>{const spans=literalSpans(message,text);return spans.length===1?spans[0]:undefined;};
  const clauses=operations.flatMap(item=>{const start=uniqueAt(message,item.source_scope);return start===undefined?[]:[[start,start+item.source_scope!.length] as [number,number]];});
  return [...new Set(days(op))].flatMap(text=>{
    const span=only(text);
    if(!span||span[0]>=at&&span[1]<=end||!operations.some(other=>!sameAction(other,op)&&days(other).some(day=>{const found=only(day);return !!found&&found[0]===span[0]&&found[1]===span[1];})))return [];
    return singlesOut(message,span,clauses)?[span]:[];
  });
}
/** C4 (flag SALON_SECRETARY_DATE_RULES_V2; applyKeptDayGuard) for an action of a compound request whose own clause is NOT verified
 * (grounded on the sibling-masked message): the occurrences of its own source_scope, and those of every other action's source_scope and
 * quoted texts (reason, names), ORIGINAL offsets. A day inside the latter and outside the former is another action's; any other day of
 * the view stays this action's. A span holding one of this action's own quotes or names (a greedy boundary: "the whole message") is
 * no clause of another action and never counts. Luna's boundaries only narrow what is asked, never a value. */
export function foreignClauses(message:string,ownOperation:SelectedOperation,siblings:readonly SelectedOperation[]){
  const scope=(op:SelectedOperation)=>typeof op.source_scope==="string"&&op.source_scope.trim()?occurrences(message,op.source_scope):[];
  const keys=["reason","override_reason","customer_name","service_name","professional_name","target_professional_name"];
  const quoted=(op:SelectedOperation)=>quotesOf(op,keys).filter(text=>text.trim()).flatMap(text=>literalSpans(message,text));
  const mine=[...(evidenceOf(ownOperation)??[]).filter(text=>text.trim()).flatMap(text=>literalSpans(message,text)),...quoted(ownOperation)];
  return {own:scope(ownOperation),siblings:siblings.filter(op=>!sameAction(op,ownOperation)).flatMap(op=>[...scope(op),...quoted(op)])
    .filter(([start,end])=>!mine.some(([a,b])=>a<end&&start<b))};
}
/** Per-action scope of a compound request. Luna quotes, in source_scope, the clause that
 * describes each operation. When this action's clause is a UNIQUE exact substring, does not
 * overlap a sibling's clause and contains every literal this action quotes that the message
 * has (temporal quotes, reason, service), the action is grounded against a same-length view
 * where only the SIBLINGS' verified clauses are blank (a sibling clause is verified when it is
 * unique and holds that sibling's own quotes and names): a sibling's negator, reason, date or
 * clock inside its own clause can no longer reject, prove or be demanded by this action.
 * Everything else stays visible, so Luna's boundary never removes context of this action: a
 * leading "Não" she left out, or origin atoms a clipped clause dropped, still deny or are
 * demanded. A negator that governs this clause (in its lead or tail, up to a boundary or
 * connector) stays visible even when a sibling's clause quotes it. Otherwise (no/invalid
 * scope) the historical sibling-literal masking applies. Offsets never move.
 * V2 (flag SALON_SECRETARY_REFERENCES_V2): a day said once for coordinated actions in a shared
 * prefix/suffix (sharedDays) does not make their clauses unverifiable; it stays visible in
 * each of their views, where only its distributive quantifier is blanked. */
export function actionScopedSource(message:string,ownOperation:SelectedOperation,siblings?:readonly SelectedOperation[]):{text:string;scoped:boolean}{
  const legacy=siblingScopedMessage(message,ownOperation,siblings);
  if(!siblings||siblings.length<2)return {text:legacy,scoped:false};
  if(referencesV2Enabled()){
    // C4 R-B1: a shared edge Luna left inside one clause is read outside it (sharedEdges); the copies keep every other field.
    const all=siblings.some(sibling=>sibling===ownOperation)?siblings:[ownOperation,...siblings],edged=sharedEdges(message,all);
    if(edged!==all){ownOperation=edged[all.indexOf(ownOperation)];siblings=edged;}
  }
  const at=uniqueAt(message,ownOperation.source_scope);
  if(at===undefined)return {text:legacy,scoped:false};
  const end=at+ownOperation.source_scope!.length;
  // FX6 (review, safety; V2): a day this action quotes only OUTSIDE its own clause, said once, in a segment that singles one person out
  // ("…e o Caleb pras 3, só ele na quinta") is never this action's: blanked in its view (never proven here: asked), whatever the scoping.
  const singled=referencesV2Enabled()?singledDays(message,ownOperation,siblings.some(sibling=>sibling===ownOperation)?siblings:[ownOperation,...siblings],at,end):[];
  const outside=singled.length?legacy.split("").map((char,i)=>singled.some(([start,stop])=>i>=start&&i<stop)?" ":char).join(""):legacy;
  const shared=referencesV2Enabled()?sharedDays(message,siblings.some(sibling=>sibling===ownOperation)?siblings:[ownOperation,...siblings]):[];
  const clauses:[number,number][]=[],reasons:[number,number][]=[];
  for(const sibling of siblings){
    if(sibling===ownOperation||sibling.item_key===ownOperation.item_key)continue;
    const other=uniqueAt(message,sibling.source_scope);
    if(other===undefined)continue;
    const stop=other+sibling.source_scope!.length;
    if(other<end&&at<stop)return {text:outside,scoped:false};
    const exempt=exemptOf(shared,sibling);
    if(holds(message,[...(evidenceOf(sibling)??[]).filter(text=>!exempt.includes(text)),...quotesOf(sibling,["reason","override_reason","service_name","customer_name","professional_name"])],other,stop)){
      clauses.push([other,stop]);
      reasons.push(...ownedReasons(message,sibling,other,stop));
    }
  }
  const evidence=evidenceOf(ownOperation),exempt=exemptOf(shared,ownOperation);
  // A quote of this action written only outside its clause ("no mesmo dia" pointing to a
  // sibling's date, a shared prefix) keeps the historical masking instead of disappearing.
  if(!evidence||!holds(message,[...evidence.filter(text=>!exempt.includes(text)),...quotesOf(ownOperation,["reason","override_reason","service_name"])],at,end))return {text:outside,scoped:false};
  const governing=governingNegators(message,at,end,reasons);
  if(!governing)return {text:outside,scoped:false};
  // Outside this clause the historical masking still hides the siblings' temporal quotes;
  // inside it the user's words stay intact (a sibling quoting the same "amanhã" elsewhere
  // must not hide it from this action's proof or coverage), and so do governing negators.
  const chars=outside.split("");
  for(let i=at;i<end;i++)chars[i]=message[i];
  for(const [start,stop] of clauses)for(let i=start;i<stop;i++)chars[i]=" ";
  for(const [start,stop] of governing)for(let i=start;i<stop;i++)chars[i]=message[i];
  for(const group of shared)if(exempt.length&&group.members.some(member=>sameAction(member.op,ownOperation)))
    for(const [start,stop] of distributiveQuantifiers(message,group,[[at,end],...clauses]))for(let i=start;i<stop;i++)chars[i]=" ";
  return {text:chars.join(""),scoped:true};
}
