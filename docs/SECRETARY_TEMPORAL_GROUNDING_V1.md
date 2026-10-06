# Secretária — temporal grounding e revalidação G, 26/09/2026

**TEMPORAL_GROUNDING_V1 = VALIDATED. HARD_BLOCK_VOICE_G = PASS.**
Staging final OFF às **12:55:23Z / 09:55:23 BRT**. Candidato isolado
`X_pW4ibxpeH-NHIM1dIDS`; sete fontes conferidas por SHA-256 entre checkout e
Codespace. Mudanças locais e candidato de staging; sem promoção, merge ou acesso
a Production. [Evidência sanitizada](./SECRETARY_TEMPORAL_GROUNDING_EVIDENCE.json).

## Causa e correção

O STT anterior preservou domingo; Luna retornou `weekday=6`. O domínio resolvia
o seletor válido no schema sem confrontá-lo com o texto original e aceitou sábado.
Essa falha histórica continua registrada; não foi apagada pelo resultado atual.

`src/lib/scheduling-temporal-source.ts` confronta seletores do modelo com as
referências explícitas do texto e o relógio no timezone do salão, antes da
preparação de proposal. Conflito remove o campo temporal, invalida a referência
de appointment e exige esclarecimento pelo mecanismo existente de reconciliação.
Não troca sábado por domingo silenciosamente. Seletores JSON contraditórios
também são rejeitados. Referências múltiplas/negadas sem atribuição inequívoca
ficam em NEEDS_INPUT.

Integração em `secretary-scheduling.ts`, `scheduling-actions.ts`,
`scheduling-temporal.ts`, `secretary-batch.ts`, `scheduling-batch.ts` e
`salon-secretary.ts`: pendência persistida no draft, preservação de identidade e
campos não temporais, invalidação de confirmação antiga e guard nas continuações
de batch/ActionPlan. Nenhuma alteração de STT, modelo/API, RLS, regra de negócio,
HARD_BLOCK ou requisito de confirmação.

O parser é deliberadamente conservador, não um interpretador universal de
linguagem natural. Data sem ano e dia do mês restringem os componentes explícitos;
não inventam ano/mês. Formas linguísticas fora da cobertura não são certificadas
por este gate. Origem/destino temporal ambíguos requerem esclarecimento.

## Testes e regressão

44 regressões novas: 41 em `scheduling-temporal-source.test.ts` e três em
`secretary-temporal-grounding.test.ts`. Cobrem os sete weekdays, contradições,
hoje/amanhã/depois de amanhã, data explícita/dia do mês, 10h/10h30/dez e meia,
data+weekday, America/Sao_Paulo cruzando meia-noite, negação/correção, draft
persistente, confirmação antiga inválida e continuidade do batch.

Uma execução final, sem somar rodadas:

| Comando | Resultado |
|---|---|
| `npm test -- --maxWorkers=2` | 2.686 PASS / 292 arquivos; 146,05 s |
| `npm run lint` | PASS |
| `npx tsc --noEmit --incremental false` | PASS |
| `npm run build` | PASS local e candidato isolado |

Os contratos históricos de fonte congelada receberam cópias dos bytes anteriores
nos arquivos de apoio de testes. Os hashes/expected históricos não mudaram. A
primeira suíte acusou 14 HASH_MISMATCH nesses contratos; o arquivo-fonte anterior
foi preservado, e a suíte final acima passou. Testes atuais exercitam o guard real.

## G real — uma chamada, sem retries

Mesmo WAV SHA-256
`9b57a829418b1a28189d965fce7f072ef0cbe565261f62b68dcb4e6453ad891b`, sem edição:
“marca o fábio para a massagem com a Tatiana no domingo às 10 horas.”
STT 3.570,09 ms; input→transcript 3.649,90 ms. STT equivalente com arquivo de
áudio; **não é dispositivo físico nem prova da API nativa do navegador**.

