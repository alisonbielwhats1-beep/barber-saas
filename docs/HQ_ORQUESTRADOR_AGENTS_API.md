# Orquestrador interno de sete agentes salvos

## Estado verificável — 12/09/2026

Branch local `codex/hq-saved-agent-orchestrator`, base `5cca634`.
O recorte anterior veio do pacote `b10fb69`, na branch
`codex/transferencia-orquestrador`. Os 14 SHA-256 do manifesto conferiram.
Os 42 testes originais passaram neste PC antes da ampliação.

Implementado: Triage → um especialista selecionado → Chief, ou Triage → Chief.
Os sete destinos estão configurados. **A leitura real dos sete IDs foi comprovada**
em 12/09 às 19:36 e novamente às 19:42 UTC, no projeto informado. A chave local
confere com o arquivo configurado pelo responsável, sem expor seu conteúdo.
**A execução real permanece pendente**: oito tentativas autenticadas pararam
ao solicitar a sessão de Triage. Às 19:38, o retorno indicou `api.agents.write`;
às 19:46, o acesso continuou recusado, sem identificador adicional de permissão,
inclusive após nova confirmação de liberação pelo responsável.
Após a captura mostrando Agents → Write, a tentativa das 19:50 UTC retornou
HTTP 403, código `forbidden`, com referência ao modelo. A consulta somente
leitura das 19:51 UTC confirmou que todos os sete agentes usam `gpt-5.6-luna`.
É necessário conferir o acesso a esse modelo no projeto; a causa administrativa
exata ainda não foi comprovada. Os modelos salvos foram preservados.
Nenhuma sessão foi confirmada, os demais agentes não foram acionados e não houve
resposta final real. As tentativas foram contadas no limite diário, mesmo recusadas.

Sem Production, WhatsApp, novas dependências ou migration. Twilio e `./whatsapp`
continuam preservados no pacote de transferência original; não foram incorporados.
O lockfile e as dependências da base permanecem intactos. Foi acrescentado
somente o export `./orchestrator` ao pacote de agentes e um comando de verificação.

## Ambiente local efetivamente iniciado

- Aplicativo: `http://localhost:3017/hq/agents/orchestrator`.
- Checkout: `D:/Projetos/barber-saas-hq-orchestrator`.
- PostgreSQL 16 exclusivo: `127.0.0.1:55439/hq_orchestrator_test`.
- Preflight comprovou banco vazio; somente dois usuários fictícios foram criados.
- Runtime `hq_runtime`: `rolsuper=false` e `rolbypassrls=false`.
- As 54 tabelas de domínio têm RLS ENABLE/FORCE, sem policies permissivas.
  `User` mantém a exceção de identidade já prevista pelo aplicativo.
  Este banco valida somente autenticação e orquestrador, não as migrations
  ou demais operações do CRM.
- Credenciais sintéticas aleatórias em `.demo/ACESSO_LOCAL.md`, ignorado pelo Git.
- Preparo, início, logs e evidências locais ficam em `.demo/`. Recuperação:
  encerrar somente os processos identificados em `app-process.json` e
  `database-ready`, preservando a pasta. Não há reset automático.

O navegador confirmou home 200, autenticação administrativa, sete agentes,
bloqueio de anônimo e usuário comum, nenhum erro de página e nenhum overflow
em 390px. Também houve inspeção visual em 1440px. O retorno após login aceita
exatamente a nova rota na allowlist interna; a autorização continua no servidor.

## Configuração segura

Usar banco isolado e chave exclusivamente em `.env.local`, ignorado pelo Git:

```env
APP_ENV=development
HQ_ENABLED=true
HQ_ORCHESTRATOR_ENABLED=true
OPENAI_API_KEY=
```

Nunca colocar a chave em chat, `NEXT_PUBLIC_*`, logs ou arquivos versionados.
Não copiar configuração produtiva. Reiniciar o servidor se a chave mudar.
A chave e o papel no projeto precisam permitir leitura dos agentes e execução
com cancelamento de sessões. Não é necessário recriar modelos ou instruções.

Projeto padrão: `proj_48Zf5hXOzoiiCnIEJ4Rb3vN4`, configurável somente no servidor
por `HQ_ORCHESTRATOR_PROJECT_ID`. Os IDs existentes não são credenciais:

| Agente | Variável | ID |
|---|---|---|
| Triage | `HQ_TRIAGE_AGENT_ID` | `agent_e8bd029a1bbd4f43a129bd1be9e23411f21018285a5d431197` |
| Sales | `HQ_SALES_AGENT_ID` | `agent_94cacba2c8cc43d491543bcd80b8d72a6e7d011d37a2496fbf` |
| Customer Success | `HQ_CUSTOMER_SUCCESS_AGENT_ID` | `agent_003e550854e0457b8f6dc7f5d66b82a8b6ce8542a2f34a79a4` |
| Product | `HQ_PRODUCT_AGENT_ID` | `agent_352dc832d7e24079bbb810e811388e04582ba235cacc4bdf9a` |
| Operations | `HQ_OPERATIONS_AGENT_ID` | `agent_be139647805440a38f7914a389f720e808b9754920c54543a8` |
| Marketing | `HQ_MARKETING_AGENT_ID` | `agent_75872b8d4b39403fab2edf59ebbbf46cc39b1ea727f5473995` |
| Chief | `HQ_CHIEF_AGENT_ID` | `agent_c9d248870db94949a0d23ca65a714d78de7431951c5448b2a8` |

