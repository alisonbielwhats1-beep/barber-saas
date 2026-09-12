import Link from "next/link";
import { withHq } from "@/lib/hq/access";
import { orchestratorConfig } from "@/lib/hq/orchestrator-config";
import { OrchestratorLab } from "@/components/hq/orchestrator-lab";

export const maxDuration = 60;

export default async function OrchestratorPage() {
  await withHq(async () => undefined);
  const { ready, reason, dailyLimit } = orchestratorConfig();
  return <><nav className="hq-panel hq-actions"><Link href="/hq/agents">Voltar aos agentes</Link></nav>
    <OrchestratorLab ready={ready} reason={reason} dailyLimit={dailyLimit} /></>;
}
