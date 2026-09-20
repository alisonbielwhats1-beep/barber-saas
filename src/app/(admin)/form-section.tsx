"use client";

import { useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Optional fields stay mounted so collapsing a section never clears form values. */
export function FormSection({ title, description, children, defaultOpen = false }: {
  title: string; description?: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  return <details ref={ref} open={defaultOpen || undefined} className="admin-form-section" onInvalidCapture={() => { if (ref.current) ref.current.open = true; }}>
    <summary><span><span className="block font-medium">{title}</span>{description && <span className="mt-1 block text-xs font-normal text-muted-foreground">{description}</span>}</span><ChevronDown size={16} aria-hidden /></summary>
    <div className="grid min-w-0 gap-4">{children}</div>
  </details>;
}
