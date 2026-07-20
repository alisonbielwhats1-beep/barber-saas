import Link from "next/link";
import { Scissors } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default function LoginPage() {
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
            <CardTitle className="font-display text-2xl">Bem-vindo de volta</CardTitle>
            <CardDescription>Entre para acessar seu painel.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Ainda não tem salão?{" "}
              <Link href="/signup" className="text-primary hover:underline">
                Criar conta
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
