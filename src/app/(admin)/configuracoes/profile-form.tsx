"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/ui/image-upload";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { updateMyProfile } from "./actions";
import { labelClass, noteClass } from "./settings-ui";

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
    <form onSubmit={onSubmit} aria-label="Meu perfil" className="flex min-w-0 flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4">
      <p className={noteClass}>
        Sua foto e seu nome aparecem na equipe e, se você atender clientes, na escolha do profissional.
      </p>
      <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <ImageUpload value={avatarUrl} onChange={setAvatarUrl} folder="profiles" aspectRatio="square" />
        <div className="space-y-3.5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="profile-name" className={labelClass}>Nome<span aria-hidden="true"> *</span></label>
            <Input id="profile-name" name="name" defaultValue={profile.name} required />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="profile-phone" className={labelClass}>Telefone</label>
            <Input id="profile-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={profile.phone ?? ""} placeholder="(11) 90000-0000" />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="profile-email" className={labelClass}>E-mail</label>
            <Input id="profile-email" value={profile.email} disabled aria-label="E-mail da conta" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          Salvar meu perfil
        </Button>
      </div>
    </form>
  );
}
