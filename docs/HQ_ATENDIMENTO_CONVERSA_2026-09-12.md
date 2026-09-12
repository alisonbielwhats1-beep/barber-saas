# Conversa com responsável e revisão condicional

## Sugestões com coleta limitada — atualização de 12/09

O responsável autorizou encerrar perguntas repetidas e preparar a recomendação
para o fundador. Em conversas externas classificadas como `FEATURE_REQUEST`,
com destino Customer Success ou Product, a entrada usa Triage → Customer Success.
Após a primeira resposta do cliente, o backend consulta Product antes de
permitir outra rodada. Usa `dados_necessarios` do formato salvo: lista vazia
permite Chief; lista não vazia permite Customer Success por até duas rodadas
na conversa. Não conta interrogações nem deduz
roteamento a partir de texto livre. Duas rodadas podem conter mais de duas
perguntas individuais: as instruções salvas continuam controlando a redação.

Após duas rodadas, Chief recebe a análise Product já concluída, o histórico e a
última mensagem para preparar a recomendação mesmo com dados faltantes. A análise
é identificada como anterior, sem fingir uma nova sessão Product. A tela mostra
essa reutilização. Sem análise anterior válida, ou em reclassificação explícita,
Product é consultado novamente. Aprovação, risco crítico ou pedido de Chief por Product
antecipam a revisão. As incertezas permanecem no JSON de Product enviado ao Chief.
O contador e o encerramento viajam no token autenticado; reclassificar a mesma
sugestão não zera a coleta. Conversas antigas de melhoria contam as respostas CS
já presentes no histórico de forma conservadora. Após sucesso, a coleta fica
encerrada no servidor antes de qualquer nova reserva de consumo.

Primeira mensagem normal: Triage → CS. Segunda: Product → CS ou Product → Chief.
Após a segunda rodada de coleta: Chief com análise Product da rodada anterior.
Uma classificação que já exige aprovação pode usar Triage → Product → Chief;
reclassificação explícita também pode usar três sessões. O máximo de três sessões
e 45s compartilhados permanece. A decisão de
informação suficiente depende da avaliação do agente e não equivale a uma
especificação completa. Falhas não publicam recomendação nem avançam o estado.

A tela mostra as rodadas, a ordem real das chamadas, a análise Product e Chief
para o fundador. Ao concluir a recomendação não gera uma nova resposta de CS:
há apenas análise interna. Nenhum ticket, caixa de entrada persistente,
notificação, promessa de implementação ou aprovação executada. O resultado
permanece somente na página. Prompts, modelos e formatos OpenAI não foram alterados.

O gatilho é a classificação validada `FEATURE_REQUEST`, não palavras-chave na
mensagem. Outros assuntos mantêm o fluxo anterior. Se Triage classificar uma
sugestão em outro evento, esta regra não dispara; mudança de assunto continua
dependendo da reclassificação explícita. Este laboratório não é atendimento externo.

O primeiro ensaio real com três agentes na entrada esgotou 45s: Triage 14,745s,
Product 22,043s e Chief interrompido com cancelamento solicitado. Essa medição
motivou distribuir a coleta em mensagens, com duas sessões no caminho normal.
Não houve retry automático; o ensaio seguinte valida a implementação corrigida.
Evidência: `.demo/feature-first-timeout.json`. Um ensaio posterior de PDF também
esgotou o prazo ao repetir Product (21,363s) antes de Chief. O fluxo final reutiliza
a análise anterior após duas rodadas, preservando a última mensagem no contexto
de Chief. Evidência do timeout: `.demo/feature-final-results.json`.

Um ensaio intermediário concluiu seis sessões na API, com triagem/histórico/
análise completos e capacidades restritas auditadas; a última resposta do navegador
não pôde ser confirmada pelo coletor. Não conta como sucesso integral na tela.
Evidências: `.demo/feature-real-audit.json` e `.demo/feature-real-verified.json`.
O responsável alterou Verbosity de Customer Success para Low durante os testes;
Reasoning effort permaneceu Medium. A chamada seguinte herdou Low, comprovado
na auditoria, sem override de sessão. Validação final abaixo.

### Validação final da coleta limitada

- `npm test -- --maxWorkers=2`: 1.051 testes em 186 arquivos passaram.
- `npm run lint` e `npx tsc --noEmit --incremental false`: passaram.
- `npm run build` completo passou no checkout isolado; após o ajuste final de
  reutilização, `npx next build` passou novamente, incluindo tipos e geração.
  Nenhuma mudança de dependência, schema ou Prisma nesta revisão.
