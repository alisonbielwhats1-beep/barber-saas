"use client";

import { useSyncExternalStore } from "react";

/** Phones and small tablets: below this the panel works as an app (sheets, tab bar, pickers). */
export const MOBILE_QUERY = "(max-width: 767px)";

/**
 * Live `matchMedia` result. The server and the first client render answer `false`
 * (desktop markup), so hydration never mismatches; phones switch right after.
 */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY);
}
