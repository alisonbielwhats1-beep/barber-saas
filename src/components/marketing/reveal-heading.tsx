"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import "./reveal-heading.css";

type Props = { as?: "h1" | "h2" | "h3"; id?: string; lines: string[]; intro?: boolean };

/** Keep headings readable before hydration and expose one complete accessible name. */
export function RevealHeading({ as: Tag = "h2", id, lines, intro = false }: Props) {
  const root = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const heading = root.current;
    if (!heading || intro) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches || !("IntersectionObserver" in window)) return;
    // Never hide a heading restored in view by an anchor, history, or hydration.
    if (heading.getBoundingClientRect().top < innerHeight) return;
    heading.dataset.reveal = "pending";
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        heading.dataset.reveal = "visible";
        observer.disconnect();
      }
    }, { threshold: 0.15, rootMargin: "0px 0px -5% 0px" });
    const show = () => { if (media.matches) { heading.dataset.reveal = "visible"; observer.disconnect(); } };
    media.addEventListener("change", show);
    observer.observe(heading);
    return () => { observer.disconnect(); media.removeEventListener("change", show); };
  }, [intro]);

  let index = 0;
  return <Tag ref={root} id={id} className="rv-heading" data-intro={intro || undefined} aria-label={lines.join(" ")}>
    {lines.map((line, lineIndex) => <span className="rv-line" data-accent={lineIndex > 0} key={line} aria-hidden="true">
      {intro ? <span className="rv-line-content" style={{ "--rv-line-delay": `${lineIndex * 80}ms` } as CSSProperties}>{line}</span> : line.split(" ").map((word, wordIndex) => <span key={wordIndex}><span className="rv-word">{Array.from(word).map((char, charIndex) => <span className="rv-char" key={charIndex} style={{ "--rv-delay": `${Math.min(index++ * 12, 420)}ms` } as CSSProperties}>{char}</span>)}</span>{" "}</span>)}
    </span>)}
  </Tag>;
}
