import { ArrowDown, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The action's own text (the proposal's preview, line by line) laid out to be scanned on a phone: what it is, who and what it
 * is about, ANTES → DEPOIS side by side, then the remaining facts. Only the layout changes: the words are the preview's own, and
 * a text that does not have the preview's shape is shown exactly as before. Nothing here confirms or sends anything. */
export type ParsedSummary = { title: string; heading: string[]; before?: string; after?: string; notes: string[] };

const TITLE = /^[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý0-9 ·/—-]{3,40}$/;
const BEFORE = /^ANTES:\s*(.+)$/, AFTER = /^DEPOIS:\s*(.+)$/;
const CHANGE = /^([^:→]{2,30}):\s*(.+?)\s→\s(.+)$/, FACT = /^([^:→]{2,30}):\s+(.+)$/;

export function parseActionSummary(text: string): ParsedSummary | undefined {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2 || !TITLE.test(lines[0])) return undefined;
  const [title, ...rest] = lines;
  const at = rest.findIndex(line => BEFORE.test(line) || AFTER.test(line));
  const heading = at < 0 ? rest.slice(0, 1) : rest.slice(0, at);
  const after = at < 0 ? [] : rest.slice(at);
  const before = after.map(line => BEFORE.exec(line)?.[1]).find(Boolean), next = after.map(line => AFTER.exec(line)?.[1]).find(Boolean);
  const notes = at < 0 ? rest.slice(1) : after.filter(line => !BEFORE.test(line) && !AFTER.test(line));
  return { title, heading, ...(before ? { before } : {}), ...(next ? { after: next } : {}), notes };
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={cn('flex items-baseline gap-3 rounded-lg px-2 py-1.5', strong && 'bg-muted')}>
    <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
    <span className={cn('min-w-0 flex-1 tabular-nums', strong ? 'text-base font-semibold' : 'text-muted-foreground')}>{value}</span>
  </div>;
}

/** `className` goes on the outer box, for the plain text too (so the caller's box looks the same either way). */
export function ActionSummary({ text, className }: { text: string; className?: string }) {
  const parsed = parseActionSummary(text);
  if (!parsed) return <p className={cn('whitespace-pre-wrap break-words text-sm', className)}>{text}</p>;
  const [subject, ...details] = parsed.heading;
  return <div className={cn('space-y-2 break-words text-sm', className)}>
    <p className="text-xs font-semibold tracking-wide text-muted-foreground">{parsed.title}</p>
    {subject && <p className="text-base font-semibold leading-snug">{subject}</p>}
    {!!details.length && <p className="text-muted-foreground">{details.join(' · ')}</p>}
    {parsed.before && <div className="rounded-[10px] border border-border bg-background/60 p-1">
      <Row label="Antes" value={parsed.before} />
      {parsed.after && <ArrowDown aria-hidden="true" className="ml-[1.35rem] h-4 w-4 text-muted-foreground" />}
      {parsed.after && <Row label="Depois" value={parsed.after} strong />}
    </div>}
    {!parsed.before && parsed.after && <div className="rounded-[10px] border border-border bg-background/60 p-1"><Row label="Depois" value={parsed.after} strong /></div>}
    {parsed.notes.map((line, index) => {
      const change = CHANGE.exec(line), fact = FACT.exec(line);
      return change ? <p key={index}><span className="text-muted-foreground">{change[1]}:</span> {change[2]} <ArrowRight aria-hidden="true" className="inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" /><span className="sr-only"> para </span> <strong className="font-semibold">{change[3]}</strong></p>
        : fact ? <p key={index}><span className="text-muted-foreground">{fact[1]}:</span> {fact[2]}</p> : <p key={index}>{line}</p>;
    })}
  </div>;
}
