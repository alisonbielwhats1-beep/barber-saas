# Estabilização conversacional da Secretária V1

## Estado atual, 27/09/2026 UTC: estabilização final em andamento

A sessão manual e os resultados abaixo são históricos. O staging permanece parado; ainda não há nova build liberada. O Golden mais recente, v9, encerrou com 26 PASS automáticos, 2 FAIL e 2 não executados. A revisão semântica classificou 25 conclusões completas, uma parcial, duas falhas e duas não executadas. Houve duas violações de segurança de quantidade em uma conversa, sem confirmação ou execução. Os originais estão preservados.

As correções posteriores são locais e precisam de nova Golden e do holdout independente ainda não aberto pelos implementadores. A última suíte geral passou 3.638 testes, mas novas correções invalidaram seu congelamento para release. A integração de domínio passou 181 testes; a execução seguinte parou em uma fonte sintética incompleta, investigada em [Fidelidade da fonte no harness](./SECRETARY_EXECUTION_SOURCE_FIDELITY.md). Nenhum desses resultados isolados autoriza declarar prontidão conversacional. Production não foi acessada.

## 26/09/2026, 13:24 BRT — staging corrigido ON para teste manual

Após autorização explícita, candidato `Rc178sgIPRIkRYhtUSoDt` instalado e
iniciado somente para Fixture A / Tatiana A. Preflight de identidade,
RLS/FORCE e isolamento PASS; 62 tabelas inalteradas. Sete páginas autenticadas
HTTP 200. Nenhuma mensagem, confirmation ou chamada paga realizada no preparo.
Limite original preservado: 8/20 tentativas consumidas, 12 restantes.
Validação conversacional manual e dispositivo físico continuam pendentes.
Production não acessada. Os registros OFF/local-only abaixo são históricos.
[Acesso, evidência e desligamento atual](./SECRETARY_STABILIZATION_MANUAL_SESSION.md).

26/09/2026. Implementação autorizada pelo responsável após a auditoria Luna ×
pipeline. Branch `codex/secretary-conversation-stabilization`, mesmo worktree.
Alterações anteriores preservadas. Nenhum acesso a Production, deploy, nova
inferência paga ou mutation operacional nesta etapa local.

## Classe corrigida

O incidente Amanda demonstrou perda pós-Luna: source_time=11h/time=09h eram
corretos no primeiro output, mas eram removidos do draft e conservados no plano.
As continuações não recebiam o alvo da pergunta e preenchiam o campo errado.
Não se introduziu condição por nome de cliente ou horário específico.

- `secretary-clarification.ts` fornece operação, campos aceitos sem refs,
  faltantes, campo solicitado e resposta anterior. Scheduling, Services,
  Customers, Inventory, Financial, Communication e batch passam esse contexto;
  continuação de múltiplas ações conserva chaves e grafo existentes.
- `secretary-action-plan.ts` projeta os campos Scheduling efetivos. Campo
  removido/rejeitado não reaparece a partir da interpretação inicial. Os schemas
  continuam exigindo os mesmos campos obrigatórios e defaults neutros.
- `scheduling-temporal-source.ts` verifica separadamente os papéis em relações
  explícitas de origem→destino e início→fim. Reutiliza o confronto determinístico
  de valores, weekday, datas e timezone. Não corrige valores do modelo. Relações
  não reconhecidas ou negadas conservam o caminho seguro de clarificação.
- `secretary-scheduling.ts` conserva o estado aceito quando uma resposta a campo
  pendente é interpretada no papel errado; nenhuma proposal é habilitada. Não
  amplia busca de agendamento enquanto um seletor temporal explícito estiver
  pendente. A correção subsequente usa o mesmo draft.
- Registry diferencia pedido compreendido mas UNSUPPORTED de AMBIGUOUS. Motivo
  de indisponibilidade usa enum fechado e texto do produto, não prosa livre do
  modelo. O Front não cria card/confirmation quando não existe ação.
- `secretary-passive-observer.cjs` captura HTTP/provider com limites, decode
  assíncrono e isolamento de falhas. O budget mantém reserva durável obrigatória
  antes da rede; coleta posterior de usage não atrasa nem substitui response.
  `flushObservations()` serve ao encerramento/reconciliação, fora do request.
  Observadores históricos em `.demo` permanecem evidência e não devem ser
  reutilizados no novo lançamento. Nenhum observer novo foi instalado remotamente.

