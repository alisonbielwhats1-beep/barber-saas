"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Hand,
  HelpCircle,
  Plus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import "./agenda-mobile-guide.css";

const lessons = [
  {
    title: "Sua agenda, um dia de cada vez",
    text: "Use as setas para trocar o dia ou toque na data para abrir o calendário. Deslize a grade para ver as outras colunas de profissionais.",
    kind: "navigate",
  },
  {
    title: "Do horário à reserva",
    text: "Toque em um horário vazio ou no botão + e escolha Novo agendamento. Para combinar profissionais, escolha a opção de vários serviços.",
    kind: "create",
  },
  {
    title: "Toque para conferir e editar",
    text: "Toque em um agendamento para abrir os detalhes. Quando tiver permissão, use Editar para ajustar os serviços e o horário, conferindo os termos antes de salvar.",
    kind: "edit",
  },
];

export function AgendaMobileGuide({
  scope,
  canCreate = true,
  autoStart = true,
}: {
  scope: string;
  canCreate?: boolean;
  autoStart?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const steps = canCreate
    ? lessons
    : lessons.filter((lesson) => lesson.kind !== "create");
  const lesson = steps[step]!;
  const storageKey = `everflair:agenda-guide:v1:${scope}`;
  useEffect(() => {
    if (!autoStart || !window.matchMedia("(max-width: 767px)").matches) return;
    try {
      if (!localStorage.getItem(storageKey)) setOpen(true);
    } catch {
      /* Help stays available without storage. */
    }
  }, [autoStart, storageKey]);
  useEffect(() => {
    if (open) title.current?.focus();
  }, [step, open]);
  function finish() {
    try {
      localStorage.setItem(storageKey, "seen");
    } catch {
      /* Optional preference, never blocks agenda. */
    }
    setOpen(false);
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
        aria-label="Como usar a agenda"
        className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] left-3 z-40 grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm md:hidden"
      >
        <HelpCircle size={18} aria-hidden />
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) finish();
        }}
      >
        <DialogContent
          mobileSheet
          className="agenda-guide gap-0 overflow-y-auto p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="flex items-center justify-between px-5 pb-3 pr-16 pt-5 text-xs text-muted-foreground">
            <span>GUIA DA AGENDA</span>
            <span>
              {step + 1} de {steps.length}
            </span>
          </div>
          <div
            key={lesson.kind}
            className={`agenda-guide-scene agenda-guide-${lesson.kind}`}
            aria-hidden="true"
          >
            <div className="agenda-guide-date">
              <ArrowLeft size={16} />
              <span>
                <CalendarDays size={16} />
                Segunda, 14
              </span>
              <ArrowRight size={16} />
            </div>
            <div className="agenda-guide-grid">
              <div className="agenda-guide-hours">
                <span>09:00</span>
                <span>10:00</span>
                <span>11:00</span>
              </div>
              <div className="agenda-guide-column">
                <span className="agenda-guide-person">Profissional 1</span>
                <div className="agenda-guide-booking">
                  <span>09:00 – 10:00</span>
                  <strong>Cliente de exemplo</strong>
                  <span>Corte de cabelo</span>
                </div>
              </div>
              <div className="agenda-guide-column">
                <span className="agenda-guide-person">Profissional 2</span>
              </div>
            </div>
            <div className="agenda-guide-hand">
              <Hand size={38} strokeWidth={1.8} />
            </div>
            {lesson.kind === "create" && (
              <div className="agenda-guide-plus">
                <Plus size={24} />
              </div>
            )}
            {lesson.kind === "edit" && (
              <div className="agenda-guide-edit-card">
                Detalhes do agendamento <span>Editar →</span>
              </div>
            )}
            <span className="agenda-guide-example">
              Demonstração · dados fictícios
            </span>
          </div>
          <div className="space-y-4 px-5 pb-5 pt-6">
            <div className="flex gap-1.5" aria-hidden>
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1 rounded-full ${i === step ? "w-7 bg-primary" : "w-3 bg-border"}`}
                />
              ))}
            </div>
            <DialogTitle
              ref={title}
              tabIndex={-1}
              className="text-2xl leading-tight outline-none"
            >
              {lesson.title}
            </DialogTitle>
            <DialogDescription className="text-base leading-relaxed">
              {lesson.text}
            </DialogDescription>
            <button
              type="button"
              onClick={() =>
                step === steps.length - 1 ? finish() : setStep(step + 1)
              }
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground"
            >
              {step === steps.length - 1 ? "Começar a usar" : "Próximo"}
              <ArrowRight size={18} aria-hidden />
            </button>
            <div className="flex justify-between gap-3 text-sm text-muted-foreground">
              {step > 0 ? (
                <button
                  className="min-h-11 px-2"
                  type="button"
                  onClick={() => setStep(step - 1)}
                >
                  Voltar
                </button>
              ) : (
                <span />
              )}
              <button className="min-h-11 px-2" type="button" onClick={finish}>
                Pular tutorial
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
