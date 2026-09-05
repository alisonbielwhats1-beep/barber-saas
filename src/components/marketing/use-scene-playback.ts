"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { MARKETING_SEGMENTS, type MarketingSegmentId } from "./segments";

export function useScenePlayback(id: MarketingSegmentId, select: (id: MarketingSegmentId) => void, ready: boolean, scene: RefObject<HTMLElement>) {
  const [reduced, setReduced] = useState(true);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [manualVersion, setManualVersion] = useState(0);
  const holdUntil = useRef(0);
  const explicitPlay = useRef(false);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReduced(media.matches); explicitPlay.current = false; };
    const visibility = () => setHidden(document.hidden);
    update(); visibility();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    if (scene.current) observer.observe(scene.current);
    return () => { media.removeEventListener("change", update); document.removeEventListener("visibilitychange", visibility); observer.disconnect(); };
  }, [scene]);

  const enabled = !paused && (!reduced || explicitPlay.current);
  const active = ready && enabled && visible && !hidden && !interacting;
  useEffect(() => {
    if (!active) return;
    const delay = Math.max(8000, holdUntil.current - Date.now());
    const timer = window.setTimeout(() => {
      const index = MARKETING_SEGMENTS.findIndex(item => item.id === id);
      select(MARKETING_SEGMENTS[(index + 1) % MARKETING_SEGMENTS.length].id);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [active, id, select, manualVersion]);

  const pick = useCallback((next: MarketingSegmentId) => {
    holdUntil.current = Date.now() + 16000;
    setManualVersion(value => value + 1);
    select(next);
  }, [select]);
  function toggle() {
    if (reduced && !explicitPlay.current) { explicitPlay.current = true; setPaused(false); setManualVersion(value => value + 1); }
    else setPaused(value => !value);
  }
  return { reduced, enabled, active, pick, toggle, setInteracting, visible, hidden };
}
