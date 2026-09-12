"use client";

import { useEffect } from "react";

/** Safari's keyboard and pinch zoom change the visual viewport, not the layout viewport. */
export function ViewportMetrics() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const style = document.documentElement.style;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        style.setProperty("--app-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
        style.setProperty("--app-viewport-width", `${viewport?.width ?? window.innerWidth}px`);
        style.setProperty("--app-viewport-top", `${viewport?.offsetTop ?? 0}px`);
        style.setProperty("--app-viewport-left", `${viewport?.offsetLeft ?? 0}px`);
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      for (const key of ["height", "width", "top", "left"]) style.removeProperty(`--app-viewport-${key}`);
    };
  }, []);
  return null;
}