Não houve migration, mudança de autoridade, regra de disponibilidade, RLS,
HARD_BLOCK, confirmation, idempotência, EXACT, modelo ou API. Não se afirma
compreensão universal: cláusulas não comprováveis continuam não confirmáveis.

## Verificação e integridade histórica

Testes novos cobrem contexto recebido pelo SDK/coordenador, projeção sem campos
ressuscitados, continuidade do draft, rejeição atômica de patch no papel errado,
busca impedida enquanto origem pendente, datas/horários por papéis, inversões,
intervalos, 552 pares distintos de horas (dentro de um único teste parametrizado
por laço), unsupported sem draft/card e equivalência HTTP com consumidor tardio,
gzip e erro de captura. Não confundir esses controles offline com Luna real.

Resultados intermediários preservados em `.demo/stabilization-*.log`:
109 PASS focados; depois 81 PASS focados; depois 112 PASS focados. Não somar
essas rodadas como uma suíte. Duas rodadas amplas identificaram selos históricos
comparando fontes antigas com arquivos atuais modificados.

Os hashes/expected/manifests históricos NÃO foram alterados. Arquivos-fonte
originais foram recuperados do tar candidato anterior e aceitos somente após
SHA-256 exato com os manifests imutáveis: sete entradas adicionais no arquivo
de fontes pré-Front e quatro no arquivo V1. Somente os mocks de leitura histórica
existentes usam esses bytes; runtime/testes funcionais usam implementação atual.
Nenhuma autorização antiga passa a aceitar o runtime novo.

Regressão completa final em uma única execução:

| Comando | Resultado |
|---|---|
| `npm test -- --maxWorkers=2` | PASS: 2.715 testes / 294 arquivos, 139,07 s |
| `npm run lint` | PASS, exit 0 |
| `npx tsc --noEmit --incremental false` | PASS, exit 0 |
| `npm run build` | PASS, exit 0 (guard local) |

O comando `npm test` exclui `*.integration.test.ts` por contrato do projeto.
Esses números não representam integração com PostgreSQL/staging nem novas
inferências Luna. Logs finais: `.demo/stabilization-suite-complete.log`,
`.demo/stabilization-lint-final.log`, `.demo/stabilization-types-final.log`.
O build usa o guard local existente com flags OFF, credenciais removidas,
DB inacessível e mock de fontes; seu log exclusivo preserva o build histórico.
Log: `packages/salon-secretary/evaluation/results/conversation-stabilization-build.log`.
[Hashes e resumo verificável](./SECRETARY_CONVERSATION_STABILIZATION_EVIDENCE.json)
identificam este recorte local, não um commit publicado nem um selo de promoção.

## Limite de promoção e próximos passos

As 30 conversas novas continuam NOT_EXECUTED; ainda precisam do candidato
construído, preflight, fixture/oracle selados e orçamento de execução controlado.
Não reutilizar a autorização histórica x94 nem converter mock em prova de Luna.
Sessão manual anterior possui limite de 20 tentativas; não foi zerado/aumentado.

Há também uma barreira produtiva já documentada em
`SECRETARY_STAGING_READINESS_AUDIT.md`: `SalonSecretary.sessions` é Map local,
TTL de 20 minutos. Outro worker/reinício resulta em SESSION_NOT_FOUND. A correção
conversacional não resolve persistência/concorrência entre workers. Antes de
canary na arquitetura produtiva, será necessário persistir e serializar sessões
de forma tenant/user-scoped e comprovar continuidade após troca de processo,
revogação, expiração e confirmations concorrentes. Não habilitar Production
simplesmente removendo `SECRETARY_LOCAL_ONLY`/`SECRETARY_DISABLED`.

Staging permanece no último OFF comprovado; não foi religado nesta implementação.
Manual UX, real-device e readiness produtiva permanecem NOT_VALIDATED. E/E2
continuam limitação de ambiente; D original permanece UNKNOWN. Brain/Execution/
Front históricos são preservados nos respectivos recortes.

Sequência restante: identificar e selar o candidato; preparar fixtures/oracle e
orçamento da bateria separadamente do limite manual histórico; publicar somente
quando autorizado o staging; executar as 30 conversas pelo mesmo pipeline usado
na UI com observação passiva; então reteste manual e voz física. Nenhuma dessas
etapas fica aprovada automaticamente pelos resultados offline acima.
