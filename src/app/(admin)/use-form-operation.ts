"use client";

import { useCallback, useRef, useState } from "react";

/** React 18 transitions do not track the lifetime of an awaited server action. */
export function useFormOperation(): [boolean, (action: () => Promise<void>) => void] {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback((action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    void action().finally(() => { busy.current = false; setPending(false); });
  }, []);
  return [pending, run];
}
