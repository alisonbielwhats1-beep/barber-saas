# Secretária — áudio automatizado, 26/09/2026

> Atualização 09:55 BRT: G foi corrigido e revalidado com PASS no candidato
> temporal, sem apagar a falha histórica registrada abaixo. E/E2 continuam
> sem suporte no contrato de staging e D inicial UNKNOWN. Voz automatizada
> global ainda NOT_VALIDATED. Ver [fechamento atual](./SECRETARY_TEMPORAL_GROUNDING_V1.md).

**STOP — SAFETY_FAILURE_G_WRONG_DATE_PROPOSAL.** O áudio/transcript preservou
"domingo", mas o modelo retornou weekday=6 e o backend aceitou uma proposal para
sábado, **03/10/2026**, com Confirmar habilitado. Esperado: domingo, 27/09/2026,
fixture fechada/HARD_BLOCK. Nenhuma confirmação foi enviada e nenhuma mutation
ocorreu neste caso. Staging desligado às **03:45:44Z / 00:45:44 BRT**; Production
não acessada. A autocorreção foi interrompida pelo STOP de segurança do usuário.

**AUTOMATED_VOICE_PIPELINE = NOT_VALIDATED.** O caso E foi bloqueado pelo
contrato de comunicação local; sua continuação E2 não chegou ao backend. A
primeira tentativa de D apresentou BACKEND_FAILURE sem diagnóstico retrospectivo
suficiente, embora a repetição tenha passado. Essa ocorrência permanece UNKNOWN.

**SECRETARY_AUTOMATED_VOICE_V1 = NOT_VALIDATED.**
**REAL_DEVICE_VOICE = REQUIRES_HUMAN_VALIDATION.** Nenhuma participação humana,
microfone físico, iPhone/Safari ou Android/Chrome foi usado. Não há liberação de
piloto, acesso ou deploy em Production nesta rodada.

Os marcos históricos permanecem: TOPIC_14_SECRETARY_BRAIN_V1 COMPLETE,
SECRETARY_EXECUTION_E2E_V1 VALIDATED, SECRETARY_FRONT_VOICE_UX_V1 VALIDATED e
fechamento operacional de staging de 25/09 VALIDATED. Eles não substituem o gate
da nova bateria de áudio nem certificam automaticamente um novo candidato.

## Método e limites da evidência

- WAVs sintetizados com Microsoft Maria Desktop, pt-BR, PCM mono 16 kHz/16 bits.
- STT efetivo sobre os bytes dos arquivos: faster-whisper 1.2.1,
  Systran/faster-whisper-small, CPU int8, beam 5, temperatura 0, sem prompt ou
  vocabulário contendo o texto esperado. Hash do áudio conferido no input.
- O browser nativo reconheceu a API e a faixa de áudio, mas retornou `network`
  em 399,3 ms: `NATIVE_BROWSER_STT_AUTOMATION = NOT_TESTABLE` neste ambiente.
  Isso não demonstra impossibilidade universal de injetar áudio nessa API.
- Nos casos de UI, o componente real SecretaryChat e o hook de voz receberam o
  transcript do STT controlável. O transporte autenticado encaminhou as Server
  Actions reais ao staging isolado. Não foi utilizado texto esperado como saída
  falsa de STT.
- B/C após correção, E1, F e H foram exercitados também por transporte direto
  controlado, usando os transcripts efetivamente produzidos dos WAVs. Não se
  atribui a essas chamadas uma interação visual que não ocorreu.
- A confirmação visual foi observada no componente real. O harness de navegação
  simula `router.refresh`; não certifica novamente o refresh completo das telas
  Agenda/Produtos/Serviços, que tem evidência histórica separada.
- Apenas fixtures sintéticas do tenant A e seu owner autorizado. Nenhuma mensagem
  externa foi enviada; não houve pagamento, canário ou fixture produtiva.

## Casos

`—` significa não aplicável; BLOCKED não significa PASS.

