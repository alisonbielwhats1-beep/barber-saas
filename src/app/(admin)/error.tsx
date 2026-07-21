"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const isForbidden = error.message?.includes("Forbidden") || error.message?.includes("requires one of");

  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/10">
        <AlertTriangle className="h-8 w-8 text-danger" />
      </div>

      <div>
        <h2 className="text-xl font-semibold">
          {isForbidden ? "Acesso não autorizado" : "Algo deu errado"}
        </h2>
        <p className="mt-2 max-w-sm text-[13px] text-muted-foreground">
          {isForbidden
            ? "Sua conta não tem permissão para acessar esta área. Verifique se está logado com as credenciais corretas."
            : "Ocorreu um erro inesperado. Tente novamente ou entre em contato com o suporte."}
        </p>
      </div>

      <div className="flex items-center gap-3">
        {isForbidden ? (
          <Button onClick={() => router.push("/login")} className="gap-2">
            <LogIn className="h-4 w-4" /> Ir para o login
          </Button>
        ) : (
          <Button onClick={reset} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Tentar novamente
          </Button>
        )}
        <Button variant="ghost" onClick={() => router.push("/dashboard")}>
          Voltar ao dashboard
        </Button>
      </div>

      {error.digest && (
        <p className="text-[11px] text-muted-foreground/40">ref: {error.digest}</p>
      )}
    </div>
  );
}
