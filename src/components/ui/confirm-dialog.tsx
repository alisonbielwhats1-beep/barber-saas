"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  useDialogMobileSheetDefault,
} from "./dialog";
import { Button } from "./button";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dialog de confirmação para ações destrutivas. Controlado por fora:
 * o chamador guarda o alvo em state e passa `open`/`onOpenChange`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Excluir",
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  // A aparência de folha de ação só vale onde a janela é folha inferior (painel do estabelecimento);
  // fora dele (ex.: "Minhas reservas" do cliente) a confirmação continua como em produção.
  const sheet = useDialogMobileSheetDefault();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No painel, no celular, é uma folha de ação: aviso centralizado e botões grandes empilhados (confirmar em cima). */}
      <DialogContent className="max-w-sm">
        <DialogHeader className={cn(sheet && "max-md:items-center max-md:pr-0 max-md:text-center")}>
          <div className={cn("mb-1 grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive", sheet && "max-md:h-12 max-md:w-12")}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle className={cn(sheet && "max-md:text-lg max-md:leading-snug")}>{title}</DialogTitle>
          {description && (
            <p className={cn("text-[13px] leading-relaxed text-muted-foreground", sheet && "max-md:text-sm")}>{description}</p>
          )}
        </DialogHeader>
        <DialogFooter className={cn(sheet && "max-md:gap-2.5")}>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending} className={cn(sheet && "max-md:min-h-12 max-md:rounded-xl max-md:text-[15px]")}>
            Cancelar
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={pending} className={cn(sheet && "max-md:min-h-12 max-md:rounded-xl max-md:text-[15px] max-md:font-semibold")}>
            {pending ? "Excluindo…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
