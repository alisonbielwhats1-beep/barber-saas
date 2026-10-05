"use client";
import dynamic from "next/dynamic";

/** The Secretária dock, loaded only where the layout renders it (the Secretária enabled for this salon and user). The admin
 * layout never pulls the chat, its server actions or the Secretária runtime into every page otherwise. */
export const SecretaryDockLazy = dynamic(() => import("./secretary-dock").then(module => module.SecretaryDock), { ssr: false });