Para conferir acesso sem inferência:

```powershell
npm run hq:check-agents
```

O comando valida a configuração e consulta somente os sete agentes. Não cria
agentes ou sessões, não exibe prompts/credenciais/erros brutos e retorna exit 1
se não comprovar todos os acessos. Leitura bem-sucedida não prova execução.

## Fluxo e contrato

1. `withHq` revalida SUPER_ADMIN; a transação termina antes da API.
2. Validar ativação, ambiente, mensagem e limites. IDs vêm somente do servidor.
3. Triage recebe a mensagem por `client.beta.agents.sessions.create`, usando
   `agent_id`, `input` e `stream: true`.
4. Validar JSON: `target_agent` em SALES/CUSTOMER_SUCCESS/PRODUCT/OPERATIONS/
   MARKETING/CHIEF; `event_type` com 1–80 caracteres; `priority` em LOW/MEDIUM/
   HIGH/CRITICAL; `requires_human_approval` booleano.
5. Executar somente o especialista selecionado, ou seguir diretamente a Chief.
   `event_type` nunca substitui o destino, mesmo em BUG_REPORT/FEATURE_REQUEST.
6. Chief recebe mensagem original, classificação validada, saída completa de
   Triage e `specialist: { agent, output }`, ou `null` no caminho direto.
7. Só o sucesso de Chief gera `answer`. Aprovação humana aparece como pendência;
   não representa aprovação, transferência ou execução de uma ação.

Não há `new Agent`, criação/atualização de agentes ou definições de modelo,
prompt e formato dos agentes salvos. Os únicos overrides de sessão restringem
capacidades: `tools: null`, `multi_agent.enabled: false`, `environment.type: none`
e `vault_ids: []`. Os envelopes transportam dados e pedidos de consolidação.
A saída do modelo e a mensagem do usuário nunca podem escolher IDs arbitrários.

## Interface e limites

- Sete agentes listados, destino selecionado, prioridade e pendência humana.
- Etapas concluídas, não acionadas ou com falha; saída, duração e IDs em detalhes.
- A lista de agentes acionados usa sessões confirmadas por ID. Requisição recusada
  não vira execução comprovada.
- Apenas mensagens `final_answer` concluídas após o turno principal são usadas.
  Raciocínio privado, commentary, credenciais e erros brutos não chegam à tela.
- Entrada até 2.000 caracteres; saída até 12.000 por agente.
- Até três sessões por mensagem, ou duas para Chief direto; sem retries de inferência.
- Prazo compartilhado de 45 segundos, mais até 2 para solicitar cancelamento
  remoto explícito por `agent.session.input.cancel`.
- Falha interrompe etapas seguintes; resultados parciais não viram resposta final.
- Fechar SSE ou sair da página não comprova cancelamento. Falha de cancelamento
  é comunicada; conferir as sessões na OpenAI antes de repetir resultado incerto.
- Uma execução por minuto por administrador; dez por janela de 24h por projeto.
  Preview exige limitador distribuído. Desenvolvimento aceita o limitador local
  existente, que reinicia com o processo; não é um teto financeiro mensal.
- Production bloqueado por APP_ENV e VERCEL_ENV, mesmo com a flag ativa.
- Durante o fluxo, banco somente para autorização; sem dados de clientes,
  escrita em banco ou persistência no CRM. Resultados voláteis na página;
  sessões permanecem na OpenAI.

## Validação

Revisão final: lint e TypeScript passaram; os 989 testes gerais em 183 arquivos
passaram, incluindo 82 testes específicos do orquestrador. Build completo passou.
O navegador também confirmou login pelo formulário e retorno à nova rota.
POST direto à Server Action sem sessão foi bloqueado (307 para login), e com
usuário comum foi recusado no servidor (303 para dashboard).
Esses testes usam respostas fictícias e não comprovam conexão real.

Após ajustar permissões no painel, duas rodadas aceitaram a leitura dos sete
agentes. Isso comprova acesso aos recursos salvos, mas não execução de sessões.
Os testes adicionais cobrem o diagnóstico seguro de permissões e recusa referente
ao modelo, sem expor a mensagem bruta. A verificação somente leitura também
informa o modelo já salvo em cada agente;
a permissão ausente pode aparecer na tela, sem expor o erro bruto do fornecedor.
Após esse ajuste, lint, TypeScript e os 86 testes específicos passaram.

```powershell
npm run lint
npx tsc --noEmit --incremental false
npx vitest run src/lib/hq/orchestrator.test.ts src/app/hq/agents/orchestrator/actions.test.ts src/components/hq/orchestrator-lab.test.tsx --maxWorkers=1
npm test -- --maxWorkers=2
npm run build
```

Após liberar a API, ensaiar mensagens fictícias dos cinco especialistas e Chief
direto, respeitando um minuto entre execuções e dez por 24h. Conferir o destino
realmente selecionado; não alterar os agentes para fabricar classificações.
Até resolver as permissões, a operação real permanece pendente.

## Documentação oficial consultada

- [Agentes salvos e overrides](https://developers.openai.com/api/docs/guides/agents-api/configuration)
- [Sessões e cancelamento](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [Eventos e itens](https://developers.openai.com/api/docs/guides/agents-api/sessions/events)

SDK OpenAI 7.15.0 já existente, usando diretamente `beta.agents.sessions`.
Não foi substituído por Responses ou Assistants.
