/** Literal temporal components only. No operation, entity, intent or role inference. */
export type TemporalSpan = { start: number; end: number };
type Daypart = "manha" | "tarde" | "noite";
export type ClockComponent = TemporalSpan & {
  value: string | undefined;
  kind: "ANCHOR_CLOCK" | "INTERVAL_CLOCK";
  interval?: TemporalSpan & { endpoint: "start" | "end"; sharedDaypart?: TemporalSpan };
};
export type RelativeDayComponent = TemporalSpan & { days: number | undefined };
const units: Record<string, number> = { zero:0, um:1, uma:1, dois:2, duas:2, tres:3, quatro:4, cinco:5, seis:6, sete:7, oito:8, nove:9,
  dez:10, onze:11, doze:12, treze:13, quatorze:14, catorze:14, quinze:15, dezesseis:16, dezessete:17, dezoito:18, dezenove:19 };
const tens: Record<string, number> = { vinte:20, trinta:30, quarenta:40, cinquenta:50, sessenta:60, setenta:70, oitenta:80, noventa:90 };
const hundreds: Record<string, number> = { cento:100, duzentos:200, duzentas:200, trezentos:300, trezentas:300 };
const numericWords = [...Object.keys(hundreds), "cem", ...Object.keys(tens), ...Object.keys(units)].sort((a,b)=>b.length-a.length).join("|");
const cardinalPattern = `(?:\\d+|(?:${numericWords})(?:\\s+e\\s+(?:${numericWords}))*)`;
function belowHundred(text: string): number | undefined {
  if(units[text]!==undefined)return units[text];
  if(tens[text]!==undefined)return tens[text];
  const parts=text.split(" e ");
  if(parts.length===2&&tens[parts[0]]!==undefined&&units[parts[1]]>0&&units[parts[1]]<10)return tens[parts[0]]+units[parts[1]];
}
function cardinal(text: string): number | undefined {
  text=text.replace(/\s+/g," ");
  if(/^\d+$/.test(text)){const value=Number(text);return Number.isSafeInteger(value)?value:undefined;}
  if(text==="cem")return 100;
  const small=belowHundred(text);if(small!==undefined)return small;
  const [head,...rest]=text.split(" e ");
  if(hundreds[head]!==undefined){
    if(!rest.length)return head==="cento"?undefined:hundreds[head];
    const tail=belowHundred(rest.join(" e "));
    if(tail!==undefined&&tail>0)return hundreds[head]+tail;
  }
}
const hourWords=Object.keys(units).sort((a,b)=>b.length-a.length).join("|");
const hourPattern=`(?:\\d{1,2}|vinte(?: e (?:uma|um|duas|dois|tres))?|${hourWords})`;
const scalarPattern=`(?:meio[- ]dia|meia[- ]noite|${hourPattern}(?:h(?:\\d{2})?|:\\d{2})?)(?:\\s+horas?)?(?:\\s+e\\s+(?:meia|${cardinalPattern})(?:\\s+minutos?)?)?(?:\\s+(?:da|a)\\s+(?:manha|tarde|noite))?`;
const scalarParser=new RegExp(`^(meio[- ]dia|meia[- ]noite|${hourPattern})(?:h(\\d{2})?|:(\\d{2}))?(?:\\s+horas?)?(?:\\s+e\\s+(meia|${cardinalPattern})(?:\\s+minutos?)?)?(?:\\s+(?:da|a)\\s+(manha|tarde|noite))?$`);
type Scalar = { hour:number; minute:number; daypart?:Daypart; anchor:boolean };
function scalar(text:string):Scalar|undefined{
  const match=scalarParser.exec(text);if(!match)return;
  const anchor=/^(meio|meia)[- ]/.test(match[1]);
  const hour=anchor?(match[1].startsWith("meio")?12:0):cardinal(match[1]);
  const numericMinute=match[2]??match[3];
  if(numericMinute!==undefined&&match[4]!==undefined)return;
  const minute=numericMinute!==undefined?Number(numericMinute):match[4]==="meia"?30:match[4]?cardinal(match[4]):0;
  if(hour===undefined||minute===undefined||hour>23||minute>59)return;
  return {hour,minute,daypart:match[5] as Daypart|undefined,anchor};
}
function clockValue(part:Scalar|undefined,shared?:Daypart):string|undefined{
  if(!part)return;
  let hour=part.hour;const daypart=part.daypart??shared;
  if(daypart){
    if(part.anchor){if(daypart==="manha"&&hour>=12||daypart==="tarde"&&(hour<12||hour>=18)||daypart==="noite"&&hour<18)return;}
    else if(daypart==="manha"){if(hour>=12)return;}
    else if(daypart==="tarde"){if(hour>0&&hour<12)hour+=12;if(hour<12||hour>18)return;}
    else {if(hour>=6&&hour<12)hour+=12;if(hour<18)return;}
  }
  return `${String(hour).padStart(2,"0")}:${String(part.minute).padStart(2,"0")}`;
}
const intersects=(a:TemporalSpan,b:TemporalSpan)=>a.start<b.end&&b.start<a.end;
const contains=(a:TemporalSpan,b:TemporalSpan)=>a.start<=b.start&&a.end>=b.end;
const signedBefore=(text:string,start:number)=>/[+\-\p{Sm}]\s*$/u.test(text.slice(0,start));

