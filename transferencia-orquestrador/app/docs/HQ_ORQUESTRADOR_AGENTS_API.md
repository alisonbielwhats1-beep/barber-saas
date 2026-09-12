# Teste interno Triage → Product → Chief

Implementação local de 12/09/2026 em `codex/hq-saved-agent-orchestrator`, baseada
no checkout `5cca634`. As alterações locais anteriores foram preservadas.
O fetch do GitHub não pôde atualizar a referência remota por indisponibilidade
de rede. Esta entrega não publica código, altera banco ou conecta WhatsApp.

## Uso

Abra `/hq/agents/orchestrator` com uma conta `SUPER_ADMIN` em desenvolvimento
ou homologação com banco isolado e HQ já habilitado. Também há um link em
`/hq/agents`. A página e a Server Action revalidam acesso por `withHq`.

No servidor desse ambiente, configure:

```env
APP_ENV=development
HQ_ENABLED=true
HQ_ORCHESTRATOR_ENABLED=true
OPENAI_API_KEY=<chave do projeto com acesso aos agentes>
```

Não coloque a chave em código, `NEXT_PUBLIC_*`, mensagens ou arquivos versionados.
Não baixe configurações de Production para fazer testes. Não há chave disponível
no ambiente local desta implementação; chamadas reais ainda precisam ser validadas.

Os IDs existentes encontrados no projeto são usados por padrão:

| Agente | agent_id |
|---|---|
| Triage | `agent_e8bd029a1bbd4f43a129bd1be9e23411f21018285a5d431197` |
| Product | `agent_352dc832d7e24079bbb810e811388e04582ba235cacc4bdf9a` |
| Chief | `agent_c9d248870db94949a0d23ca65a714d78de7431951c5448b2a8` |

Projeto padrão: `proj_48Zf5hXOzoiiCnIEJ4Rb3vN4`. Para outro ambiente, use
`HQ_ORCHESTRATOR_PROJECT_ID`, `HQ_TRIAGE_AGENT_ID`, `HQ_PRODUCT_AGENT_ID` e
`HQ_CHIEF_AGENT_ID`. O cliente envia somente a mensagem; os IDs são resolvidos
no servidor, precisam ser distintos e jamais são escolhidos pelo modelo.

Arquivos principais: `packages/hq-agents/src/orchestrator.ts` contém a execução
da Agents API; `src/lib/hq/orchestrator-config.ts` resolve a configuração;
`src/app/hq/agents/orchestrator/actions.ts` faz autorização e admissão;
`src/components/hq/orchestrator-lab.tsx` apresenta o formulário e os resultados.

## Fluxo e contrato

1. Validar administrador, ativação, ambiente, mensagem e limites.
2. Criar uma sessão de Triage com `client.beta.agents.sessions.create`,
   `agent_id`, `input` e `stream: true`.
3. Validar o JSON final de Triage no contrato já usado pelos agentes salvos:
   `target_agent` (SALES, CUSTOMER_SUCCESS, PRODUCT, OPERATIONS, MARKETING ou
   CHIEF), `event_type` (texto), `priority` (LOW/MEDIUM/HIGH/CRITICAL) e
   `requires_human_approval` (booleano). Saída inválida interrompe o fluxo.
4. Acionar Product se `target_agent=PRODUCT` ou se `event_type` for
   `BUG_REPORT`/`FEATURE_REQUEST`. Product recebe a mensagem e a triagem.
   Nos demais casos, a etapa aparece como “Não acionado”. Nenhum outro agente
   apontado por Triage é executado nesta versão.
5. Chief recebe mensagem, triagem e análise de Product (ou `null`) e gera a
   resposta final. Pendências humanas são contexto para Chief, não ações.

Nenhum agente é criado, atualizado ou recriado com `new Agent`. Modelos,
instruções e formatos de saída são herdados dos agentes do painel. Os envelopes
de entrada apenas transportam dados e solicitam a consolidação do resultado.
Para este teste, overrides de sessão desabilitam ferramentas e delegação,
com `environment: none` e `vault_ids: []`; não modificam os agentes salvos.