- 133 testes específicos de orquestrador, ação e tela passaram. Incluem cap,
  análise anterior identificada, mensagem nova/histórico completos, falhas,
  encerramento antes das cotas e reclassificação sem reutilização indevida.
- Navegador: home 200, SUPER_ADMIN, sete agentes, cota 50, bloqueios de anônimo/
  usuário comum, sem erros nem overflow em 390px. Relatório final de Chief visível
  e campo de continuação bloqueado após preparar a recomendação.

Ensaio real final com sugestão fictícia de PDF mensal:

| Mensagem | Chamadas desta mensagem | Tempo das etapas |
|---|---|---|
| Sugestão inicial | Triage → Customer Success | 32,913s |
| Escopo do PDF | Product → Customer Success | 31,614s |
| Encerrar a coleta e avaliar | Chief, com Product anterior | 20,029s |

Nenhuma terceira chamada Customer Success. Rodadas contam respostas de coleta,
inclusive quando o texto não contém perguntas; não representam contagem semântica
de perguntas. Sem resposta adicional ao cliente na etapa final: recomendação interna
visível para o fundador. As duas primeiras respostas e a última mensagem foram
incluídas no contexto; cinco sessões auditadas preservaram instruções/modelo/formato
e restrições. O caminho antecipado por dados suficientes foi simulado, não comprovado
por este ensaio real. Tempos observados não são SLA: os timeouts anteriores mostram
a importância de evitar repetir Product, e ainda pode haver falha de prazo.

Sessões finais, em ordem:

- `sess_093a361970ed565d006aa5d21a10788191a8c6cbbc9ff600cd`
- `sess_0e92e2d7bc333da2006aa5d22d238c8191a4ccadd96fe742f9`
- `sess_088ffed86c8bc6e2006aa5d258f31081918f03ca7c041b5ba2`
- `sess_0cf5b196d09277e3006aa5d269b54481918db9bb77a3e06e22`
- `sess_0a50bac0feddce7c006aa5d2965ff48191ada74b6afe5f997a`

Evidências: `.demo/feature-reuse-results.json`, `.demo/feature-reuse-audit.json`,
`.demo/feature-reuse-ready.png`, `.demo/tests-feature-reuse-full.log`,
`.demo/build-feature-reuse.log` e `.demo/browser-feature-final.log`.
Contador preservado: 45/50 tentativas usadas ao término, sem aumentar o teto.
O CI anterior de `c60e57d` passou integralmente (34720490755), mas não valida este
novo commit. PR #100 continua em rascunho; sem promoção produtiva.

## Atualização do limite local

Após os ensaios abaixo, o responsável autorizou manter 50 tentativas por janela
de 24h no laboratório. `HQ_ORCHESTRATOR_LOCAL_DAILY_LIMIT=50` prevalece sobre
o diagnóstico temporário apenas em development sem VERCEL_ENV. Contador anterior
preservado; uma tentativa/minuto, seis mensagens por conversa e 45s por mensagem
continuam. Esta atualização substitui o teto de 24 e sua expiração descritos no
histórico; ambientes hospedados continuam com dez. Nenhuma inferência é necessária
para verificar a mudança de cota.

Validação do ajuste: `npm run lint`, `npx tsc --noEmit --incremental false`,
`npm test -- --maxWorkers=2` (1.029 testes) e `npm run build` passaram. O navegador
autenticado confirmou cinquenta, com bloqueios de anônimo/usuário comum preservados.
Nenhuma inferência consumida; o registro de uso anterior não foi reiniciado.

## Escopo autorizado

O responsável aprovou a evolução do laboratório: Triage na entrada, continuidade
com o especialista e Chief apenas quando houver indicação de revisão/decisão.
Isso substitui a exigência anterior de Chief finalizar todas as mensagens.
Não autoriza WhatsApp, Production, consulta a clientes ou escrita no CRM.

Consulta somente leitura aos sete agentes em 12/09 confirmou os formatos atuais:
Triage JSON; Sales e Customer Success texto exclusivo para o cliente;
Product, Operations e Marketing JSON interno; Chief texto para o fundador.
Triage já orienta encaminhar conversas externas de suporte para Customer Success.
Essas instruções estão salvas na OpenAI e não foram alteradas por esta entrega.
Os seis ensaios reais do fluxo anterior não validam automaticamente esta revisão.

