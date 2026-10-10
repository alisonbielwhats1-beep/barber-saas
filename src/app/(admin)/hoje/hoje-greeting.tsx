"use client";

import { useSession } from "next-auth/react";

/** "Bom dia, Helena" above the title, as in the approved prototype. The period of the day comes from the server (salon timezone). */
export function HojeGreeting({ greeting }: { greeting: string }) {
  const { data } = useSession();
  const firstName = data?.user?.name?.trim().split(/\s+/)[0];
  return <p className="text-sm text-muted-foreground">{firstName ? `${greeting}, ${firstName}` : greeting}</p>;
}