Apenas mensagens `final_answer` concluídas são exibidas, depois da conclusão
do turno principal. Commentary e raciocínio não são enviados à tela.
O resultado apresenta os três passos, status, duração, ID do agente e sessão,
inclusive em falhas parciais. O passo a passo aparece ao término, sem atualização
em tempo real. A resposta de Chief é exibida como texto escapado; se seu agente
salvo usar JSON, esse formato será preservado.

## Limites e falhas

- Entrada: até 2.000 caracteres. Saída: até 12.000 caracteres por agente.
- No máximo três sessões novas por execução; não há loops ou retries de inferência.
- Prazo compartilhado de 45 segundos e até 2 segundos adicionais para solicitar
  cancelamento remoto. A página declara duração máxima de 60 segundos.
- Uma execução por minuto por administrador e dez por janela de 24 horas por
  projeto. Preview exige Redis distribuído. Desenvolvimento aceita o limitador
  local existente, que reinicia com o processo; esses limites não são um teto
  financeiro mensal e não se integram ao orçamento do piloto antigo de Chief.
- Production é bloqueado por `APP_ENV`/`VERCEL_ENV`, mesmo com a flag ativa.
- Falha, saída inválida, ação externa solicitada ou interrupção do stream impede
  os próximos agentes. Resultados parciais não são apresentados como resposta final.
- Fechar SSE não cancela processamento remoto: é enviado explicitamente
  `agent.session.input.cancel`. Se isso falhar, a tela informa a incerteza.
  Falha de rede antes de receber o ID da sessão também pode impedir cancelamento;
  confira as sessões na OpenAI antes de repetir um teste com resultado incerto.
- A chamada é síncrona na Server Action: sair da página não garante cancelamento
  imediato; o prazo do servidor continua valendo.
- O banco só participa da autorização, com transação encerrada antes da API.
  Não há consulta a dados de clientes, migration ou persistência no CRM.
- Resultados são voláteis na página. Sessões criadas permanecem na OpenAI;
  limpar/recarregar a página não as exclui.

## Validação e teste manual

Os testes locais usam streams fictícios, sem consumo da OpenAI ou acesso ao banco.
Cobrem os dois caminhos, passagem dos resultados, restrição aos IDs salvos,
autorização, limites, falhas parciais, cancelamento e interface.

Verificações desta entrega:

- `npm run lint`: passou.
- `npm run typecheck`: passou na execução final separada (exit code 0), após
  corrigir o tipo da configuração e encerrar o build concorrente que removia
  os tipos gerados do Next.
- `npx vitest run src/lib/hq/orchestrator.test.ts src/app/hq/agents/orchestrator/actions.test.ts src/components/hq/orchestrator-lab.test.tsx --maxWorkers=1`: 42 testes passaram.
- `npm test -- --maxWorkers=2`: interrompido após timeout no teste existente de
  login e timeout ao encerrar o worker de navegação das configurações; suíte
  geral não aprovada nesta rodada.
- `npm run build`: cliente Prisma gerado e compilação concluída em 119 segundos;
  interrompido por falta de progresso na fase de lint/tipos. Build completo
  não aprovado nesta rodada. Nenhuma migration foi executada.
- Os testes e o build precisaram executar fora da restrição de criação de
  processos do Windows (`spawn EPERM` no sandbox).

Após configurar uma chave no ambiente de teste, envie uma mensagem fictícia como
“Ao remarcar uma reserva, a tela trava”. Confira Triage → Product → Chief,
as sessões e a resposta final. Aguarde um minuto e envie “Olá, gostaria de
conhecer o Everflair”; se Triage classificar como vendas, confira Product não
acionado e Chief concluído. A classificação depende dos agentes salvos.
Verifique também que uma conta comum não consegue acessar a página nem executar
a Server Action. Não use dados reais ou Production nesse ensaio.

Rollback: desligar `HQ_ORCHESTRATOR_ENABLED` e/ou reverter os arquivos desta
entrega. Não requer reversão de schema nem mudança nos agentes da plataforma.

## Documentação oficial consultada

- [Agentes salvos e overrides de sessão](https://developers.openai.com/api/docs/guides/agents-api/configuration)
- [Criação e cancelamento de sessões](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [Eventos e conclusão de turnos](https://developers.openai.com/api/docs/guides/agents-api/sessions/events)

O SDK OpenAI 7.15.0 já presente no workspace oferece `beta.agents.sessions`.
Ele é usado diretamente, sem substituir a Agents API por Responses ou Assistants.
