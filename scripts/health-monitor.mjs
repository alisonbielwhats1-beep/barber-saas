import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const HEALTH_URL = "https://salon-saas-ruby.vercel.app/api/health";

// Never publish response bodies, headers, credentials or arbitrary error messages.
export async function probeHealth({ fetcher = fetch, wait = delay, attempts = 3, timeoutMs = 10000 } = {}) {
  let reason = "NETWORK_OR_TIMEOUT";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(HEALTH_URL, {
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: "application/json" },
      });
      if (response.status !== 200) {
        reason = `HTTP_${response.status}`;
      } else {
        try {
          const body = await response.json();
          if (body?.status === "ok" && body?.service === "salon-saas" && body?.checks?.database === "ok") {
            return { healthy: true, reason: "OK", attempts: attempt };
          }
          reason = "INVALID_HEALTH_RESPONSE";
        } catch {
          reason = "INVALID_HEALTH_RESPONSE";
        }
      }
    } catch {
      reason = "NETWORK_OR_TIMEOUT";
    }
    if (attempt < attempts) await wait(10000);
  }
  return { healthy: false, reason, attempts };
}

const marker = "<!-- everflair-availability-monitor-v1 -->";

export async function reconcileIncident({ github, context, result }) {
  const repo = context.repo;
  const issues = await github.paginate(github.rest.issues.listForRepo, { ...repo, state: "open", per_page: 100 });
  const incident = issues.find(issue => !issue.pull_request && issue.user?.login === "github-actions[bot]" && issue.body?.includes(marker));
  const run = `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
  if (!result.healthy && !incident) {
    const created = await github.rest.issues.create({
      ...repo,
      title: "[Disponibilidade] Everflair precisa de atenção",
      body: `${marker}\n\nA sonda pública falhou após três tentativas.\n\n- Destino: ${HEALTH_URL}\n- Motivo: ${result.reason}\n- Execução: ${run}\n\nResponsável operacional: @alisonbielwhats1-beep. Consultar docs/OPERACAO_GRATUITA_2026-09-07.md. Nenhum dado de cliente é incluído neste registro.`,
    });
    return { action: "opened", issue: created.data.number };
  }
  if (result.healthy && incident) {
    // One update closes the incident; no repeated comments on healthy checks.
    await github.rest.issues.update({
      ...repo, issue_number: incident.number, state: "closed", state_reason: "completed",
      body: `${incident.body}\n\nRecuperado: aplicação e banco responderam normalmente. Execução: ${run}`,
    });
    return { action: "closed", issue: incident.number };
  }
  return { action: "unchanged", issue: incident?.number ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await probeHealth();
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `result=${JSON.stringify(result)}\n`);
  else if (!result.healthy) process.exitCode = 1;
}
