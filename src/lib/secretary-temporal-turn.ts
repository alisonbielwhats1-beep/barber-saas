import { AsyncLocalStorage } from 'node:async_hooks';
import type { SchedulingFields } from './scheduling-contract';
import type { SchedulingTemporalEvidence } from '../../packages/salon-secretary/src/scheduling-skill';
import { validateTemporalNegativeContext, type TemporalNegativeContextInput } from './scheduling-temporal-negative-context';

type Draft = { draft_ref:string; draft_revision:number; expires_at:string; fields:SchedulingFields; plan?:unknown };
export type TemporalTurnDraft = Draft & { item_key?:string; scope_valid:boolean };
const snapshots = new AsyncLocalStorage<ReadonlyMap<string,TemporalTurnDraft>>();
const key = (draft: Pick<TemporalTurnDraft,'draft_ref'|'item_key'>) => JSON.stringify([draft.draft_ref,draft.item_key??null]);
const equalFields = (left:SchedulingFields,right:SchedulingFields) => Object.keys(left).length===Object.keys(right).length &&
  Object.entries(left).every(([field,value])=>JSON.stringify(value)===JSON.stringify(right[field as keyof SchedulingFields]));
/** A batch item is bound to its whole captured graph: a sibling, edge or policy
 * changed after capture invalidates the proof even when the item's own fields
 * are unchanged. A single draft carries no graph on either side. */
const sameGraph = (current:TemporalTurnDraft,expected:TemporalTurnDraft) => current.item_key===undefined
  ? current.plan===undefined&&expected.plan===undefined
  : current.plan!==undefined&&expected.plan!==undefined&&JSON.stringify(current.plan)===JSON.stringify(expected.plan);

/** Capture backend identities before inference, scoped to this authenticated
 * turn. Neither the model nor a late caller can manufacture a prior draft. */
export function withTemporalTurnDrafts<T>(drafts:readonly TemporalTurnDraft[],work:()=>T):T {
  // A nested adapter belongs to the already-captured turn. It cannot admit a
  // draft/item first observed after inference into that earlier frame.
  if(snapshots.getStore())return work();
  const captured=new Map<string,TemporalTurnDraft>();
  for(const draft of drafts)if(!captured.has(key(draft)))captured.set(key(draft),structuredClone(draft));
  return snapshots.run(captured,work);
}

/** Invalid semantic metadata rejects the new turn before the effective draft
 * is changed. The caller withdraws its proposal; accepted values remain intact. */
export function schedulingNegativeContext(proof:unknown,args:{source:string|undefined;previous:SchedulingFields;raw:SchedulingFields;
  evidence?:SchedulingTemporalEvidence;operation?:string;draft?:TemporalTurnDraft;now?:Date}):TemporalNegativeContextInput|undefined {
  if(proof==null)return;
  const current=args.draft,expected=current?snapshots.getStore()?.get(key(current)):undefined;
  const input:TemporalNegativeContextInput={proof,...(current&&expected?{binding:{
    expectedDraft:{draft_ref:expected.draft_ref,draft_revision:expected.draft_revision},
    liveDraft:{...current,scope_valid:current.scope_valid&&expected.scope_valid&&current.expires_at===expected.expires_at&&equalFields(current.fields,expected.fields)&&sameGraph(current,expected)},
  }}:{})};
  if(args.source===undefined||!validateTemporalNegativeContext(input,{...args,source:args.source,evidence:args.evidence,operation:args.operation,now:args.now??new Date()}).valid)
    throw Error('TEMPORAL_CONTEXT_UNVERIFIED');
  return input;
}
