# Secretária — troca de pedido durante uma conversa

## Causa demonstrada

O staging executava o candidato correto (`Rc178sgIPRIkRYhtUSoDt`). Na sessão
`925e025a-68e1-4ed2-8b73-c3458313f282`, o pedido de preço de serviço foi enviado
pelo coordenador ao schema Scheduling por causa da operação pendente/selecionada.
O schema não tinha preço. O output retornou campos nulos e o mesmo rascunho
continuou perguntando pelo agendamento. Não era ausência da arquitetura no runtime.

A busca de Amanda também se limitava, por contrato existente, a agendamentos
futuros PENDING/CONFIRMED. Os horários de 11h/12h visíveis já tinham passado.
A correção não altera elegibilidade nem torna esses agendamentos mutáveis.

## Correção da classe de defeito

- `packages/salon-secretary/src/conversation-routing.ts`: escopo por AsyncLocalStorage
  e resultado tipado `SecretaryNewRequest`, validado pelo registry existente.
- `packages/salon-secretary/src/index.ts`: na mesma inferência, continuação pode
  retornar `new_request`. Patch antigo junto com novo pedido é rejeitado antes
  dos adapters. Fora do coordenador, esse campo não é aceito. Restrições de
  weekday/keys/dependencies são publicadas também no schema aninhado.
- `src/lib/salon-secretary.ts`: intercepta novo pedido antes do adapter aplicar
  patch; preserva rascunhos/planos anteriores para retomada, troca plano ativo,
  invalida confirmações anteriores, conserva quota consumida e TTL, revalida
  tenant/permissões na retomada. Até cinco planos preservados por sessão.
  Um plano concluído também não impede descobrir o pedido seguinte.
- Actions/Front: permite sair da seleção e retomar pedido preservado; mudança de
  plano limpa a seleção antiga. Resposta UNSUPPORTED não é substituída pela frase
  genérica de proposta pronta.
- `src/lib/secretary-scheduling.ts`: explica o escopo futuro/pendente/confirmado
  quando a busca não encontra agendamento elegível.

Não há parser por nome/frase, novo modelo/API, execução automática por texto/voz,
relaxamento de HARD_BLOCK, temporal grounding, permission, RLS ou confirmation.

## Validação offline

- `npm test -- --maxWorkers=2`: 2.725 testes / 295 arquivos PASS em uma execução
  (13:54:04 BRT, 219,99 s). O script exclui `*.integration.test.ts`.
- `npx vitest run src/lib/__tests__/salon-secretary-ui.test.tsx --maxWorkers=2`:
  33 testes PASS, execução separada; não somados à suíte anterior.
- `npm run lint`: PASS.
- `npx tsc --noEmit --incremental false`: PASS.
- `npm run build`: PASS em Node 22.16.0 Linux x64, Docker local isolado, sem
  credenciais de ambiente ou conexão a banco. Build `bdaZlMGxZrqOX-s0fP9vu`.
  Primeira tentativa falhou por encoding UTF-8; causa corrigida e log preservado.

As regressões cobrem troca de domínio, novo pedido da mesma capacidade, retomada,
rascunho intacto, tenant/permissão, confirmação stale, proposta antiga preservada
sem execução, pedido após consulta concluída, campos contraditórios rejeitados,
metadata fora de escopo e schema com os mesmos guards.

## Reconciliação anterior à reativação

Staging OFF comprovado em 26/09/2026 16:40:09Z, allowlist vazia, flags e paid OFF.
O primeiro preflight bloqueou `BASELINE_CHANGED`: somente AuditLog havia mudado.
Reconciliação: 61 tabelas operacionais intactas; 27 audits novos; zero audits
anteriores alterados/removidos. Todos no tenant/user autorizados, entre
16:29:51Z e 16:32:39Z: 5 MODEL_CALL_STARTED + 5 MODEL_CALL_FINISHED + 5 DIRECT_LUNA
+ 4 DRAFT + 4 OPERATIONS_PREPARED + 3 SCHEDULING_TIMINGS + 1 SKILLS_LOADED.
Baseline original preservado. Novo snapshot reconciliado fixado por SHA-256
`03577168ba2386b363d089a655c03286ed203a46899ff326d20efa4d462e58a3`.
Nenhuma tabela/fixture/expected foi editada. Controle continua exigindo igualdade
exata de todas as 62 tabelas com esse checkpoint e preserva o limite original.

## Limites

O teste offline com output controlado não prova que Luna sempre decidirá corretamente
em linguagem livre. Reteste real do caso afetado permanece necessário. Não foi
enviada mensagem ou confirmation pelo agente nesta correção. Runtime ainda usa
sessões em memória; não equivale a prontidão para múltiplos workers produtivos.
E/E2 continua limitado por Communication; D histórico permanece UNKNOWN; dispositivo
físico permanece pendente. Production não acessada.

## Instalação verificada em 26/09/2026 14:02 BRT

Build acima instalado no staging isolado; 672 hashes de fonte conferidos.
Sete páginas autenticadas HTTP 200, sem mensagens/confirmations/inferências no preparo.
Feature/front/voice/paid/V2/overlap ON somente para o tenant/user sintético admitido;
JEV OFF, nenhuma habilitação de comunicação externa. Orçamento original: 13/20
consumidas, sete restantes. Browser recarregado e painel aberto sem enviar mensagem.

Reteste: em nova conversa, pedir remarcação e depois pedir alteração do preço da
Massagem para R$90 na mesma conversa. Esperado: novo plano de Serviço, proposta
visual de preço e pedido anterior preservado; nenhuma mutation sem confirmação.
Não usar o sucesso offline como comprovação desse reteste real.

Evidência: [runtime e checks](./SECRETARY_CONVERSATION_ROUTING_EVIDENCE.json).
Desligamento autorizado: `node /workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z/stabilization-control.cjs stop`.
Quando o usuário encerrar, executar esse controle e reconciliar os novos eventos.

