"use client";
import { useCallback, useEffect, useState } from "react";
import { resolveMarketingSegment, SEGMENT_STORAGE_KEY, type MarketingSegmentId } from "./segments";

// Presentation only. Never changes the tenant, role or authentication callback.
export function useMarketingSegment(initialId?: MarketingSegmentId) {
  const [id, setId] = useState<MarketingSegmentId>(initialId ?? "salao");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      if (initialId) { setId(initialId); sessionStorage.setItem(SEGMENT_STORAGE_KEY, initialId); }
      else setId(resolveMarketingSegment(sessionStorage.getItem(SEGMENT_STORAGE_KEY)).id);
    }
    catch { /* Storage may be unavailable in private browsing. */ }
    finally { setReady(true); }
  }, [initialId]);
  const selectSegment = useCallback((next: MarketingSegmentId) => {
    setId(next);
    try { sessionStorage.setItem(SEGMENT_STORAGE_KEY, next); }
    catch { /* The interaction still works without persistence. */ }
  }, []);
  return { segment: resolveMarketingSegment(id), selectSegment, ready };
}