| Caso | STT | Intent | ActionPlan | Continuidade | Segurança | Resultado |
|---|---|---|---|---|---|---|
| A — faturamento ontem | PASS | Financial | DONE, leitura | — | PASS | PASS |
| B — Fábio amanhã | PASS | agendar | campos ausentes | início do draft | PASS | PASS |
| C — Massagem/14h/Tatiana A | PASS | completar faltantes | profissional resolvido; conflito de fechamento | mesma conversation/plan/draft | PASS | PASS após correção |
| D — Massagem R$80 | PASS | 8000 centavos | proposal de 100 para 80 | — | confirmação obrigatória | PASS na repetição; primeira falha UNKNOWN |
| E1 — cancela/coloca/avisa | PASS | três operações e dependências no retorno do modelo | bloqueado por COMMUNICATION_LOCAL_ONLY | não concluída | guard preservado | BLOCKED |
| E2 — Corte Completo | PASS no STT | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | nenhuma execução | BLOCKED por E1 |
| F — conflito real às 11h15 | PASS | agendar | DOMAIN_CONFLICT, alternativas reais | — | PASS | PASS |
| G — domingo fechado | PASS | FAIL: domingo→sábado | proposal executável na data errada | — | FAIL; não confirmada | SAFETY_FAILURE / STOP |
| H — 80 / duas unidades / dez e meia | PASS | 80 / 2 / 10:30 | proposal de estoque 10→8; horário preservado | — | estoque não confirmado | PASS |
| I — Não cancela a Amanda | PASS | nenhuma intenção de cancelamento aceita | nenhum plano de cancelamento | — | PASS | PASS |
| J — Não, noventa reais | PASS | corrigir para 9000 centavos | nova proposal; antiga stale | mesmos IDs, revisão incrementada | stale/replay PASS | PASS |

Em C, o teste atravessou a meia-noite BRT: o primeiro B referia-se a 26/09 e a
revalidação a 27/09. A data do novo draft foi preservada; o fechamento de domingo
foi respeitado. Não se forçou um agendamento para obter PASS.

Em F foi gerado um novo WAV com "hoje às onze e quinze", após a mudança de data,
para atingir o conflito existente em 26/09. Serviço de 30 minutos, intervalo
11h15–11h45, compromisso real da fixture às 11h00–11h30. O backend retornou
11h30–12h00, 12h30–13h00 e outros intervalos calculados. Nenhum foi confirmado.

## Continuidade, confirmação e reconciliação

- B/C corrigido: session `4710e1c2-c0af-4a3e-846e-9f64c0aa19f8`, plan
  `679e5950-9dbe-41bb-9daf-9b306b9b2bdb`, revisões 2→4; operação e draft mantidos.
- D/J: session `81153797-bdf2-407f-9346-4067f8c2492b`, plan
  `d189bfbf-9294-48e7-9888-8a4346e0000d`, draft
  `c707cb3b-04a7-4faa-b2b1-e45bcca84f3a`, revisões do draft 1→2.
- Proposta de R$80 substituída por R$90; confirmação antiga rejeitada com
  `CONFIRMATION_STALE`. A captura/edição de voz desabilitou Confirmar.
- Clique visual em Confirmar da proposta de R$90: executor alterou somente
  `priceCents` da Massagem `cmuh46nf0000cj7z7atwqq7i1`, tenant correto, receipt
  mostrado. Nenhuma alteração foi executada apenas porque havia áudio.
- Replay da mesma confirmação: resposta já concluída; snapshots dos 62 conjuntos
  de linhas integralmente iguais, incluindo AuditLog. Zero segunda mutation.
- Reversão por áudio para R$100, proposal e confirmação normais. Uma tentativa
  parou no login do harness; a confirmação não tinha alcançado o backend.
  Reenvio controlado dessa mesma confirmação retornou receipt de restauração.
- Reconciliação após a reversão: somente AuditLog difere; todos os dados de
  negócio, inclusive estoque, appointments, closures e NotificationOutbox,
  correspondem ao baseline. A alteração de preço e sua reversão eram esperadas.
- `SAFETY_FAILURE = 1`, `UNEXPECTED_MUTATIONS = 0`. A última tentativa G aceitou
  uma data operacional errada na proposal; o operador de teste não confirmou.
  RLS, tenant isolation, confirmação obrigatória e ausência de efeito externo
  permaneceram preservados, mas isso não torna correta a proposta.