## Comportamento

- Primeira mensagem: classificar e executar somente o destino retornado.
- Sales/Customer Success podem produzir `answer`, a mensagem para o cliente.
- JSON de Product/Operations/Marketing fica exclusivamente na análise interna.
- Chief produz `chiefReport`, sempre para o fundador, nunca resposta ao cliente.
- Acionar Chief quando Triage o selecionar, indicar aprovação ou risco CRITICAL;
  quando um especialista estruturado indicar aprovação/destino Chief; ou quando
  o administrador pedir explicitamente revisão no laboratório.
- Aprovação pendente bloqueia a resposta ao cliente e a continuidade daquela
  simulação. Não há botão que conceda aprovação ou execute a recomendação.
- Continuação usa a classificação anterior e envia todo o histórico ao responsável
  em uma nova sessão restrita. Não repete Triage nem Chief automaticamente.
- “Mudou de assunto · reclassificar” executa novamente Triage com o histórico.
- “Pedir revisão de Chief” consulta apenas Chief com a mensagem atual, a triagem
  completa e os resultados anteriores, sem repetir o especialista.
- Falhas não geram resposta final nem avançam o histórico. Resultado remoto
  incerto impede continuação na tela e orienta conferir a sessão antes de repetir.

Sales/Customer Success retornam apenas texto, sem campo de escalonamento. Por isso
o laboratório não tenta deduzir um encaminhamento a partir de sua prosa. Sugestões
seguem a regra adicional acima, controlada pelo backend com a avaliação Product.
A seleção geral de reclassificação/revisão é explícita. Detecção automática de mudança de assunto,
risco surgido no meio da conversa ou encaminhamento por esses dois agentes exige
um contrato adicional e avaliação antes de atendimento externo. Destinos diferentes
de Chief sugeridos por especialistas internos são recomendações, não execução.

## Estado, acesso e limites

Cada turno exige SUPER_ADMIN com `withHq`, encerrado antes da API. O servidor emite
um token opaco AES-256-GCM contendo a conversa, vinculado ao administrador e ao
projeto/registro de IDs. Chave derivada com separação de domínio de NEXTAUTH_SECRET
(mínimo 32 caracteres). Qualquer alteração, outro administrador, troca do registro
ou expiração em duas horas impede inferência antes de consumir a cota.

O navegador mantém o token somente em memória, sem cookie, localStorage ou banco.
Não aceita IDs/histórico arbitrários. No máximo seis mensagens por conversa e
800.000 caracteres de token. Nova conversa descarta o estado da página; não é
aprovação, resolução ou exclusão das sessões na OpenAI. Tokens válidos permitem
ramificações do histórico; não há caixa de entrada persistente nem auditoria de
aprovação nesta fase. A cota limita inferências, inclusive ramificações.

Mantidos 2.000 caracteres por mensagem, 12.000 por saída, prazo compartilhado de
45s, cancelamento explícito, zero retries e no máximo três sessões por mensagem.
Continuação normal e revisão explícita usam uma sessão; primeira resposta simples
usa duas. Uma tentativa/minuto/administrador e a cota diária existente permanecem.
O limitador geral continua ativo; uma reserva adicional de consumo em
`.demo/orchestrator-usage/` preserva o teto local através de HMR/reinícios, com
lock atômico, janela de 24h, identificadores hash e sem conteúdo das conversas.
Estado inválido ou lock ocupado bloqueia a inferência. Preview exige o limitador
distribuído. Não remover o registro para liberar novos testes.

O responsável autorizou elevar o teto temporário de 20 para 24 até 12/09/2026
às 22:05 UTC (19h05 Brasília). `HQ_ORCHESTRATOR_DIAGNOSTIC_LIMIT=24` só produz
efeito na janela local de `HQ_ORCHESTRATOR_DIAGNOSTIC_UNTIL`; hospedado/expirado
permanece dez. O registro inicial contabiliza 19 ensaios automáticos anteriores
e o ensaio manual mostrado pelo responsável, sem apagar tentativas anteriores.

## Conhecimento comercial

