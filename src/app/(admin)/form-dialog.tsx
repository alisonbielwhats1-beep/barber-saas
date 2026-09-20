"use client";

import * as React from "react";
import * as Base from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export { DialogTrigger, DialogClose, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
const ChangeContext = React.createContext(() => {});

/** Opt-in contract for owner forms. Programmatic success can still close the root. */
export function Dialog({ open, onOpenChange, children, pending = false, dirtyKey = "" }: {
  open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode;
  pending?: boolean; dirtyKey?: string;
}) {
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const currentKey = React.useRef(dirtyKey);
  currentKey.current = dirtyKey;
  const [baseline, setBaseline] = React.useState(dirtyKey);
  React.useEffect(() => {
    setDirty(false); setConfirm(false); setBaseline(currentKey.current);
  }, [open]);
  const changed = dirty || baseline !== dirtyKey;
  React.useEffect(() => {
    if (!open || !changed) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, changed]);
  function requestOpen(next: boolean) {
    if (next) { setBaseline(dirtyKey); setDirty(false); onOpenChange(true); return; }
    if (pending) return;
    if (changed) { returnFocus.current = document.activeElement as HTMLElement; setConfirm(true); }
    else onOpenChange(false);
  }
  return <ChangeContext.Provider value={() => setDirty(true)}>
    <Base.Dialog open={open} onOpenChange={requestOpen}>
      {children}
      <Base.Dialog open={confirm} onOpenChange={setConfirm}>
        <Base.DialogContent onCloseAutoFocus={event => { if (open && returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}>
          <Base.DialogHeader><Base.DialogTitle>Descartar alterações?</Base.DialogTitle>
            <Base.DialogDescription>As alterações ainda não foram salvas.</Base.DialogDescription></Base.DialogHeader>
          <Base.DialogFooter>
            <Button type="button" variant="outline" autoFocus onClick={() => setConfirm(false)}>Continuar editando</Button>
            <Button type="button" variant="destructive" onClick={() => { setConfirm(false); setDirty(false); onOpenChange(false); }}>Descartar alterações</Button>
          </Base.DialogFooter>
        </Base.DialogContent>
      </Base.Dialog>
    </Base.Dialog>
  </ChangeContext.Provider>;
}

export const DialogContent = React.forwardRef<React.ElementRef<typeof Base.DialogContent>, React.ComponentPropsWithoutRef<typeof Base.DialogContent>>(
  ({ onChangeCapture, ...props }, ref) => {
    const changed = React.useContext(ChangeContext);
    return <Base.DialogContent ref={ref} {...props} onChangeCapture={event => { if (!(event.target as HTMLElement).closest("[data-draft-ignore]")) changed(); onChangeCapture?.(event); }} />;
  },
);
DialogContent.displayName = "FormDialogContent";
