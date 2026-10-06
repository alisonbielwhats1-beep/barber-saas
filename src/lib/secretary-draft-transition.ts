type DraftVersion={draft_ref:string;draft_revision:number};
type DraftState={draft?:DraftVersion;proposal?:unknown;message:string;cancel?:DraftState};

/** An accepted database revision cannot be rolled back by a later in-memory error. */
function publishCommitted(current:DraftState,next:DraftState):boolean{
  if(next.draft&&(!current.draft||next.draft.draft_ref!==current.draft.draft_ref||next.draft.draft_revision>current.draft.draft_revision)){
    next.proposal=undefined;
    next.message="Os dados estão preservados. Não consegui preparar a confirmação. Tente novamente.";
    Object.assign(current,next);return true;
  }
  // A dependent cancellation can commit before the message draft is prepared.
  // Preserve only that accepted child, never the parent's uncommitted fields.
  if(current.cancel&&next.cancel&&publishCommitted(current.cancel,next.cancel)){
    current.message=next.cancel.message;return true;
  }
  return false;
}

/** Stage fields privately; publish success or the exact draft already committed. */
export async function applyDraftTransition<T extends DraftState>(current:T,operation:(next:T)=>Promise<unknown>):Promise<void>{
  current.proposal=undefined;
  const next=structuredClone(current);
  try{await operation(next);Object.assign(current,next);}
  catch(error){publishCommitted(current,next);throw error;}
}
