/** Explicit OFFLINE artifact generator. Run from repository root; no provider/env/DB. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { prepareCoverageExpansion } from "./coverage-expansion-plan";
import type { ChoiceAnswer, Decision } from "./contract";

const root = "packages/salon-secretary/evaluation/";
const plan = prepareCoverageExpansion();
const history = ["acceptance-calibration-real-2026-09-23.json", "acceptance-calibration-continuation-real-2026-09-23.json"].map(file => {
  const bytes = readFileSync(root + file);
  const report = JSON.parse(bytes.toString("utf8")) as { cases: { sequence: number; caseId: string; expected: Decision; answers: Record<string, ChoiceAnswer>; classification: string }[] };
  return { file, sha256: createHash("sha256").update(bytes).digest("hex"), completed: report.cases.length,
    decisions: report.cases.flatMap(c => Object.entries(c.answers).map(([dimension, answer]) => {
      const sorted = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
      const runner = sorted.find(([key]) => key !== answer.choice);
      return { sequence: c.sequence, caseId: c.caseId, classification: c.classification,
        expectedIntent: c.expected.metric !== "none" ? c.expected.metric : c.expected.inventory !== "none" ? c.expected.inventory : c.expected.operation,
        dimension, selected: answer.choice,
        probability: answer.probabilities[answer.choice], confidence: answer.confidence, runnerUp: runner?.[0] ?? null,
        runnerUpProbability: runner?.[1] ?? null, margin: sorted.length > 1 ? sorted[0][1] - sorted[1][1] : null,
        correctClosedProjection: answer.choice === c.expected[dimension as keyof Decision],
        note: "Historical, non-paired evidence; projection correctness does not resolve open fields" };
    })) };
});
writeFileSync(root + "coverage-expansion-plan.json", JSON.stringify({ ...plan, historicalEvidence: history }, null, 2) + "\n");
const wave = plan.waves[0], first = wave.cases[0];
const questions = [first.payloads.discovery, first.payloads.detailBySkill.financial].flatMap(p => Object.entries(p.questions).map(([id, q]) => `### ${id}\n\n${q.instructions}\n\nChoices: ${Object.keys(q.criteria).map(x => `\`${x}\``).join(", ")}.\n`));
const table = wave.cases.map(c => `| ${c.id} | ${c.message.replaceAll("|", "\\|")} | ${c.expected.decision.skill} / ${c.expected.decision.shape} | ${c.expected.decision.metric} / ${c.expected.decision.period} | ${c.expected.operations.join(" → ") || "fora do catálogo"} | ${c.classification.proposedValue}; ${c.classification.evidenceState} |`).join("\n");
writeFileSync("docs/SECRETARIA_JEV_COVERAGE_EXPANSION_WAVE1.md", `# Gate 3.1C-B.3 — Wave 1 Financial (NÃO EXECUTADA)\n\nGerado offline por prepare-coverage-expansion.ts. Versão ${plan.version}.\nDataset SHA-256: ${plan.datasetHash}. Payloads SHA-256: ${plan.payloadsHash}.\nCatálogo ${plan.catalog.version}, SHA-256 ${plan.catalog.hash}.\n\n32 avaliações, máximo 64 HTTP, zero retries. Discovery skill/shape; detail metric/period somente após discovery Financial single válido. Nenhuma pergunta operation, Inventory ou Communication. Discovery incompatível para esta onda → fallback sem detail. O gabarito nunca seleciona a ramificação nem entra no payload.\n\nPolicy v1 permanece intacta: somente f01 está inscrito; os demais positivos são candidatos de calibração, não aceites novos. Medir acerto linguístico e risco de projeção fechada separadamente. As contagens de fallback desta policy não medem a cobertura futura de uma policy ampliada.\n\n## Perguntas exatas\n\n${questions.join("\n")}\n## Mensagens e gabarito congelado\n\n| Caso | Mensagem exata | Skill / shape | metric / period | Operações de domínio esperadas | Potencial / estado |\n|---|---|---|---|---|---|\n${table}\n\nCampos abertos, group_by, dependências e motivos estão integralmente no manifest JSON; não são enviados ao JEV. 'multiple' é um seletor insuficiente, não um array de métricas interpretado. Em f21 recebíveis históricos são incompatíveis; não converter ontem em saldo atual. Em f32 'vendi' sem esclarecer serviços/produtos/pagamentos permanece ambíguo.\n\n## Custo e limites\n\nTarifa historicamente auditada em 22/09/2026: input US$0,042/M, output US$0. Reconfirmar oficialmente antes da futura execução. Teto conservador: 64 HTTP × 64.000 tokens × tarifa = US$${wave.maximumPlanningEstimateUsd.toFixed(6)}. Não é custo faturado nem promessa de tarifa vigente. Corpo JSON preparado muito menor; tokenizer não foi chamado.\n\nEnviar somente texto sintético, contexto vazio, model JEV e perguntas/choices publicadas. Não enviar gabarito, tags, classe de risco, evidence, refs, telefone, registros financeiros ou secrets no corpo. Credencial só em Authorization na futura execução autorizada.\n\nParar sem retry em ${plan.stopOn.join(", ")}. UNSAFE_SHADOW_CANDIDATE significa que os seletores fechados pareceriam suficientes, mas omitem/mudam a intenção do oracle; não é ACCEPT_JEV real. Preservar ambos os contadores, nunca promover fallback manualmente. Não iniciar outra onda sem aprovação.\n\nZero OpenAI, Luna fallback, banco, Tools de negócio, Meta, router e efeitos operacionais. Este documento não executa a bateria.\n`);
console.log(JSON.stringify({ goldenCounts: plan.goldenAudit.counts, waves: plan.waves.map(w => ({ wave: w.wave, cases: w.caseCount, httpMax: w.maxHttpCalls, costMax: w.maximumPlanningEstimateUsd,
  potentialBypass: w.cases.filter(c => c.classification.fullBypassPotential).length, routingOnly: w.cases.filter(c => c.classification.routingOnlyPotential).length })), historicalCompleted: history.reduce((n, h) => n + h.completed, 0) }));
