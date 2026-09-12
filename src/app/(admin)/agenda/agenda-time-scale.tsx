import { minutesToHHMM } from "@/lib/utils";

export function AgendaTimeScale({ start, end, pixelsPerMinute }: { start: number; end: number; pixelsPerMinute: number }) {
  return <div aria-label="Horários da agenda" className="relative" style={{ height: (end - start) * pixelsPerMinute }}>
    {Array.from({ length: Math.ceil((end - start) / 15) }, (_, index) => start + index * 15).map(minute => <span key={minute} data-agenda-minute={minutesToHHMM(minute)} aria-label={minutesToHHMM(minute)} style={{ top: (minute - start) * pixelsPerMinute }} className={`absolute inset-x-0 px-2 pt-0.5 text-right tabular-nums ${minute % 60 === 0 ? "text-[11px] font-medium text-foreground" : "text-[10px] text-muted-foreground"}`}>
      {minute % 60 === 0 ? minutesToHHMM(minute) : String(minute % 60).padStart(2, "0")}
    </span>)}
  </div>;
}
