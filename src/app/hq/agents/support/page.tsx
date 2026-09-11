import Link from "next/link";
import { loadSupportState } from "@/lib/hq/support-service";
import { SupportWorkbench } from "@/components/hq/support-workbench";
export const maxDuration=60;
export default async function SupportPage(){
 const initial=await loadSupportState();
 return <><div className="hq-heading"><div><h1>Suporte assistido</h1><p>Prepare e revise o atendimento de cada cliente.</p></div><Link href="/hq/agents/knowledge">Base de conhecimento</Link></div><SupportWorkbench initial={initial}/></>;
}
