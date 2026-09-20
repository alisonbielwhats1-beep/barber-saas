"use client";

import { Children, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/** All steps stay mounted so navigating never discards values or changes the payload. */
export function FormWizard({ labels, children, onSubmit, pending, error, submitLabel }: {
  labels: string[]; children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean; error: string | null; submitLabel: string;
}) {
  const [step, setStep] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const sections = Children.toArray(children);
  function changeStep(next: number) {
    setStep(next);
    requestAnimationFrame(() => body.current?.querySelector<HTMLElement>(`[data-wizard-step="${next}"]`)?.focus());
    if (body.current) body.current.scrollTop = 0;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const final = step === labels.length - 1;
    const fields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea"));
    const invalid = fields.find(field => !field.disabled && (final || field.closest("[data-wizard-step]")?.getAttribute("data-wizard-step") === String(step)) && !field.checkValidity());
    if (invalid) {
      const invalidStep = Number(invalid.closest("[data-wizard-step]")?.getAttribute("data-wizard-step"));
      changeStep(invalidStep);
      requestAnimationFrame(() => { invalid.focus(); invalid.reportValidity(); });
      return;
    }
    if (!final) { changeStep(step + 1); return; }
    onSubmit(event);
  }
  return <form noValidate onSubmit={submit} className="admin-wizard-form">
    <ol aria-label="Etapas do cadastro" className="admin-wizard-steps">{labels.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} data-complete={index < step}>
      <span className={index <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}>{index < step ? <Check aria-hidden="true" className="h-3.5 w-3.5"/> : index + 1}</span>
      <span>{label}</span>
    </li>)}</ol>
    <div ref={body} className="admin-wizard-body">
      {sections.map((section, index) => <div key={index} data-wizard-step={index} tabIndex={-1} aria-label={labels[index]} hidden={step !== index}>{section}</div>)}
      {error && <p role="alert" className="mt-4 rounded-xl border border-danger/30 p-3 text-sm text-danger">{error}</p>}
    </div>
    <div className="admin-wizard-footer">
      {step > 0 && <Button type="button" variant="outline" disabled={pending} onClick={() => changeStep(step - 1)}>Voltar</Button>}
      <Button type="submit" disabled={pending} className="flex-1">{pending ? "Salvando…" : step < labels.length - 1 ? "Continuar" : submitLabel}</Button>
    </div>
  </form>;
}