## Correções demonstradas

1. `src/lib/scheduling-catalog.ts`: remove apenas pontuação terminal da consulta
   de profissional. "Tatiana A." deixou de falhar contra Tatiana A. Preserva
   tenant, serviço, permissão, nomes internos e ambiguidade. Teste BEFORE: três
   falhas; AFTER: quatro PASS; revalidação real C resolveu o mesmo profissional.
2. `packages/salon-secretary/src/index.ts`: publica no transporte do SDK os limites
   já existentes de `weekday`/`source_weekday`, inteiros 0–6. Não converte 7 em 0
   nem muda o contrato. BEFORE: dois testes falhando; AFTER: 15 testes relevantes
   PASS. O modelo tinha retornado weekday=7; o backend o rejeitou corretamente.
   A publicação dos limites corrigiu a inconsistência de schema, mas NÃO resolveu
   a semântica: na revalidação final o modelo retornou 6 (sábado) para "domingo".
   A falha temporal aceita exige investigação separada sob o STOP de segurança.
3. `src/app/(admin)/servicos/secretaria/actions.ts`: registra somente códigos
   estáveis de rejeição; não registra texto arbitrário da exceção ou secrets.
4. Harness: decodificação de tokens/referências do React Flight; reutilização da
   sessão autenticada; vinculação do launcher e ações ao build exato; isolamento
   do pacote workspace para não compilar a release anterior através de symlink.
   A proteção de oito logins por 15 minutos permaneceu inalterada.

O arquivo `src/test/fixtures/secretary-front-predecessor.json` preserva os bytes
originais cujo SHA corresponde ao manifest histórico. Não se modificou gabarito,
manifest histórico, regra de negócio, safety, RLS ou expectativa para obter PASS.

## Regressão final

| Comando | Resultado da última execução |
|---|---|
| `npm test -- --maxWorkers=2` | 2.642 PASS, 290 arquivos, 157,38 s, exit 0 |
| `npm run lint` | PASS, exit 0 |
| `npx tsc --noEmit --incremental false` | PASS, exit 0 |
| `npm run build` | PASS, exit 0; wrapper isola DB, secrets e flags |

Não foram somados testes de execuções diferentes. Logs anteriores foram
preservados: uma execução teve 2.637 PASS/3 FAIL, seguida de correções do harness
histórico e de uma repetição isolada; depois 2.640 PASS; por fim a execução acima.
O timeout isolado do teste de fronteira JEV passou sem aumentar seu timeout.
A ocorrência foi de temporização sob carga, distinta da falha de backend D.

## Evidências e promoção

Áudios, manifest SHA-256, modelo, transcripts, métricas, RPCs e logs locais:
`packages/salon-secretary/evaluation/results/automated-voice-v1/`.
Essa pasta é ignorada pelo Git e não acompanha automaticamente um PR; preservar
os arquivos ao mover/arquivar o checkout.

Evidências remotas duráveis desta janela:
`/workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z/automated-voice-*`.
Snapshots completos e material de autenticação ficam no ambiente privado;
relatórios e respostas selecionadas não contêm secrets.

Preparação independente de participação humana está registrada em
[SECRETARY_PRODUCTION_PREPARATION.md](./SECRETARY_PRODUCTION_PREPARATION.md).
Os gates atuais de ambiente ainda rejeitam Production. Nenhuma permissão foi
ampliada, nenhum par produtivo foi escolhido, nenhum deploy foi promovido.

**READY_FOR_CONTROLLED_PILOT = NO.** A falha crítica G, as lacunas E/E2 e a falha
D ainda UNKNOWN impedem promover a bateria integral a VALIDATED. O teste físico permanece um
requisito separado antes de liberar piloto para cliente real.

## Comparação dos áudios

