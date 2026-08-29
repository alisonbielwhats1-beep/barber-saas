"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { submitClientReview } from "../reviews-actions";

export function ReviewDialog({
  salonSlug,
  appointmentId,
  serviceName,
}: {
  salonSlug: string;
  appointmentId: string;
  serviceName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
      setRating(0);
      setComment("");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitClientReview(salonSlug, {
        appointmentId,
        rating,
        comment,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-400/10"
      >
        <Star aria-hidden="true" className="h-3.5 w-3.5" /> Avaliar atendimento
      </button>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Como foi seu atendimento?</DialogTitle>
            <DialogDescription>
              Sua avaliação verificada ajuda outras pessoas a escolherem {serviceName}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-5">
            <fieldset>
              <legend className="text-sm font-medium">Sua nota</legend>
              <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Nota de 1 a 5">
                {Array.from({ length: 5 }, (_, index) => {
                  const value = index + 1;
                  const selected = value <= rating;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={value === rating}
                      aria-label={`${value} ${value === 1 ? "estrela" : "estrelas"}`}
                      onClick={() => setRating(value)}
                      className="grid h-11 w-11 place-items-center rounded-xl transition hover:bg-amber-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Star
                        aria-hidden="true"
                        className={`h-6 w-6 ${selected ? "text-amber-400" : "text-muted-foreground/35"}`}
                        fill={selected ? "currentColor" : "none"}
                      />
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="block text-sm font-medium" htmlFor={`review-comment-${appointmentId}`}>
              Comentário <span className="font-normal text-muted-foreground">(opcional)</span>
              <textarea
                id={`review-comment-${appointmentId}`}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={500}
                rows={4}
                placeholder="Conte como foi sua experiência…"
                className="mt-2 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-normal outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <span className="mt-1 block text-right text-[11px] font-normal text-muted-foreground">
                {comment.length}/500
              </span>
            </label>

            {error && (
              <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <button
                type="button"
                onClick={() => close(false)}
                className="min-h-11 rounded-xl px-4 text-sm text-muted-foreground hover:bg-secondary/70"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending || rating === 0}
                className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                {pending ? "Enviando…" : "Publicar avaliação"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