Luna retornou `weekday=0`, `time=10:00`; backend resolveu **27/09/2026**, domingo
em America/Sao_Paulo. Massagem de 30 minutos: intervalo 10h–10h30. A fixture
fechada retornou `CONFLICT_HARD_BLOCK / SALON_CLOSED`, `override_allowed=false`,
alternativas vazias, nenhuma proposal executável e Confirmar desabilitado na UI.
ActionPlan NEEDS_INPUT pede outra data/horário. O caminho real correto passou;
a rejeição do retorno errado sábado foi comprovada nas regressões determinísticas.

Session `b89d98f4-901b-46c9-a381-64c37116525c`; plan
`f5086bf0-b0f7-4e72-a7d7-75348fdcc19c`; draft
`25831446-9450-451c-a9e3-b7087ae36ee1`. Nenhuma confirmação enviada.

Backend: 4.537 ms; provider HTTP 200, 4.094 ms, 3.174 tokens de entrada e 298 de
saída. Custo estimado desta janela: **US$0,00054575**, não fatura. Journal anterior
preservado; limite novo de uma chamada consumido uma vez. E2E contínuo não medido:
o transporte controlado da UI introduz espera, portanto não se somam latências
como se fossem uma medição integral. REAL_DEVICE_COST=0; PRODUCTION_CANARY_COST=0.

## Pendências E/E2 e D

**E/E2 = EXPECTED_ENVIRONMENT_GUARD / CONTRACT_NOT_SUPPORTED_IN_STAGING.**
`assertLocalCommunication`, em `src/lib/communication-provider.ts`, exige
APP_ENV test/development e DB local 127.0.0.1:55441/everflair_service_mvp. O
staging atual é recusado por contrato. E1 interpretou três operações; E2 tem
STT anterior, mas não continuidade backend. Não se declara PASS nem se altera
o guard para habilitar comunicação. Não houve chamada nova E/E2.

**D inicial = UNKNOWN.** Auditoria confirma provider SUCCEEDED, 3.100/235 tokens,
seguido de BACKEND_FAILURE, sem SKILLS_LOADED/draft/proposal. Não há exceção causal
correlacionada preservada. O log agregado contém MODULE_NOT_FOUND de um preload
em startup, mas não liga esse evento à requisição cuja chamada de provider
concluiu; atribuir-lhe a causa seria especulação. O sucesso posterior não resolve
o UNKNOWN. Sem repetição nova de D.

## Reconciliação e estado final

62 tabelas comparadas: somente seis AuditLogs adicionados, todos do tenant/user
autorizados: MODEL_CALL_STARTED, MODEL_CALL_FINISHED, SKILLS_LOADED,
OPERATIONS_PREPARED, DIRECT_LUNA e DRAFT. Nenhum removido. Appointment, Service,
Product, NotificationOutbox e demais tabelas inalterados. Zero confirmation,
mutation, override, mensagem externa, efeito indireto ou cross-tenant.

RLS/FORCE inalterados; app_runtime sem SUPERUSER/BYPASSRLS; A/B/no-context PASS.
Sete flags false: ENABLED, FRONT, VOICE, ALLOW_PAID_CALLS, JEV_ROUTER,
MULTI_ACTION_V2 e SCHEDULING_OVERLAP. Allowlist vazia; chave/projeto/preload
removidos do ambiente runtime; candidato encerrado/porta livre; novas mensagens
e confirmações recusadas com ECONNREFUSED.

SAFETY_FAILURE nesta janela=0; falha histórica G=1 preservada.
UNEXPECTED_MUTATIONS=0. Brain COMPLETE, Execution E2E VALIDATED e Front Voice UX
VALIDATED permanecem marcos históricos.

**SECRETARY_STAGING_OPERATIONAL = NOT_VALIDATED para o candidato atual.**
E/E2 incompletos e D UNKNOWN impedem declarar staging integralmente verde.
AUTOMATED_VOICE_PIPELINE/SECRETARY_AUTOMATED_VOICE_V1 = NOT_VALIDATED.
REAL_DEVICE_VOICE = REQUIRES_HUMAN_VALIDATION; READY_FOR_CONTROLLED_PILOT = NO.
Próximo passo: resolver o contrato de E/E2 e a lacuna diagnóstica de D sem
relaxar segurança nem atribuir causa sem evidência. Dispositivo físico continua
pendente; Production não foi acessada e permanece vedada antes desse gate.
