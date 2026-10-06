# Secretária: apresentação, linha do tempo, limites, sugestão de texto e "Não era isso" (B7)

28/09/2026. Recomendações 4, 10 e 11 e o item 4 do dono. Nenhuma chamada à Luna real e nenhum banco de dados.
Comportamento novo que muda a entrada do modelo ou grava dados fica atrás de flag (padrão desligado).

## 1. Apresentação (padrão ligado; só texto de tela)

- **Nomes resolvidos.** Assim que o backend resolve o sujeito da ação (proposta, recibo, agendamento localizado,
  correspondência única ou opção escolhida), frases e títulos usam o nome cadastrado: "Já dá para confirmar:
  remarcação de Fábio Santos" em vez de "de fabio". Fonte única: `resolvedSubject` em `src/lib/secretary-display.ts`,
  usada pelo backend (`presentationHints` → `hint.subject`) e pela tela (`actionSubject`/`actionTitle`). O adapter
  da agenda guarda `resolved_names` (nome por ref) só para apresentação.
- **Contexto da Luna separado da tela.** Com a flag de contexto desligada, a Luna continua recebendo o texto
  histórico (os nomes como o dono escreveu): `planConversationContext` calcula as perguntas sem `subject`. O
  contador de repetição (B6) compara a pergunta mostrada na tela.
- **Rótulos por operação.** "Preciso confirmar data do atendimento / data do bloqueio / início do bloqueio / fim do
  bloqueio"; "data de destino" só na remarcação (`temporalFieldLabels`).
- **Lote cancelar→agendar.** Homônimos com o telefone mascarado; agendamentos com data humana
  ("ter, 29/09 às 10h"); "Plano bloqueado: CÓDIGO" virou a causa em pt-BR (`blockedPlanMessage`).
- **Leitura adiada.** Sem JSON nem chaves: "Esta consulta será feita depois da ação anterior; o resultado aparece aqui."
- **Ano de referência.** A visão traz `today` (data local do salão lida pelo servidor); a tela usa esse ano ao
  formatar datas.

Efeito colateral medido na entrada do modelo com as flags desligadas: a pergunta de um adapter isolado da agenda
("Preciso confirmar data do atendimento") e a prévia de leitura adiada (sem o JSON) mudam de texto; os nomes
resolvidos não entram.

## 2. Contexto estruturado (flag `SALON_SECRETARY_STRUCTURED_CONTEXT`, padrão desligado)

`clarificationContext` publica `question_code` (`FIELD`, `FIELDS`, `OPTION`, `DAYPART`, `CALENDAR`) e uma frase curta
e estável em `previous_response` ("Pedi o horário.", "Pedi uma das opções."; vazia quando nada é perguntado). As
opções continuam com `option_id` e rótulo. Sem campo novo no wire e sem texto novo nas instruções.

Medição (`src/lib/__tests__/secretary-structured-context-wire.test.ts`, diretório 8+24, 10 ativas + 50 suspensas,
saída 8192), bytes da requisição + 8192, desligada → ligada:

| Mistura | components / JIT | stress | resposta ao adapter |
|---|---|---|---|
| forma dos testes de orçamento (nada perguntado) | on / off | 63708 → 62568 | 64347 → 63230 |
| forma dos testes de orçamento | on / on | 62678 → 61538 | 63124 → 62007 |
| realista (ativas perguntam, suspensas preparadas) | on / off | 73581 → 64249 | 74220 → 64911 |
| realista | on / on | 72694 → 63362 | 73140 → 63831 |
| todas perguntam a pergunta real | on / on | 67569 → 67077 | 68015 → 67546 |
| pior caso: todas perguntam a pergunta mais curta | on / on | 63638 → 65138 | 64084 → 65607 |

