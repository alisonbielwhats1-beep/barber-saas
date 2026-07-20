import Link from "next/link";
import { Scissors } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 font-display text-xl">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Scissors className="h-4 w-4" />
          </span>
          Salon<span className="text-primary">SaaS</span>
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-2xl">Criar salão</CardTitle>
            <CardDescription>
              Em 30 segundos você tem sua agenda online e a URL de reservas do cliente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignupForm />
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Já tem conta?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Entrar
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
