export type InventoryReferenceEvidence={kind:"NAMED"|"CURRENT_FIELD";literal:string|null};
export type InventoryOperationScope={key:string;operation:string;literal:string};
export type SourceRange={from:number;to:number};
const coordinate=/^(?:e|mas)\b/iu;
const precedingCoordinate=/(?:^|\s)((?:e|mas)\s+)$/iu;
// Closed grammatical heads, including every contraction of por + article.
// This recognizes a relation boundary, never the reason's business meaning.
const subordinate=/^(?:para|por|pel[oa]s?|porque|pois)\b/iu;
const delimiter=/[;,:.!?]\s*$/u;

/** Provenance and grammatical separators only. Luna assigns semantic roles. */
export function inventorySourceScopes(source:string,input:{scope?:string|null;reason?:string|null;reference?:InventoryReferenceEvidence|null;others?:readonly InventoryOperationScope[]}){
  const range=(literal:string,within?:SourceRange):SourceRange|undefined=>{
    const from=source.indexOf(literal,within?.from??0),next=source.indexOf(literal,from+1);
    if(from<0||within&&from+literal.length>within.to||next>=0&&(!within||next+literal.length<=within.to))return;
    const to=from+literal.length;
    if(/[\p{L}\p{N}]$/u.test(source.slice(0,from))&&/^[\p{L}\p{N}]/u.test(literal)||/[\p{L}\p{N}]$/u.test(literal)&&/^[\p{L}\p{N}]/u.test(source.slice(to)))return;
    return {from,to};
  };
  const boundary=(span:SourceRange,kind:"operation"|"reason")=>{
    const before=source.slice(0,span.from),body=source.slice(span.from,span.to);
    if(!before.trim()||delimiter.test(before))return true;
    return /\s$/u.test(before)&&(kind==="reason"?subordinate:coordinate).test(body)||
      kind==="operation"&&precedingCoordinate.test(before);
  };
  const current=input.scope?range(input.scope):undefined;
  if(input.scope&&(!current||!boundary(current,"operation")))return {valid:false as const};
  const siblings:SourceRange[]=[];const keys=new Set<string>();
  for(const operation of input.others??[]){
    if(keys.has(operation.key))return {valid:false as const};keys.add(operation.key);
    const span=range(operation.literal);
    if(!span||current&&span.from<current.to&&span.to>current.from)return {valid:false as const};
    if(!boundary(span,"operation")){
      // A disjoint sibling is auxiliary evidence. Without its own boundary it
      // cannot mask source bytes, but cannot invalidate a complete own scope.
      // Legacy proofs without an own scope retain the conservative contract.
      if(!current)return {valid:false as const};
      continue;
    }
    siblings.push(span);
  }
  const reference=input.reference;
  const named=reference?.kind==="NAMED"&&reference.literal?range(reference.literal,current):undefined;
  if(reference&&(reference.kind==="NAMED"&&!named||reference.kind==="CURRENT_FIELD"&&reference.literal!==null))return {valid:false as const};
  if(named&&(current&&(named.from<current.from||named.to>current.to)||siblings.some(span=>named.from<span.to&&named.to>span.from)))return {valid:false as const};
  const reason=input.reason?range(input.reason,current):undefined;
  const reasonRole=reason&&boundary(reason,"reason")&&(!current||reason.from>=current.from&&reason.to<=current.to)&&
    !siblings.some(span=>reason.from<span.to&&reason.to>span.from)&&!(named&&reason.from<named.to&&reason.to>named.from)?reason:undefined;
  // A quoted action may start on either side of its actual coordinator. The
  // separator belongs to the grammatical boundary, not to the preceding name.
  const siblingIdentityRanges=siblings.map(span=>{
    const connector=precedingCoordinate.exec(source.slice(0,span.from));
    return connector?{...span,from:span.from-connector[1].length}:span;
  });
  const boundaryExtensions=siblingIdentityRanges.flatMap((span,index)=>span.from<siblings[index].from?[{from:span.from,to:siblings[index].from}]:[]);
  return {valid:true as const,current,named,siblings,boundaryExtensions,reason:reasonRole,identityExclusions:[...siblingIdentityRanges,...(reasonRole?[reasonRole]:[])]};
}
