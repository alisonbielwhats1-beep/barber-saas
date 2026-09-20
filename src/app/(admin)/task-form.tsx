"use client";

import { type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Essential fields and disclosures share one submission and keep all values mounted. */
export function TaskForm({ children, onSubmit, pending, error, submitLabel }: {
  children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean; error: string | null; submitLabel: string;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const invalid = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea"))
      .find(field => !field.disabled && !field.checkValidity());
    if (invalid) {
      let parent: HTMLElement | null = invalid.parentElement;
      while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
      requestAnimationFrame(() => { invalid.focus(); invalid.reportValidity(); });
      return;
    }
    onSubmit(event);
  }
  return <form noValidate onSubmit={submit} aria-busy={pending} className="admin-wizard-form admin-task-form">
    <div className="admin-wizard-body space-y-4">{children}
      {error && <p role="alert" className="text-sm text-danger">{error} Você pode corrigir os dados e tentar novamente.</p>}
    </div>
    <div className="admin-wizard-footer"><Button type="submit" disabled={pending} className="flex-1">{pending ? "Salvando…" : submitLabel}</Button></div>
  </form>;
}
