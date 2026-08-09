"use client";

import { useState, useTransition } from "react";
import { Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/ui/image-upload";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { updateMyProfile } from "./actions";

export function ProfileForm({
  profile,
}: {
  profile: { name: string; email: string; phone: string | null; avatarUrl: string | null };
}) {
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await updateMyProfile({
          name: String(form.get("name") ?? ""),
          phone: String(form.get("phone") ?? ""),
          avatarUrl,
        });
        toast("Perfil atualizado", "success");
      } catch (error) {
        toast(error instanceof Error ? error.message : "Não foi possível salvar", "error");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <UserRound className="h-4 w-4 text-primary" />
        <h2 className="text-[13px] font-semibold">Meu perfil</h2>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Sua foto e seu nome aparecem na equipe e, se você atender clientes, na escolha do profissional.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-[9rem_1fr]">
        <ImageUpload value={avatarUrl} onChange={setAvatarUrl} folder="profiles" aspectRatio="square" />
        <div className="space-y-3">
          <div>
            <label htmlFor="profile-name" className="mb-1 block text-xs font-medium">Nome</label>
            <Input id="profile-name" name="name" defaultValue={profile.name} required />
          </div>
          <div>
            <label htmlFor="profile-phone" className="mb-1 block text-xs font-medium">Telefone</label>
            <Input id="profile-phone" name="phone" defaultValue={profile.phone ?? ""} placeholder="(11) 90000-0000" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">E-mail</label>
            <Input value={profile.email} disabled aria-label="E-mail da conta" />
          </div>
        </div>
      </div>
      <Button type="submit" className="mt-4" disabled={pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Salvar meu perfil
      </Button>
    </form>
  );
}