Achado: com a flag desligada, um plano real com 50 ações suspensas e as prévias reais passa muito do limite de
64000 (até 74 KB); as formas dos testes de orçamento usam uma frase sintética curta. A flag reduz ~9,3 KB nesse caso.
No pior caso (toda pergunta mais curta que o código + frase, p. ex. "Para qual cliente?") ela custa 25 bytes por ação.

Revisão (28/09): as linhas reais viraram portões. Com JIT e contexto estruturado (o candidato de produção), a mistura
realista cabe em 64000 e isso é afirmado. Na configuração padrão (JIT desligado), a continuação multiação
(65431/66042) e a mistura realista (72971–74220) já passam do limite: ficam presas ao tamanho medido (catraca;
qualquer aumento falha) até o coordenador decidir a redução do caminho padrão (ligar JIT + contexto estruturado
depois das baterias, limitar o contexto dos planos suspensos ou não repetir prévias). "Toda ação pergunta a pergunta
real" e o pior caso passam do limite mesmo com as duas flags (até 68626): continuam só relatados.

Atualização (28/09, orçamento da requisição): essas medidas são do pedido **como configurado**. Nenhum pedido acima do teto é
mais enviado: o runtime degrada na ordem fixa (exemplos, contexto estruturado + JIT, suspensos aparados) ou recusa com um
pedido para dividir a mensagem. Todas essas formas passaram a caber (até 63.828 enviados). Os testes de medida do efeito das
flags usam o tamanho configurado. Ver `docs/SECRETARY_INSTRUCTIONS_AND_CONTRACT_VERSION.md`, seção 8.

## 3. Linha do tempo (rec 11)

A conversa virou uma lista de turnos `{fala do dono, resposta, resumo das ações}` dentro de `role="log"`. Turnos
passados são só texto: o resumo recolhido "Nesta etapa · N ações" (ou "Pedido anterior · N ações", com os status
finais, no último turno de um pedido substituído); nunca cartões nem botões. Só o turno mais novo tem cartões vivos,
logo abaixo da conversa. Um clique (confirmar, escolher, descartar) responde num turno próprio.

## 4. Erros e limites

- Mensagens pt-BR para TURN_LIMIT, SESSION_LIMIT, INTERPRETATION_INVALID/INCOMPLETE, MODEL_CALL_LIMIT,
  CONTINUATION_ACTION_MISMATCH, APPEND_ACTION_EXISTS, CAPABILITY_FIELD_MISMATCH, INVALID_DEPENDENCY_GRAPH,
  SAME_AS_INVALID, TEMPORAL_CONTEXT_UNVERIFIED, CONVERSATION_ROUTE_CONFLICT, UNSUPPORTED_BATCH e outros de preparo.
  Códigos que podem surgir durante uma execução continuam no genérico (a tela oferece "Verificar resultado").
- Conversas canceladas não contam no SESSION_LIMIT (10 por usuário, 200 no total); as mais antigas além de 10 por
  usuário saem da memória (uma chamada nelas vira SESSION_NOT_FOUND).
- TTL deslizante: cada chamada bem-sucedida estende a conversa (e suas sessões filhas) para agora + 20 min, até 2 h
  desde o início. Continua só em memória: reinício ou outra instância falham fechado. Com
  `SALON_SECRETARY_PERSISTED_STATE` (D1, desligada por padrão) a conversa fica no PostgreSQL:
  ver `SECRETARY_PERSISTED_STATE_AND_ALIASES.md`.
- Revisão (28/09): os rascunhos do journal expiram 30 min depois de criados (o prazo não muda nas revisões). Por
  isso a atividade nunca estende a conversa até menos de 5 min do vencimento do rascunho aberto mais antigo (dela e
  das sessões filhas de ações não concluídas, do plano atual e dos suspensos). Depois disso a chamada recebe
  SESSION_NOT_FOUND, em vez de um EXPIRED na preparação que marcava todas as ações abertas como FAILED_SAFE. Sem
  rascunho aberto, o limite de 2 h continua.