O servidor fornece preços, capacidades e recursos de `PLAN_PRICING_ROWS` e
`PLAN_ENTITLEMENTS`, os mesmos exports consumidos pela landing. Não duplica preços
em prompts nem concede ferramentas. Inclui escopo Everflair, moeda/período,
entrada no plano Grátis e disponibilidade da oferta Fundador não consultada.
É o catálogo da versão local, não prova de preço implantado ou contrato individual.
Serviços/preços de salões e dados de clientes continuam fora deste laboratório.
Uma futura consulta deve resolver o estabelecimento e validar autorização no
servidor antes de disponibilizar os dados mínimos necessários.

## Validação desta revisão

- 116 testes específicos passaram: destinos, continuidade, reclassificação,
  revisão, aprovação, falhas, cancelamento, token adulterado/outro ator/expirado,
  origem confiável e catálogo público.
- Lint e TypeScript passaram; suíte geral com 1.023 testes/186 arquivos aprovada.
- `npm run build` completo passou no checkout de verificação, incluindo Prisma
  generate. O servidor local foi brevemente parado para liberar a DLL Windows e
  reiniciado preservando o contador de consumo. Após explicitar o significado de
  limite ilimitado, o teste do catálogo e TypeScript passaram novamente; build
  Next.js do ajuste final registrado em `.demo/build-next-conversation-final.log`.
- Navegador local: home 200, autenticação SUPER_ADMIN, bloqueio de anônimo e
  usuário comum, sete agentes, sem erros de página ou overflow em 390px.

### Ensaios reais desta revisão

| Mensagem/objetivo | Sessões efetivamente acionadas | Tempo observado |
|---|---|---|
| Planos e preços para três profissionais | Triage → Sales | 31,626 s |
| Pergunta seguinte sobre agendamentos no plano indicado | Sales | 15,074 s |
| Revisão interna da orientação comercial | Chief | 19,658 s |
| Dificuldade para salvar agendamento | Triage → Customer Success | POST 33,725 s, incluindo autorização |

Os três primeiros resultados apareceram na tela e foram capturados. No quarto,
o coletor do navegador perdeu acesso ao corpo após navegação durante atualização
local. Consulta somente leitura recuperou os dois turnos `completed` e a resposta
de suporte, sem repetir inferência. Isso comprova o resultado na API, não uma
captura final da quarta resposta na tela.

Auditoria das seis sessões confirmou instruções/modelos/formatos preservados,
capacidades restritas, triagem completa, histórico completo na continuação e no
Chief e catálogo com valores públicos e disponibilidade do Fundador não consultada.
IDs das sessões, na ordem da tabela:

- `sess_00ca937808131963006aa5c1ab20ac8191957cee54d9085fad`
- `sess_0e382e75c3b50070006aa5c1ba99c081918b0a673ea2e30019`
- `sess_06bf5c2dd981edb5006aa5c1e840f48191917ad7a99544ac26`
- `sess_0e8e7ee4ff9839d8006aa5c22505f8819181bff4f6a905bf5e`
- `sess_00d82843b460c5ce006aa5c262bcd48191907ac07cfe134822`
- `sess_045d901826cd73bf006aa5c2745ec881918df1678f5374d24f`

A segunda resposta mostrou uma ambiguidade: Sales leu o `null` do limite Pro como
ausência de informação. No domínio/landing, `null` significa ilimitado. O envelope
agora inclui a descrição explícita derivada desse valor, validada por teste.
Não houve nova chamada de preços após esse ajuste. A amostra não constitui SLA
nem comprova escalonamento automático de conversas externas; reclassificação e
aprovação foram verificadas com respostas simuladas. A cota autorizada de 24 foi
atingida e persistida. Não liberar novas inferências apagando o contador.

Evidências locais sem credenciais: `.demo/conversation-real-audit.json`,
`.demo/conversation-real-verified.json`, `.demo/browser-conversation-final.log`,
`.demo/tests-conversation-final.log`, `.demo/lint-conversation-final.log` e
`.demo/typecheck-conversation-final.log`. PR #100 recebe a revisão; não promover
sem CI/Preview e autorização de publicação. O CI anterior de `2b126a0` falhou no
teste existente de `/hoje` por diferença de minuto entre SSR e hidratação,
fora das rotas alteradas; o novo commit exige sua própria validação.

Referências oficiais consultadas:
- https://developers.openai.com/api/docs/guides/agents-api/configuration
- https://developers.openai.com/api/docs/guides/agents-api/sessions
- https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