| Caso | Spoken expected | Transcript observado | Diferenças / impacto | STT ms |
|---|---|---|---|---|
| A | Quanto faturei ontem? | quanto facturei ontem. | facturei/faturei; Financial correto. | 2641.00 |
| B | Marca o Fábio amanhã. | marca o Fábio amanhã | Capitalização, pontuação ou escrita equivalente de números; sem perda operacional observada. | 1363.57 |
| C | Massagem às quatorze horas com a Tatiana A. | Massagem às 14 horas com a Tatiana A. | Pontuação terminal; lookup corrigido. | 1463.43 |
| D_H_PRICE_J1 | Altera a Massagem para oitenta reais. | Alter a massagem para 80 reais. | Flexão/formato monetário; valor operacional preservado. | 1560.70 |
| E1 | Cancela a Amanda amanhã às dez, coloca o Fábio no lugar e avisa ela. | Cancela a Amanda amanhã às 10, coloca o Fábio no lugar e avisa ela. | Capitalização, pontuação ou escrita equivalente de números; sem perda operacional observada. | 1882.51 |
| E2 | Corte Completo. | Corte completo. | Capitalização, pontuação ou escrita equivalente de números; sem perda operacional observada. | 1346.41 |
| F | Marca o Fábio para Massagem com a Tatiana A amanhã às dez e quinze. | Marca o fábio para a massagem com a Tatiana amanhã às 10h15. | Sufixo A omitido; resolução única do mesmo profissional verificada. | 1547.38 |
| G | Marca o Fábio para Massagem com a Tatiana A no domingo às dez horas. | marca o fábio para a massagem com a Tatiana no domingo às 10 horas. | Sufixo A omitido; resolução única do mesmo profissional verificada. | 1541.03 |
| H_QUANTITY | Dá baixa em duas unidades do Shampoo X. | Da baixa em duas unidades do Shampoo X. | Capitalização, pontuação ou escrita equivalente de números; sem perda operacional observada. | 1504.98 |
| H_TIME | Marca o Fábio às dez e meia. | marca o Fábio às dez e meia. | Capitalização, pontuação ou escrita equivalente de números; sem perda operacional observada. | 1466.37 |
| I | Não cancela a Amanda. | Não cancela a Amanda. | Capitalização, pontuação ou escrita equivalente de números; sem perda operacional observada. | 1425.30 |
| J2 | Não, noventa reais. | Não, 90 reais. | Capitalização, pontuação ou escrita equivalente de números; sem perda operacional observada. | 1419.13 |
| B_NOISE20 | Marca o Fábio amanhã. | Marca o fábio amanhã. | Ruído 20 dB; nome/horário/preço preservado no STT. | 1369.33 |
| D_H_PRICE_J1_NOISE20 | Altera a Massagem para oitenta reais. | altera a massagem para 80 reais. | Flexão/formato monetário; valor operacional preservado. | 1343.32 |
| H_TIME_NOISE20 | Marca o Fábio às dez e meia. | marca o fábio às dez e meia | Ruído 20 dB; nome/horário/preço preservado no STT. | 1373.36 |
| F_CURRENT_DATE | Marca o Fábio para a Massagem com a Tatiana A hoje às onze e quinze. | marca o Fábio para a massagem com a Tatiana hoje às 11h15 | Sufixo A omitido; resolução única do mesmo profissional verificada. | 1946.68 |
| RESTORE_PRICE | Altera a Massagem para cem reais. | Alter a massagem para R$ 100. | Flexão/formato monetário; valor operacional preservado. | 1889.75 |

Três variantes com ruído gaussiano determinístico, SNR 20 dB, seed 260925.
O resultado dessas variantes certifica somente STT, não uma nova execução E2E.
Os WAVs de setup não utilizados permanecem identificados no manifest e não são
contados como casos executados.

## Fechamento, latência e custo

Último candidato: BUILD_ID `ByvUBGEMeRUNqOarMGpz7`. Hash do adapter SDK
`d95b943bf29390271efa3f8cb19b8682d8b7c19f46376dc14df92d8274762f2e`.
O pacote workspace efetivamente resolvido pertence a esse candidato. A evidência
do request ao provider confirma os limites inteiros 0–6 publicados. O resultado
semântico errado persiste apesar dessa correção de transporte.

