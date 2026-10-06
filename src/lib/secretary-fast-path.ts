/** Only a single explicitly awaited field. This is not a general language parser. */
export function secretaryFastPath(waitingFor:string|undefined,message:string):{time:string}|{end_time:string}|{durationMin:number}|{day_offset:1}|undefined{
  const text=message.trim();
  if(waitingFor==="time"||waitingFor==="end_time"){
    const match=/^(\d{1,2})(?:h(?:(\d{2}))?|:(\d{2}))$/i.exec(text);
    if(!match)return;
    const h=Number(match[1]),m=Number(match[2]??match[3]??0);
    if(h>23||m>59)return;
    return {[waitingFor]:`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`} as {time:string}|{end_time:string};
  }
  if(waitingFor==="durationMin"){
    const match=/^([1-9]\d{0,2}) minutos?$/i.exec(text);
    if(match)return {durationMin:Number(match[1])}; // Same domain validator enforces 5..600.
  }
  if(waitingFor==="date"&&text.toLocaleLowerCase("pt-BR")==="amanhã")return {day_offset:1};
}