/** Closed arithmetic grammar: future displacement + exact count + calendar unit. */
export function relativeDayComponents(text:string):RelativeDayComponent[]{
  const expression=new RegExp(`\\b(?:daqui\\s+(?:a\\s+)?|em\\s+|dentro\\s+de\\s+)(${cardinalPattern})\\s+(dias?|semanas?)\\b`,'g');
  return [...text.matchAll(expression)].map(match=>{
    let start=match.index!,end=start+match[0].length;
    const count=cardinal(match[1]);
    const calculated=count===undefined?undefined:count*(match[2].startsWith("semana")?7:1);
    // Opposed direction or non-exact composition cannot certify a positive offset.
    const direction=/^\s+(?:atras|antes)\b/.exec(text.slice(end));
    const composition=new RegExp(`^\\s+(?:e|mais|menos)\\s+(?:[+\\-\\p{Sm}]\\s*)?${cardinalPattern}(?:\\s+(?:dias?|semanas?|horas?))?\\b`,"u").exec(text.slice(end));
    const contradicted=!!direction||!!composition||signedBefore(text,start);
    if(direction)end+=direction[0].length;
    if(composition)end+=composition[0].length;
    // Adjacent calendar qualifiers are part of this same expression. They stay
    // visible to the caller's calendar checks even when the model chose offset.
    const qualifier="(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}(?:/\\d{4})?";
    const before=new RegExp(`\\b(?:${qualifier})[\\s,]+$`).exec(text.slice(0,start));
    const after=new RegExp(`^[\\s,]+(?:${qualifier})\\b`).exec(text.slice(end));
    if(before)start=before.index;
    if(after)end+=after[0].length;
    return {start,end,days:!contradicted&&calculated!==undefined&&calculated<=365?calculated:undefined};
  });
}