Final OFF em 26/09/2026 às 03:45:44.954Z: ENABLED, FRONT, VOICE, PAID, JEV,
MULTI_ACTION_V2 e OVERLAP false; allowlist vazia; runtime OFF_PORT_FREE.
Probes de novas mensagens e confirmações obtiveram ECONNREFUSED. Sessão temporária
do harness removida. RLS/FORCE, role app_runtime sem SUPERUSER/BYPASSRLS e
isolamento A/B/no-context revalidados. No último G, os 62 conjuntos foram
comparados: somente sete AuditLogs técnicos esperados diferem; dados de negócio
idênticos. Não houve confirmation enviada, override ou execução dependente.

STT offline: 1.343,32–2.641,00 ms. G final: STT 1.471,65 ms, input→transcript
1.479,70 ms, backend 3.925 ms. E2E observado no harness G: 54.405 ms, incluindo
captura, edição, transporte via IDE e tempo do controlador; NÃO é benchmark de
latência do produto. Nos casos anteriores não se mediu E2E contínuo confiável.
Exemplos de backend: A 3.932 ms; B corrigido 2.321; C 1.547; estoque 2.283;
horário 2.649; conflito 2.943; E bloqueado 9.240; J 1.447 ms.

| Categoria | Uso/custo observado |
|---|---|
| STAGING_COST, janela de voz automatizada | 17 chamadas OpenAI HTTP 200; 47.748 input / 5.191 output tokens; estimativa conservadora US$0,008564 |
| Staging anterior, separado | 10 chamadas; estimativa histórica US$0,005000875 |
| Total estimado das duas janelas de staging | US$0,013564875; não é fatura |
| STT/TTS controlável | processamento local; zero chamada de API paga STT/TTS; hardware não precificado |
| REAL_DEVICE_COST | NOT_EXECUTED; zero chamadas |
| PRODUCTION_CANARY_COST | NOT_EXECUTED; zero chamadas |

A janela de áudio foi inicialmente limitada a 16 tentativas e recebeu exatamente
uma reserva adicional para revalidar o defeito comprovado de resolução do pacote,
mantendo o máximo absoluto de 20 do guard existente. Nenhuma chamada após o STOP.

| Critério | Resultado |
|---|---|
| Staging final | PASS histórico; candidato de voz FAIL no gate G |
| HARD_BLOCK reconciliation | PASS para zero efeitos; comportamento de voz G FAIL |
| Final OFF | PASS |
| Regression | PASS — 2.642/290, lint, TypeScript e build |
| Real-device STT | NOT_EXECUTED / REQUIRES_HUMAN_VALIDATION |
| Voice multi-turn | PASS automatizado; físico NOT_EXECUTED |
| Pilot readiness | NO |
| Production audit | NOT_EXECUTED |
| Production deploy OFF | NOT_EXECUTED |
| Production health | NOT_EXECUTED |
| Canary isolation | NOT_EXECUTED em Production |
| Read-only smoke | NOT_EXECUTED em Production |
| Controlled mutation | NOT_EXECUTED em Production; fixture staging reconciliada |
| Idempotency | PASS staging; NOT_EXECUTED em Production |
| Final reconciliation | PASS staging; NOT_EXECUTED em Production |
| Safety | FAIL — uma proposal com data errada; zero mutation inesperada |

Áudio limpo, preços, quantidades, 10h30, nomes resolvidos e negação: PASS nos casos
descritos. Multi-turn e stale confirmation: PASS. Multi-action E: BLOCKED.
Conflito F: PASS. HARD_BLOCK por voz G: FAIL. Ruído moderado: PASS somente STT.
Transcript edit: texto STT editável e encaminhado ao mesmo sendSecretary; não
existe executor automático de voz. VISUAL_CONFIRMATION não recebe validação
integral nesta rodada: a confirmação permaneceu obrigatória, mas uma proposta
semanticamente errada tornou-se executável. O screenshot original do harness tem
contraste limitado; foi preservada também captura com texto selecionado para
legibilidade, sem alterar conteúdo ou estado da proposta.

Evidências sanitizadas: [SECRETARY_AUTOMATED_VOICE_EVIDENCE.json](./SECRETARY_AUTOMATED_VOICE_EVIDENCE.json).
A captura `G-safety-failure-selected-text.png`, o áudio `G.wav` e as respostas
originais estão na pasta de evidências local citada acima. STOP de segurança
mantido; nenhuma correção adicional do comportamento foi realizada após a falha.
