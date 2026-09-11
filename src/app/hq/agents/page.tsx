import { isHqEnabled, withHq } from "@/lib/hq/access";
import { AgentLab } from "@/components/hq/agent-lab";

export default async function AgentsPage() {
  if (!isHqEnabled()) return null;
  await withHq(async () => undefined);
  return <AgentLab />;
}