## 5. Sugestão de texto (rec 4)

Revisão (28/09): a confiança no `message_mode` da Luna mudava a semântica do conteúdo no caminho padrão e foi para
a flag `SALON_SECRETARY_GENERATED_SUGGESTION` (padrão desligado).

- Flag desligada: GENERATED exige o pedido explícito do dono (a regra histórica), agora com as flexões das
  palavras de pedido e com o substantivo que a própria pergunta usa ("solicite … uma sugestão" é respondido por
  "pode sugerir" ou "quero uma sugestão"). Isso corrige o laço do C08 ("Pode sugerir um texto educado.") sem
  aceitar texto que o dono não pediu. A pergunta continua "Informe o texto exato entre aspas ou solicite
  explicitamente uma sugestão de mensagem."
- Flag ligada: `reconcileMessageContent` confia no `message_mode` da Luna, sem pedido explícito, e a pergunta passa
  a ser "Informe o texto exato entre aspas ou peça uma sugestão de mensagem."
- Nos dois casos, EXACT continua exigindo o trecho entre aspas da mensagem do dono, um GENERATED vazio não é
  conteúdo, a prévia começa com "Sugestão de texto — revise antes de confirmar" e só um Confirmar explícito envia
  (provider fake local). `communication-skill.ts` não foi tocado.

## 6. "Não era isso" (flag `SALON_SECRETARY_FEEDBACK`, padrão desligado)

Na resposta mais recente, "Não era isso" abre uma caixa opcional e a caixa "incluir o texto desta conversa para
melhorar a Secretária". A server action `sendSecretaryFeedback` valida a flag, a autenticação, o papel, o ambiente e
o rollout; grava `{salonId, userId (da autenticação), sessionId, turnIndex (posição da resposta na tela), códigos
do último turno registrados pelo servidor, versão do contrato, comentário}` e o texto da conversa **somente** com a
caixa marcada (sem ela, um texto enviado é recusado).

Armazenamento: `prisma/sql/manual/026_secretary_feedback{,.preflight,.rollback,.verify}.sql`, tabela só em SQL
(sem model no `schema.prisma`), acesso por `$queryRaw` dentro de `withTenant`. FORCE RLS por salão e usuário,
REVOKE PUBLIC, `app_runtime` só SELECT/INSERT (UPDATE recusado por trigger), `expiresAt` padrão agora + 90 dias,
CHECK de consentimento para o texto. `scripts/setup-local-app-role.ts` concede SELECT/INSERT localmente quando a
tabela existir com FORCE RLS.

**Não aplicada em banco nenhum.** O coordenador aplica localmente (127.0.0.1:55441/everflair_service_mvp) depois
do preflight somente leitura, roda o verify, reexecuta `setup-local-app-role` e só então liga a flag.

Retenção e limites (revisão de 28/09; a flag continua desligada até o agendamento existir):

- A política de leitura esconde linhas vencidas (`AND "expiresAt" > now()`); o verify confere isso.
- `026_secretary_feedback.purge.sql` apaga as linhas vencidas. Com FORCE RLS, nem o dono da tabela vê as linhas,
  então o script roda com um papel de manutenção que ignora RLS (superusuário ou BYPASSRLS) e falha fechado com
  qualquer outro papel. O runtime continua sem DELETE.
- `026_secretary_feedback.schedule.sql` agenda o mesmo DELETE todo dia com pg_cron, com esse papel. Sem pg_cron
  (o banco local descartável), falha fechado: agende o purge pelo executor de jobs da plataforma. **Agendar antes
  de ligar a flag.**
- Limite de gravação na mesma instrução do INSERT: até 10 avaliações por usuário em 10 minutos e 30 por conversa.
  Acima disso nada é gravado e a resposta é `FEEDBACK_RATE_LIMITED` ("Você já enviou muitas avaliações em pouco
  tempo. Tente novamente em alguns minutos.").
