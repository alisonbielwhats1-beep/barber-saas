# Conversa com responsável e revisão condicional

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
o laboratório não tenta deduzir um encaminhamento a partir de sua prosa. A seleção
de reclassificação/revisão é explícita. Detecção automática de mudança de assunto,
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