/** Only structural clock additions. Existing simple-clock compatibility stays at the caller. */
export function clockComponents(text:string):ClockComponent[]{
  const output:ClockComponent[]=[];
  const interval=new RegExp(`\\b(?:entre\\s+(${scalarPattern})\\s+e\\s+(${scalarPattern})|(?:de|das|da)\\s+(${scalarPattern})\\s+(?:as|ate)\\s+(${scalarPattern}))\\b`,'g');
  for(const match of text.matchAll(interval)){
    const left=match[1]??match[3],right=match[2]??match[4];
    const start=match.index!,end=start+match[0].length;
    const leftStart=start+match[0].indexOf(left),rightStart=start+match[0].lastIndexOf(right);
    const first=scalar(left),last=scalar(right);
    const daypartMatch=/\b(?:da|a) (manha|tarde|noite)$/.exec(right);
    const shared=first&&!first.daypart&&!first.anchor&&last?.daypart?last.daypart:undefined;
    const sharedDaypart=shared&&daypartMatch?{start:rightStart+daypartMatch.index,end}:undefined;
    output.push({kind:"INTERVAL_CLOCK",start:leftStart,end:leftStart+left.length,value:clockValue(first,shared),interval:{start,end,endpoint:"start",sharedDaypart}});
    output.push({kind:"INTERVAL_CLOCK",start:rightStart,end:rightStart+right.length,value:clockValue(last),interval:{start,end,endpoint:"end"}});
  }
  const anchor=new RegExp(`\\b(?:meio[- ]dia|meia[- ]noite)(?:\\s+e\\s+(?:meia|${cardinalPattern})(?:\\s+minutos?)?)?(?:\\s+(?:da|a)\\s+(?:manha|tarde|noite))?\\b`,'g');
  for(const match of text.matchAll(anchor)){
    const start=match.index!;let end=start+match[0].length;
    if(output.some(item=>intersects(item,{start,end})))continue;
    // A lexical match must not certify only the positive prefix of a signed,
    // fractional or dimensionally different minute component.
    const tail=text.slice(end);
    const invalidTail=new RegExp(`^(?:\\s+(?:e|mais|menos)\\s+(?:[+\\-\\p{Sm}]\\s*)?${cardinalPattern}(?:h(?:\\d{2})?|:\\d{2}|\\s+(?:minutos?|horas?|segundos?|dias?|semanas?))?|[,.]\\d+|\\s+(?:horas?|segundos?|dias?|semanas?)\\b)`,"u").exec(tail);
    if(invalidTail)end+=invalidTail[0].length;
    output.push({kind:"ANCHOR_CLOCK",start,end,value:signedBefore(text,start)||invalidTail?undefined:clockValue(scalar(match[0]))});
  }
  return output.sort((a,b)=>a.start-b.start);
}

export function maskTemporalSpans(text:string,spans:TemporalSpan[]):string{
  const chars=text.split("");for(const span of spans)for(let i=span.start;i<span.end;i++)chars[i]=" ";return chars.join("");
}

/** time and end_time quoting the SAME span that holds exactly the two endpoints of one interval
 * component ("das 10 às 11"): the start endpoint witnesses time, the end endpoint end_time. */
export function sharedIntervalWitness(source:string,span:TemporalSpan,field:string,value:string):boolean|undefined{
  const parts=clockComponents(source).filter(part=>intersects(part,span));
  if(parts.length!==2||!parts.every(part=>part.interval&&contains(span,part)&&part.interval.start===parts[0].interval!.start))return;
  const part=parts.find(item=>item.interval!.endpoint===(field==="time"?"start":"end"));
  return !!part&&part.value===value;
}

/** An interval endpoint may inherit a daypart only from its other, proven endpoint.
 * quoteAt binds the quote to the occurrence the caller located; without it a repeated
 * quote gives no component proof. */
export function componentClockWitness(source:string,quote:string,field:string,value:string,
  evidence:readonly {field:string;text:string}[],raw:Record<string,unknown>,quoteAt?:number):boolean|undefined{
  const at=quoteAt??source.indexOf(quote);if(at<0||source.slice(at,at+quote.length)!==quote||quoteAt===undefined&&source.indexOf(quote,at+1)>=0)return;
  const span={start:at,end:at+quote.length},components=clockComponents(source);
  const selected=components.filter(part=>intersects(part,span));
  if(!selected.length)return;
  if(selected.length!==1)return false;
  const part=selected[0];
  if(!contains(span,part)||!part.value||part.value!==value)return false;
  if(part.interval){
    if(field!==(part.interval.endpoint==="start"?"time":"end_time"))return false;
    if(part.interval.sharedDaypart){
      const other=components.find(candidate=>candidate.interval?.start===part.interval!.start&&candidate.interval.endpoint==="end");
      const entries=evidence.filter(entry=>entry.field==="end_time");
      if(!other||entries.length!==1||raw.end_time!==other.value)return false;
      const otherAt=source.indexOf(entries[0].text);
      if(otherAt<0||!contains({start:otherAt,end:otherAt+entries[0].text.length},other))return false;
    }
  }
  return true;
}
