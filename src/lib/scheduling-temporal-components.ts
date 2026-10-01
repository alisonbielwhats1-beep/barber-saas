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
/** C5 agent reading (option `clockUnits`, default off; only temporalAtomSpans turns it on): an hour written with an abbreviated hour unit,
 * glued or after one space ("10hs", "10 hrs", "14 h", "9hr30", "10h30min"), and a colon clock that carries one ("14:30hs"): forms the C4's
 * token grammar already reads as one clock (scheduling-temporal-reference.ts). A unit never runs into a letter or a digit ("10 hoje" and
 * "10horas" are no unit form); "hora(s)" written out still needs a lead (it may be a duration). Off: exactly the historical forms. */
export type ClockReadOptions = { clockUnits?: boolean };
const hourUnit="(?:hrs|hr|hs|h)",minuteUnit="(?:minutos|minuto|mins|min)",unitEnd="(?![a-z\\d])";
const unitTail=(open:string)=>`(?: ?${hourUnit}(?:${open}\\d{2})(?: ?${minuteUnit})?)?${unitEnd}|:${open}\\d{2})(?: ?${hourUnit}${unitEnd})?)`;
/** What follows the hour digits in a clock form of that option. CLOCK_UNIT_CAPTURE: group 1 the glued minutes, group 2 the colon minutes. */
export const CLOCK_UNIT_FORM=unitTail("(?:"),CLOCK_UNIT_CAPTURE=unitTail("(");
/** The minutes written after a clock of that option ("10hs e meia", "10h e quinze minutos", "10hs 30", "9 hrs 45 min") belong to it: its
 * atom spans them, so the agent's validator reads the whole clock through the C4's grammar (or nothing), never its hour alone. They are no
 * minutes when a date, a unit or another clock follows ("10h 20/03", "10h 20 de março", "10h e 11h", "14:30 e 15:00"), nor is an indefinite
 * article ("10h e uma escova"). Minutes written twice make the clock invalid. CLOCK_UNIT_MINUTES_CAPTURE: group 1 the spoken minutes, group 2
 * the digits. */
const months="(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)";
const minutesGuard=`${unitEnd}(?!\\s*(?:[\\/.:\\-]\\d|(?:${hourUnit}|horas?|dias?|semanas?|mes|meses|anos?)(?![a-z])|de\\s+${months}(?![a-z])))`;
const unitDigits=(open:string)=>`\\s${open}\\d{2})(?:\\s?${minuteUnit})?${minutesGuard}`;
const unitMinutes=(open:string)=>`(?:\\s+e\\s+(?!uma?(?![a-z]))${open}meia|${cardinalPattern})(?:\\s?${minuteUnit})?${minutesGuard}|${unitDigits(open)})`;
export const CLOCK_UNIT_MINUTES_FORM=unitMinutes("(?:"),CLOCK_UNIT_MINUTES_CAPTURE=unitMinutes("(");
/** "HH:MM" of a single clock of that option, from the groups of CLOCK_UNIT_CAPTURE then CLOCK_UNIT_MINUTES_CAPTURE. Without minutes after
 * it, exactly the historical value; with them, those minutes, or INVALID when it already had minutes or they are out of range. */
export function unitClockValue(hour:string,glued?:string,colon?:string,spoken?:string,digits?:string):string{
  const written=glued??colon;
  if(spoken===undefined&&digits===undefined)return `${hour.padStart(2,"0")}:${written??"00"}`;
  const minute=written!==undefined?undefined:digits!==undefined?Number(digits):spoken==="meia"?30:cardinal(spoken!);
  return minute===undefined||minute>59?"INVALID":`${hour.padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
}
/** An interval end of that option takes the digits after its unit too ("das 10hs às 11hs 30"); the spoken minutes it already had. */
const unitScalarPattern=`(?:meio[- ]dia|meia[- ]noite|${hourPattern}(?:${CLOCK_UNIT_FORM}(?:${unitDigits("(?:")})?)?)(?:\\s+horas?)?(?:\\s+e\\s+(?:meia|${cardinalPattern})(?:\\s+minutos?)?)?(?:\\s+(?:da|a)\\s+(?:manha|tarde|noite))?`;
const unitScalarParser=new RegExp(`^(meio[- ]dia|meia[- ]noite|${hourPattern})(?:${CLOCK_UNIT_CAPTURE}(?:${unitDigits("(")})?)?(?:\\s+horas?)?(?:\\s+e\\s+(meia|${cardinalPattern})(?:\\s+minutos?)?)?(?:\\s+(?:da|a)\\s+(manha|tarde|noite))?$`);
type Scalar = { hour:number; minute:number; daypart?:Daypart; anchor:boolean };
function scalar(text:string,units=false):Scalar|undefined{
  const match=(units?unitScalarParser:scalarParser).exec(text);if(!match)return;
  // The unit parser has one group more (4: the digits after the unit); the historical one has none there.
  const groups:(string|undefined)[]=units?match.slice(1,7):[match[1],match[2],match[3],undefined,match[4],match[5]];
  const [head,glued,colon,digits,spoken,daypart]=groups;
  const anchor=/^(meio|meia)[- ]/.test(head!);
  const hour=anchor?(head!.startsWith("meio")?12:0):cardinal(head!);
  const numericMinute=glued??colon;
  if([numericMinute,digits,spoken].filter(value=>value!==undefined).length>1)return;
  const minute=numericMinute!==undefined?Number(numericMinute):digits!==undefined?Number(digits):spoken==="meia"?30:spoken?cardinal(spoken):0;
  if(hour===undefined||minute===undefined||hour>23||minute>59)return;
  return {hour,minute,daypart:daypart as Daypart|undefined,anchor};
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

/** Only structural clock additions. Existing simple-clock compatibility stays at the caller. `options.clockUnits` (ClockReadOptions): the
 * interval ends may carry an abbreviated hour unit ("das 12hs às 13hs"). */
export function clockComponents(text:string,options:ClockReadOptions={}):ClockComponent[]{
  const output:ClockComponent[]=[],units=options.clockUnits===true,pattern=units?unitScalarPattern:scalarPattern;
  const interval=new RegExp(`\\b(?:entre\\s+(${pattern})\\s+e\\s+(${pattern})|(?:de|das|da)\\s+(${pattern})\\s+(?:as|ate)\\s+(${pattern}))\\b`,'g');
  for(const match of text.matchAll(interval)){
    const left=match[1]??match[3],right=match[2]??match[4];
    const start=match.index!,end=start+match[0].length;
    const leftStart=start+match[0].indexOf(left),rightStart=start+match[0].lastIndexOf(right);
    const first=scalar(left,units),last=scalar(right,units);
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
