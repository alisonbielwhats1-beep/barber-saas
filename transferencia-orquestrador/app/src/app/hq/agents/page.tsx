import { isHqEnabled, withHq } from "@/lib/hq/access";
import { AgentLab } from "@/components/hq/agent-lab";
import { ChiefPilot } from "@/components/hq/chief-pilot";
import { loadChiefState } from "@/lib/hq/chief-service";
import Link from "next/link";

export const maxDuration = 60;

export default async function AgentsPage() {
  if (!isHqEnabled()) return null;
  await withHq(async () => undefined);
  const initial = await loadChiefState();
  return <><nav className="hq-panel hq-actions" aria-label="Operação dos agentes"><Link href="/hq/agents/orchestrator">Testar Triage → Product → Chief</Link><Link href="/hq/agents/support">Suporte assistido</Link><Link href="/hq/agents/knowledge">Base de conhecimento</Link></nav><ChiefPilot initial={initial} /><AgentLab /></>;
}
