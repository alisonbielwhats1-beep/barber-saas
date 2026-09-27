import type { SelectedOperation } from "@everflair/salon-secretary";
import { projectSchedulingOperation } from "./secretary-operation-projection";

/** In a compound request each scheduling action is grounded against the message
 * with the temporal literals that Luna attributed to OTHER actions blanked out
 * (same length, so offsets stay valid). "Muda o Fábio para as 17h e cancela a
 * Carla de sexta" must not make "sexta" look like a date the Fábio action dropped.
 * A literal also claimed by this action stays visible. */
export function siblingScopedMessage(message:string,ownOperation:SelectedOperation,siblings?:readonly SelectedOperation[]){
  if(!siblings||siblings.length<2)return message;
  const literals=(op:SelectedOperation)=>{try{return (projectSchedulingOperation(op).temporal_evidence??[]).map(item=>item.text);}catch{return [];}};
  const spans=(text:string)=>{const found:[number,number][]=[];for(let at=message.indexOf(text);at>=0&&text;at=message.indexOf(text,at+1))found.push([at,at+text.length]);return found;};
  // Positions of this action's own literals are never blanked, even when a sibling
  // quotes a shorter overlapping text ("10h" inside "às 10h").
  const own=literals(ownOperation).flatMap(spans);
  const chars=message.split("");
  for(const sibling of siblings){
    if(sibling===ownOperation||sibling.item_key===ownOperation.item_key)continue;
    for(const text of literals(sibling))for(const [start,end] of spans(text)){
      if(!text.trim()||own.some(([a,b])=>start<b&&a<end))continue;
      for(let i=start;i<end;i++)chars[i]=" ";
    }
  }
  return chars.join("");
}
