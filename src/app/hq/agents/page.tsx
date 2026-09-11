import { isHqEnabled, withHq } from "@/lib/hq/access";
import { AgentLab } from "@/components/hq/agent-lab";
import { ChiefPilot } from "@/components/hq/chief-pilot";
import { loadChiefState } from "@/lib/hq/chief-service";

export const maxDuration = 60;

export default async function AgentsPage() {
  if (!isHqEnabled()) return null;
  await withHq(async () => undefined);
  const initial = await loadChiefState();
  return <><ChiefPilot initial={initial} /><AgentLab /></>;
}
