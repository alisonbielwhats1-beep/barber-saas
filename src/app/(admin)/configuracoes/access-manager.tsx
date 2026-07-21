"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserPlus, Trash2, Loader2 } from "lucide-react";
import { inviteMember, changeMemberRole, removeMember } from "./actions";

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
  isSelf: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Dono",
  MANAGER: "Gerente",
  PROFESSIONAL: "Profissional",
  RECEPTIONIST: "Recepção",
};
const ROLE_COLOR: Record<string, string> = {
  OWNER: "#2ECC8B",
  MANAGER: "#3B9EFF",
  PROFESSIONAL: "#A855F7",
  RECEPTIONIST: "#F59E0B",
};

export function AccessManager({ members, canManage }: { members: Member[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = { name: String(f.get("name")), email: String(f.get("email")), role: String(f.get("role")) };
    setError(null);
    startTransition(async () => {
      try {
        await inviteMember(payload);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao convidar");
      }
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between p-5 pb-3">
        <div>
          <h3 className="text-[13px] font-semibold">Acessos da equipe</h3>
          <p className="text-[11px] text-muted-foreground">Quem pode entrar no painel e com qual papel.</p>
        </div>
        {canManage && (
          <button
            onClick={() => { setError(null); setOpen(true); }}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <UserPlus className="h-3.5 w-3.5" /> Convidar
          </button>
        )}
      </div>

      {error && <p className="mx-5 mb-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}

      <div className="divide-y divide-border">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 px-5 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-black/80" style={{ background: ROLE_COLOR[m.role] ?? "#94A3B8" }}>
              {m.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">
                {m.name} {m.isSelf && <span className="text-[11px] text-muted-foreground">(você)</span>}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{m.email}</p>
            </div>
            {canManage && !m.isSelf ? (
              <select
                value={m.role}
                disabled={pending}
                onChange={(e) => run(() => changeMemberRole(m.userId, e.target.value))}
                className="h-8 rounded-lg border border-border bg-background px-2 text-[12px]"
              >
                {Object.keys(ROLE_LABEL).map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            ) : (
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: `${ROLE_COLOR[m.role]}1f`, color: ROLE_COLOR[m.role] }}>
                {ROLE_LABEL[m.role] ?? m.role}
              </span>
            )}
            {canManage && !m.isSelf && (
              <button
                onClick={() => run(() => removeMember(m.userId))}
                disabled={pending}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:text-danger"
                title="Remover acesso"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar para a equipe</DialogTitle>
          </DialogHeader>
          <form onSubmit={onInvite} className="grid gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Nome</label>
              <Input name="name" required autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <Input name="email" type="email" required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Papel</label>
              <select name="role" defaultValue="RECEPTIONIST" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {Object.keys(ROLE_LABEL).map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Se o email ainda não tem conta, criamos uma com a senha inicial <code>trocar-agora</code>, que a pessoa altera no primeiro acesso.
            </p>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline" type="button">Cancelar</Button></DialogClose>
              <Button type="submit" disabled={pending}>{pending ? "Convidando…" : "Convidar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
