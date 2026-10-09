# Candidato local — 09/10/2026: planos e cortesia no HQ

Implementação em `codex/platform-plans-access`, ainda sem promoção: catálogo atual no controle administrativo, cortesia com prazo inclusivo e auditoria, bloqueios de exclusão explicados. Migration 032 e flag `PLATFORM_PLAN_GRANTS_ENABLED` permanecem pendentes de aprovação/implantação em Production. Bianca ainda não deve ser declarada no plano Individual por esta implementação. Ver [plano e rollout](PLANOS_CORTESIA_HQ_2026-10-09.md). O estado implantado documentado abaixo permanece válido.

# Status atual canônico — Salon SaaS

## 09/10/2026 — acesso do cliente e senha de oito caracteres em revisão

Candidata `codex/auth-password-audit`: retomada de cadastro pelo login existente,
orientação/reenvio de confirmação, retorno ao mesmo salão e política Supabase
de oito caracteres com letras/números. Logs produtivos somente leitura confirmam
recusas por e-mail não confirmado e limite de envio no cadastro. Não publicada;
configuração remota e contas intactas. Sincronizar o mínimo remoto antes da
promoção autorizada. Evidências/limites: `AUDITORIA_ACESSO_CLIENTE_2026-10-09.md`.


## 09/10/2026 — pausa da verificação de e-mail no cadastro da landing (em revisão)

A pedido do responsável, novos estabelecimentos em `/signup` usam o login por
senha já suportado (bcrypt/NextAuth), sem link de verificação. A senha forte,
limite de tentativas, unicidade do usuário e criação transacional do salão são
preservados. `OWNER_SIGNUP_EMAIL_VERIFICATION_ENABLED=true` restaura o cadastro
Supabase; ausente ou `false` mantém a pausa. Contas existentes não são alteradas.
Recuperação Supabase, cadastro do cliente e convites mantêm os fluxos atuais.
Sem migration, configuração remota ou publicação em Production nesta etapa.
Detalhes e rollback em `FASE_SUPABASE_AUTH_RECOVERY.md`.

## 2026-10-08 — nova marca Everflair e tela inicial do cliente (PR desta branch)

Branch `claude/everflair-logo-redesign-ddd49b`. Decisão do dono de 08/10 em
`DECISOES_PRODUTO.md`. Sem mudança de banco, migration ou variável de ambiente.
- **Marca:** `BrandLogo`/`BrandMark` passam a SVG em linha (pétalas e brilho pelo
  `color-scheme`, nome por `currentColor`), letras Inter em contorno. Ícones do
  PWA, favicon, Apple e badge refeitos; `PWA_ICON_VERSION` `flair-violeta-1` e
  cache do `sw.js` v6.
- **Abertura do cliente** "do ícone ao app" (2,5 s) em `brand-intro.tsx`/`brand.css`.
- **App do cliente:** primária violeta nos temas `salon-dark`/`salon-light`
  (painel inalterado); nova tela inicial em `book/[salonSlug]/page.tsx`
  (contatos no topo, Agendar, equipe com link para `agendar?pro=`, que o
  `booking-flow` pré-seleciona quando o serviço escolhido é compatível,
  informações recolhidas com "Aberto agora" no fuso do salão e no expediente
  semanal da equipe, avaliações em carrossel, convite de lembretes em aviso no
  topo). Logo com alternativa de cores para navegadores sem `light-dark()`.
- Testes atualizados: ícones (fundo violeta), abertura (2,5 s) e convite de
  lembretes (aviso no topo); novo teste de "Aberto agora".

## 2026-10-05 — Secretária: trava de serviço repetido, janela de decisão e manhã/noite na remarcação

Mesma branch (`claude/llm-model-migration-a6ed7a`), decisões do dono 40–43 (`DECISOES_PRODUTO.md`).
- **Trava de serviço repetido** (`secretary-existing-service.ts`): "cadastrar" um serviço com o nome de um que já existe vira
  a alteração desse serviço. Contrato do modelo inalterado.
- **DeepSeek recertificado** com a trava: Golden 3 vezes 90/90 (`golden-20261005-deepseek-guard-k3`), p50 1,3 s, US$ 0,08.
- **Luna certificado como reserva** (decisão 44, regra própria: sem falha de segurança e >= 98%): 89/90 sem falha de segurança,
  US$ 0,18. Em staging e produção, com as flags certificadas, o plano B fica ativo (DeepSeek principal, Luna reserva).
- **Janela de decisão** no chat (`secretary-chat.tsx`): escolhas abrem numa janela por cima da conversa, uma por vez, com
  barra de pendências quando fechada. Provada na demo local.
- **Manhã ou noite na remarcação** (`scheduling-daypart-facts.ts`): sem o agendamento escolhido, o horário é checado contra
  todos os agendamentos possíveis da cliente.
- **Fluxo por voz na janela** (decisão 45, flag `SALON_SECRETARY_FLOW_WINDOW`, ligada na demo): pergunta aberta e confirmação na
  janela, microfone que reabre sozinho e "confirma" por voz com 3 s para cancelar. Provado na demo com o caso do Sérgio.
- **Exceções de agenda** (decisão 46, flag `SALON_SECRETARY_SCHEDULE_EXCEPTIONS`, ligada na demo): agendar/remarcar fora do expediente,
  em bloqueio, no intervalo, depois do expediente ou sobre outro atendimento, com pergunta e botão "mesmo assim". Também quando o
  "9 horas" não tem leitura livre: vale a do horário de funcionamento do salão. Provado no fluxo real (Gabriel, 07/10 às 9h).
- **Troca e marcação de serviço** (decisão 47, flag `SALON_SECRETARY_SERVICE_SWAP_V2`, ligada na demo): "troque o serviço … do dia 17
  para pedicure" vira ALTERAR no mesmo horário; serviço de nome exato escolhido sem perguntar. Provado no fluxo real.
- **Nomes parecidos** (decisão 48, flags `SALON_SECRETARY_PHONETIC_NAMES`, `SALON_SECRETARY_NAME_ALIASES`, `SALON_SECRETARY_TRANSCRIBE_CUSTOMER_NAMES`,
  ligadas na demo): Walter → Valter, Isabella → Isabela, Tiago → Thiago sem travar; nomes das clientes próximas no vocabulário da voz.
- **Piloto em Produção** (decisão 49): código pronto (`secretary-production-pilot.ts`), certificados DeepSeek 90/90 e Luna 90/90 com as flags
  novas; falta PR/merge, Supabase (migrations da Secretária e a mudança de `NotificationChannel`/`NotificationOutbox` desta branch) e
  variáveis da Vercel — ver `docs/SECRETARY_PRODUCTION_PILOT.md`. Atenção: o `master` também tem migrations manuais 026/027 (push e preço
  final variável); as da Secretária são `026_secretary_feedback` e `027_secretary_state`.
- **Demo local:** o lançador com controle de gastos (`agenda-voz`, porta 3158) desliga o cache de prompt da OpenAI quando o
  modelo não é da OpenAI (a trava de custo do DeepSeek recusava esse pedido antes de sair).
- Suíte: 9.147 testes passam; falhas restantes são o teste antigo de holdouts e estouros de tempo sob carga (passam sozinhos).

## 2026-10-04 — Secretária: arquitetura de modelos (cadastro, certificado, carteiras)

Mesma branch, a pedido do dono ("trocar de LLM não pode ser um bloqueio, e os resultados têm que continuar muito bons").
Ver `SECRETARY_MODEL_ARCHITECTURE.md`.
- **Cadastro de modelos** (`model-registry.ts`): uma ficha por modelo com formato, carteira, endereço, credenciais,
  capacidades, perfil de pedido e preço. A trava de custo, a fábrica, a versão de contrato (que agora inclui o perfil de pedido
  dos modelos de chat), o custo de telemetria, o orçamento do pedido e a Golden leem a ficha.
- **Adaptador Chat Completions** separado da validação.
- **Portão de qualidade:** fora do desenvolvimento local e dos testes, só responde um modelo com certificado da Golden
  (k ≥ 3, tudo certo) para o contrato atual (`model-certificates.json`, `scripts/secretary-certify-model.ts`).
- **Gastos por carteira:** OpenAI e OpenRouter. A carteira do OpenRouter cobra o custo real informado, com teto de US$ 1,40
  (US$ 2,00 aprovados menos o já gasto).
- **Lançador genérico da Golden:** `scripts/run-secretary-golden-model.cjs`.
- **Plano B automático** (`model-fallback.ts`): se o provedor do principal falha, um modelo reserva (`SALON_SECRETARY_FALLBACK_MODEL`,
  Luna na demo) responde o mesmo turno, com disjuntor de 60 s depois de 2 falhas. Recusas nossas (trava de custo, tetos) nunca
  acionam o plano B. Provado com chamadas reais. Em staging e produção, o reserva só entra com certificado.
- **Certificação do Luna como reserva: não passou** (04/10). O dono subiu o teto da OpenAI para US$ 16 para isso.
  - Golden 3 vezes: 30/30, 30/30 e, na 3ª rodada, o GF07 virou cadastro de um serviço duplicado em vez de mudança de preço
    (falha de segurança, nada gravado). Custo: US$ 0,13.
  - O registro da OpenAI está em US$ 14,92 de 16.
  - Falta no backend uma trava contra cadastrar serviço com o nome de um que já existe.

## 2026-10-04 — Secretária: DeepSeek V4.1 Flash no lugar do Luna (local)

Branch `claude/llm-model-migration-a6ed7a`, sobre `claude/voice-system-cancellation-reason-44fd9a` (`c24f48a`),
enviada ao GitHub sem PR. Decisão do dono (`DECISOES_PRODUTO.md`, 32–36): o caminho C4 da Secretária passa a chamar o
DeepSeek V4.1 Flash pelo OpenRouter (Chat Completions, rota padrão, raciocínio desligado), com chave própria
`SALON_SECRETARY_OPENROUTER_API_KEY`. A transcrição continua na OpenAI. A trava de custo admite só o formato C4
no endereço do OpenRouter; o agente C5 e o piloto continuam exigindo a OpenAI. O Luna volta com
`SALON_SECRETARY_MODEL=gpt-6-luna`. Para a validação (teto de US$ 2), há uma missão Golden própria e o estimador
selado `openrouter-chat` no registro do programa. Testes offline novos: `secretary-openrouter*.test.ts`.
Golden 30 real (mesmas frases e flags da prova do Luna), Together fixo, `temperature: 0` e as correções de produto no
plural (uma busca a mais no singular) e de jornada de profissional (fora do catálogo), k=3: **90/90, pass^3 100%**, igual
ao Luna. `contract-version.json` foi regravado; a bateria prática não foi rodada de novo, e o Luna não foi medido com a
frase nova. Tempo por turno 1,5 s na mediana e 1,9 s no p90 (Luna: 4,6 s e 6,8 s); 0 falhas de segurança. Para chegar lá, o
OpenRouter recebe a ferramenta sem `strict` (com ele, 3/30) e os campos omitidos voltam como nulo, guiados pelo
esquema. A validação custou US$ 0,57 reais; o registro do programa (preço de teto) ficou em US$ 14,79 de 15. Ver `SECRETARY_DEEPSEEK_OPENROUTER.md`.
Production da Secretária continua bloqueada.

## 2026-10-03 — Secretária: falar em vez de digitar e cancelar sem motivo (local)

Branch `claude/voice-system-cancellation-reason-44fd9a`, sobre `claude/secretaria-piloto-remarcar`
(`b289b50`), sem push. Pedido do dono: o cliente fala com a Secretária em vez de digitar, e o cancelamento
não pede motivo. Voz: transcrição GPT (`gpt-4o-mini-transcribe`) ligada no lançador da demo, teto US$ 2 por
salão e mês, uso real registrado no AuditLog (`SECRETARY_TRANSCRIBE/USAGE`, excesso vira reserva);
gravador com formato aceito pelo servidor, limite de tamanho e relógio; ditado acrescentado ao texto, com
"Desfazer ditado"; Enter ou Enviar durante a fala já envia o que foi dito (Esc cancela, Ctrl+Espaço fala,
"Parar" deixa revisar), transcrição pedida em português corrigido, e prazos para permissão do microfone e
transcrição (nada fica em "Transcrevendo…"). Desde 04/10 a transcrição é ao vivo: a fala é cortada a cada pausa
e cada trecho aparece na caixa enquanto a pessoa continua falando; provado no Chrome com `gpt-4o-mini-transcribe` real
(texto pronto 0,05 s depois de Parar). A espera aparece em segundos e a primeira mensagem faz uma só ida
ao servidor; num "oi", 2,55 s são da Luna e o resto, na demo, é o servidor de desenvolvimento
(`SECRETARY_NAMES_AND_VOICE.md` §3). O projeto OpenAI da Secretária ("Everflair Development") passou a
permitir `gpt-4o-mini-transcribe` em 03/10. Motivo: flag
`SALON_SECRETARY_CANCEL_REASON_OPTIONAL` (padrão desligada, ligada na demo; ver
`SECRETARY_CANCEL_REASON_OPTIONAL.md`). Ainda sem teste em iPhone/Android de verdade (exige HTTPS).
Production da Secretária continua bloqueada; nenhuma migration, flag ou deploy produtivo.

## 2026-10-03 — motivo opcional ao cancelar reserva, em revisão

Branch `claude/cancelamento-motivo-opcional` (PR #134), por decisão do responsável
(`DECISOES_PRODUTO.md`, 03/10): dono e gerente cancelam pela agenda (detalhe da
reserva e cancelamento em lote) sem preencher motivo. O domínio deixa de exigir
3+ caracteres da equipe; sem motivo, `cancelledReason` e o evento ficam nulos,
como no cancelamento pelo cliente, e motivo vazio ou ausente geram a mesma
impressão de idempotência. Confirmação, ator, evento imutável, liberação do
horário e fila preservada continuam. O motivo do encaixe segue obrigatório.
O diálogo não abre mais o teclado sozinho no celular. Sem migration; não publicado.

## 27/09/2026 (tarde) — Secretária de Agenda: foco CORE, pronta para teste manual local

Continuação autônoma do trabalho do Astra, agora no worktree
`.claude/worktrees/secretary-mobile-investigation-8658bb` (cópia exata do
`service-create-mvp`, que ficou intacto). Prioridade: Agenda, remarcação e
profissional. Production não acessada, sem deploy, sem migration, sem efeito
externo real. Detalhes, causas, testes e instruções de uso em
[SECRETARY_AGENDA_CORE_CHECKPOINT.md](SECRETARY_AGENDA_CORE_CHECKPOINT.md).
Resultado final: Golden 30 v17 **30/30** (0 falhas de segurança, oráculo
inalterado); bateria prática com Luna real 39/40 no estado final, 0 comportamentos
inseguros; `npm test` 4524/4524, PostgreSQL de domínio 185/185, typecheck e lint
verdes; fluxo completo testado pela UI local (login → pedido → conflito →
proposta → Confirmar → agendamento gravado). Gasto real ≈ US$ 0,3 dos US$ 7
autorizados. Pendências (todas com comportamento seguro) e o passo a passo de teste
estão no checkpoint. Nada commitado em `master` nem publicado.
A entrada abaixo (holdout V2 17/30) é o estado anterior a estas correções.

## 27/09/2026 — estabilização final em validação; nova staging retida

Atualização após holdout V2: **17/30 PASS, 13 FAIL**, 52 turnos observados de 54
planejados; dois condicionais não enviados permanecem UNKNOWN. Três loops e
falhas de contexto/grounding impedem release. Nenhuma proposta insegura encontrada
na revisão dos 52 turnos, sem confirmação ou mutação operacional. Correções de
SDK global, clarificação e ambiguidade em andamento, além de estoque/temporal/batch.
A revisão adversarial de estoque encontrou regressões adicionais, já preservadas.
Os PASS históricos abaixo antecedem esses edits e serão reexecutados após freeze.
Consumo cumulativo: US$ 3,760411/5 em 425 chamadas; journal original intacto.

Golden v14: 30/30 PASS, 44 turnos e chamadas, com revisão semântica independente
de todas as observações. São 27 conversas terminadas pelo critério da bateria,
duas em clarificação legítima e uma em HARD_BLOCK; proposta preparada não equivale
a execução. Nenhum loop, vazamento ou proposta insegura identificado nesse recorte.
O staging permanece parado; nenhum candidato desta rodada foi implantado.
Production não foi acessada. O teto cumulativo de validação é US$ 5, autorizado
explicitamente, preservando o journal e o limite separado da sessão manual.

A revisão offline encontrou também propostas antigas novamente confirmáveis
após falha de interpretação de um plano com múltiplas ações. A evidência anterior
à correção foi preservada. A correção de ciclo de vida passou 27 controles
independentes, com executores simulados. A revisão final da classe de estoque
passou 152 controles independentes e 504 regressões focadas. A suíte geral da
rodada 21 passou 4.002 testes em 340 arquivos; lint, TypeScript e replay histórico
17/17 passaram. PostgreSQL passou 181 testes de domínio na rodada 21 e 20 de
execução na rodada 22, com registros anteriores preservados, zero chamadas
externas e flags finais OFF.

O holdout original foi interrompido após três turnos: 1 PASS, 1 FAIL e 28
conversas não executadas. Duas revisões identificaram expectativa convertida
para um caminho inexistente, embora a proposta observada estivesse correta.
O resultado original permanece FAIL. O preflight estrutural corrigido passou
43 controles independentes e 77 testes focados; rodada geral 22: 4050/4050,
lint, TypeScript e replay 17/17. Depois disso, o holdout V2 acima foi executado
e reprovou a estabilidade conversacional. Após corrigir as classes, executar
novo holdout independente, regressões e build antes da entrega.
[Relatório, resultados e limitações](./SECRETARY_FINAL_STABILIZATION_REPORT.md).

## 26/09/2026, 14:02 BRT — troca de pedido corrigida, staging ON para reteste

Build `bdaZlMGxZrqOX-s0fP9vu`, 672 hashes de fontes conferidos; instalado somente
no staging isolado, Fixture A / Tatiana A. Corrigido roteamento que prendia novo
pedido ao adapter da ação selecionada; planos anteriores preservados para retomada
com confirmação anterior inválida. Regra de agendamento futuro preservada e explicada.
Suíte: 2.725 testes / 295 arquivos PASS; UI separada: 33 PASS; lint/TypeScript/build
PASS. Sete páginas autenticadas HTTP 200. Nenhuma mensagem, confirmation ou chamada
paga enviada pelo agente no preparo. RLS/isolation PASS. Limite original: 13/20
consumidas, 7 restantes. JEV OFF; feature/front/voice/paid/V2/overlap ON somente para
par sintético admitido. Meta/mensagens externas não habilitadas. Reconciliação:
61 tabelas operacionais intactas; 27 audits esperados anexados, nenhum anterior
alterado/excluído; baseline original preservado e checkpoint reconciliado por hash.
Reteste manual da mudança de assunto PENDENTE; dispositivo físico PENDENTE;
Production NÃO acessada. Não declarar staging/pilot readiness integralmente validado.
[Correção e limites](./SECRETARY_CONVERSATION_ROUTING_FIX.md) ·
[Evidência verificável](./SECRETARY_CONVERSATION_ROUTING_EVIDENCE.json).


## 26/09/2026, 13:24 BRT — staging corrigido ON para teste manual

Após autorização explícita, candidato `Rc178sgIPRIkRYhtUSoDt` instalado e
iniciado somente para Fixture A / Tatiana A. Preflight de identidade,
RLS/FORCE e isolamento PASS; 62 tabelas inalteradas. Sete páginas autenticadas
HTTP 200. Nenhuma mensagem, confirmation ou chamada paga realizada no preparo.
Limite original preservado: 8/20 tentativas consumidas, 12 restantes.
Validação conversacional manual e dispositivo físico continuam pendentes.
Production não acessada. Os registros OFF/local-only abaixo são históricos.
[Acesso, evidência e desligamento atual](./SECRETARY_STABILIZATION_MANUAL_SESSION.md).

## 2026-09-26 — estabilização conversacional: regressão local PASS, não publicada

O responsável autorizou prosseguir após a auditoria. Implementados contexto
explícito de clarificação, projeção dos campos Scheduling efetivos, grounding
por papel, resposta UNSUPPORTED e observação isolada do resultado funcional.
Suíte final única: 2.715 testes/294 arquivos PASS; lint, TypeScript e build PASS.
O comando de suíte exclui integration.test.ts; não comprova Luna/staging real.
Nenhum deploy, acesso a Production, inferência paga
ou mutation operacional nesta etapa. O staging não foi religado; permanece o
último OFF comprovado. Sessões em memória de processo continuam barreira real
para múltiplos workers produtivos. Manual/real-device/readiness não aprovados.
[Implementação, testes e limites](./SECRETARY_CONVERSATION_STABILIZATION.md).

## Histórico — auditoria Luna × pipeline; desenvolvimento/promoção suspensos

Por solicitação explícita, somente auditoria das evidências e preparação de plano.
Nenhuma nova inferência, mutation, alteração de runtime, build, deploy ou acesso
a Production. O último estado comprovado de staging continua OFF. Correção local
anterior não promovida e não apresentada como solução estrutural completa.

Amanda: Luna distinguiu origem 11h/destino 09h; guard removeu ambos do draft;
projeção conservou valores antigos; continuação não recebeu a pergunta/campo
pendente e retornou time=11h/source_time=null. Capability ausente e ambiguidade
também compartilham resposta vazia, com card genérico indevido. Harness causou
dois incidentes manuais comprovados. D segue UNKNOWN; safety temporal permanece.

[Auditoria e plano, sem implementação](./SECRETARY_LUNA_PIPELINE_AUDIT.md).
[30 conversas novas preparadas, não executadas](./SECRETARY_GOLDEN_FREE_USE_30.md).
As contagens se limitam à amostra declarada; os 2.695 testes abaixo são históricos.

## 2026-09-26, 11:55 BRT — staging OFF para correção da continuidade de horário

O teste manual revelou perda de `source_time` ao remarcar “das 11h para amanhã
às 09h”, seguida de perguntas repetidas. Correção local implementada com nove
regressões novas: suíte única de 2.695 testes/292 arquivos PASS; lint e TypeScript
PASS. Build local PASS; publicação do candidato ainda pendente. O compilador do Codespace
recebeu SIGTERM externo; investigação de infraestrutura em andamento.
Runtime manual desligado; journals e limite original de 20 tentativas preservados
(8 tentativas registradas). Reconciliação do desligamento: somente AuditLogs
esperados; estado operacional e Outbox intactos. Manual UX e voz física continuam
pendentes. Production não acessada. Este OFF substitui o ON registrado abaixo.
[Causa, correção e bloqueio de publicação](./SECRETARY_MANUAL_SOURCE_TIME_FIX.md).

## 2026-09-26, 11:33 BRT — observador manual corrigido; reteste pendente

Dois defeitos do harness manual: consumo antecipado do corpo HTTP (corrigido,
abertura real HTTP 200) e asserção de discovery aplicada a continuação (corrigido,
5 testes offline PASS, reteste manual pendente). Staging retomado com mesmo build,
ator e orçamento; 4 tentativas preservadas. Estado operacional/Outbox intactos,
16 novos AuditLogs esperados. Regressão 2.686 PASS, lint/TS/build PASS.
**Manual UX ainda não validada.** Production não acessada.
[Diagnóstico e evidência](./SECRETARY_MANUAL_PROVIDER_FIX.md).

## 2026-09-26, 10:55 BRT — sessão manual de staging ON, aguardando usuário

Por autorização explícita, mesmo build temporal `X_pW4ibxpeH-NHIM1dIDS` ligado
somente para fixture A/owner. Preflight RLS/FORCE/isolation e baseline PASS;
sete páginas autenticadas HTTP 200; UI real aberta com chat vazio. Zero chamadas
pagas no preparo; limite separado de 20 tentativas durante o teste manual.
JEV/integrações externas OFF. Logs da sessão ativos; nenhuma bateria executada
pelo agente. **Ainda não é validação manual ou de dispositivo físico.**
Estado atual substitui o OFF anterior apenas enquanto esta sessão estiver aberta.
Production não acessada; E/E2 conhecidos e D UNKNOWN preservados.
[Acesso, registros e desligamento](./SECRETARY_MANUAL_STAGING_SESSION.md).

## 2026-09-26, 09:55 BRT — temporal grounding VALIDATED; G PASS; staging OFF

**TEMPORAL_GROUNDING_V1 = VALIDATED; HARD_BLOCK_VOICE_G = PASS.** Guard
determinístico confronta texto, seletores e timezone antes da proposal;
contradição remove o temporal e exige clarification, sem correção silenciosa.
44 testes novos; suíte única **2.686 PASS / 292 arquivos**, lint/TypeScript/build
PASS. Candidato de staging `X_pW4ibxpeH-NHIM1dIDS`, sete fontes conferidas por hash.

Mesmo áudio G, uma chamada real: domingo→27/09/2026, 10h–10h30,
CONFLICT_HARD_BLOCK/SALON_CLOSED, Confirmar desabilitado, zero confirmação,
mutation/override. 62 tabelas reconciliadas; somente seis AuditLogs esperados.
RLS/FORCE/isolation PASS. OFF às 12:55:23Z: sete flags false, allowlist vazia,
runtime encerrado, mensagens/confirmações recusadas. Zero falha de segurança
nesta janela; a falha histórica abaixo permanece registrada.

E/E2 classificados como contrato de comunicação exclusivamente local, não
suportado em staging; D inicial segue UNKNOWN sem exceção causal preservada.
Logo, **SECRETARY_STAGING_OPERATIONAL do candidato atual = NOT_VALIDATED**;
voz automatizada NOT_VALIDATED, real-device REQUIRES_HUMAN_VALIDATION, piloto NO.
Production não acessada. Marcos Brain/Execution/Front anteriores preservados.
[Relatório e limites](./SECRETARY_TEMPORAL_GROUNDING_V1.md) e
[evidência atual](./SECRETARY_TEMPORAL_GROUNDING_EVIDENCE.json).

## 2026-09-26, 00:45 BRT — voz automatizada NOT_VALIDATED; STOP de segurança; staging OFF

O caso G manteve "domingo" no áudio/transcript, mas gerou uma proposal para
sábado, 03/10/2026, com Confirmar habilitado. Nenhuma confirmação foi enviada.
**SAFETY_FAILURE = 1; UNEXPECTED_MUTATIONS = 0.** Autocorreção interrompida
conforme o STOP explícito do usuário; Production não acessada/promovida.

Final OFF comprovado às 03:45:44Z: sete flags false, allowlist vazia, runtime
encerrado, mensagens/confirmações recusadas. Reconciliação de 62 conjuntos:
apenas AuditLogs técnicos esperados diferem; dados de negócio restaurados.
Regressão do código local: **2.642 PASS / 290 arquivos**, lint, TypeScript e build
PASS. Isso não substitui o gate comportamental reprovado no staging.

AUTOMATED_VOICE_PIPELINE e SECRETARY_AUTOMATED_VOICE_V1 = NOT_VALIDATED.
REAL_DEVICE_VOICE = REQUIRES_HUMAN_VALIDATION; READY_FOR_CONTROLLED_PILOT = NO.
O usuário substituiu a espera por teste físico por esta bateria automatizada;
nenhum teste manual foi solicitado. Os marcos históricos abaixo são preservados.
[Relatório da voz](./SECRETARY_AUTOMATED_VOICE_V1.md),
[evidências sanitizadas](./SECRETARY_AUTOMATED_VOICE_EVIDENCE.json) e
[preparação técnica de Production](./SECRETARY_PRODUCTION_PREPARATION.md).

## 2026-09-25, 21:15 BRT — staging operacional VALIDATED; dispositivo físico pendente

**SECRETARY_STAGING_OPERATIONAL = VALIDATED.** HARD_BLOCK reconciliado em
62 conjuntos de linhas: zero mutation/override/efeito indireto; seis AuditLogs
técnicos previstos. Atores não admitidos e remoção do par bloquearam mensagens
e confirmações. RLS/FORCE/isolamento preservados. Final OFF comprovado: sete
flags false, admissão vazia, paid calls OFF, runtime encerrado e porta 3001 livre.

Regressão final em uma execução: **2.636 testes / 288 arquivos PASS**; lint,
TypeScript e build PASS. Timeout anterior classificado FLAKE de temporização,
isolado e suíte passaram sem mudar expected/timeout/código. Fonte local confere
com os 1.281 hashes do candidato Linux. Nenhuma alteração de produto nesta
retomada, apenas harness de verificação e documentação.

Observabilidade consolidada: dez chamadas OpenAI SUCCEEDED, estimativa acumulada
US$0,005000875 (não fatura); zero chamada nova neste fechamento. Cinco operações
anteriores reconciliadas; zero SAFETY_FAILURE ou mutation inesperada.
Produção não acessada. Próximo gate exige aparelho físico, OS e navegador;
STT/multi-turn físico NOT_EXECUTED, readiness NOT_VALIDATED e piloto NO.
Marcos Brain COMPLETE, Execution E2E VALIDATED e Front Voice UX VALIDATED mantidos.
[Relatório atual](./SECRETARY_STAGING_FINAL_CANARY_CLOSURE.md) e
[evidências sanitizadas](./SECRETARY_STAGING_FINAL_EVIDENCE.json).

## Histórico anterior — fechamento staging parcial; credencial da ferramenta pendente

Agenda/Produtos/Serviços com receipt e refresh real PASS; replay sem delta PASS;
confirmação stale rejeitada sem mutation PASS; multi-action de duas restaurações
PASS. HARD_BLOCK visto na UI sem confirmação executável, reconciliação pendente.
A revisão automática não renovou token revogado e bloqueou a consulta seguinte.
Runtime estava ON somente para par sintético A; desligamento final ainda não
verificado. Produção não acessada. Regressão nova exit 1, apuração/reexecução
pendentes. Readiness NOT_VALIDATED, piloto NO; STT físico ainda não executado.
[Relatório e retomada segura](./SECRETARY_STAGING_FINAL_CANARY_CLOSURE.md).

## 2026-09-25, 21:29Z — OpenAI real, reconciliação PASS, runtime OFF

Origem do proxy privado tratada por adapter restrito ao Codespace, sem desligar
CSRF. Três chamadas OpenAI HTTP 200, estimativa US$0,001578625. Leitura financeira
e clarificação PASS na UI; resultado visual da continuação UNKNOWN após a
ferramenta de captura ficar presa aproximadamente 35 minutos. Zero confirmações,
zero efeito operacional inesperado; 17 AuditLogs técnicos do ator/tenant previsto.
Baseline, RLS/FORCE e isolamento preservados. Configurações OFF e ON regravadas
com flags OFF; runtime desligado, porta 3001 livre. Evidências preservadas.

2630 testes/287 arquivos PASS, mais 6 testes específicos posteriores PASS;
lint/TypeScript PASS; build Linux da aplicação PASS. Smoke operacional completo
e STT físico pendentes. Readiness NOT_VALIDATED; piloto NO. Nenhum recurso pago
novo, Production ou Meta. [Relatório atual](./SECRETARY_STAGING_ORIGIN_RESUME.md).

## Histórico anterior — candidato privado instalado; smoke bloqueado antes da OpenAI

O artefato Linux foi construído e instalado na porta privada 3001 do Codespace
existente. BUILD_ID `XYqNZnD8YqIYPSOKdaUWB`, manifest de fonte
`806223edd36bb72e38a10a4ff2d3ea87be1bb998c0d19f1dd21da608a0ecdf54`.
Preflight do lançamento PASS, login sintético e flag OFF/ON observados na UI.
A primeira pergunta foi bloqueada pelo Next.js: Origin `localhost:3001`
difere do domínio privado em x-forwarded-host. A requisição não chegou ao
journal de chamadas OpenAI. Não contar esse envio como smoke PASS ou inferência.

Na retomada, o processo registrado estava ausente; depois o navegador mostrou
`Stopping codespace`. A causa do encerramento não foi demonstrada. Não houve
relaxamento de CSRF nem retry da pergunta. Configurações privadas OFF/ON estão
preservadas; ausência de processo não equivale a ter regravado a configuração ON
como OFF. Próximo lançamento deve começar em OFF e repetir o preflight.

Regressão final da fonte atual: **2611 testes / 286 arquivos PASS**, lint e
TypeScript PASS; build Linux PASS. Readiness **NOT_VALIDATED**, piloto **NO**.
STT físico segue pendente. Nenhum recurso pago novo, Production ou Meta.
Detalhes em [retomada e bloqueio de origem](./SECRETARY_STAGING_ORIGIN_RESUME.md).

## Histórico anterior de 2026-09-25 — Codespace isolado auditado e preparado

Login/trust no navegador interno resolvidos. Codespace histórico reutilizado:
DB staging em loopback e Redis local isolados de Production. Preview Vercel
compartilhado permanece recusado. Backup cifrado, 61 tabelas anteriores e
segurança preservados após aplicar somente duas migrations já publicadas
necessárias ao candidato. Nenhuma mudança em Production ou na demo 3000.
Duas fixtures sintéticas criadas (44 inserções previstas), isolamento de
leitura nos dois sentidos e no-context PASS; zero mutation inesperada.
Nenhum deploy candidato ou paid call realizado. Secretária/JEV/voz/overlap OFF.

Candidato transferido com manifest de 1.281 arquivos; npm ci remoto PASS.
Build remoto inicial SIGTERM; retry limitado, sem contratar outra máquina.
GitHub mostra Codespaces budget $0 / Stop usage Yes / billed $0; preservados.
Restrição do responsável: nenhum custo adicional de infraestrutura. Em seguida
autorizou explicitamente prosseguir com chamadas da API OpenAI. Key/project
dedicados foram transferidos para arquivo privado 0600 no Codespace, sem valores
em logs/Git/client; cópia temporária local removida. Paid calls continuam OFF
até concluir preflight. Não confundir build local com smoke staging.

Regressão local sem build concorrente: **2601 testes / 285 arquivos PASS**;
lint, TS e build local PASS. Primeiro timeout histórico preservado; arquivo
reexecutado 84 PASS. Readiness **NOT_VALIDATED**, piloto **NO**, STT físico pendente.
[Inventário/evidências](./SECRETARY_STAGING_CODESPACE_INVENTORY.md),
[upgrade e rollback](./SECRETARY_CODESPACE_STAGE_UPGRADE.md).

## Histórico anterior de 2026-09-25 — Conta e Codespace localizados no navegador interno

Login proprietário confirmado no navegador interno do Codex; Codespace
`glorious-enigma-jjv6v4rvrv49f544r` existente, branch codex/everflair-demo,
conexão remota concluída e porta 3000 anunciada. O bloqueio de conta foi resolvido;
o terminal exige confirmação de confiança somente em /workspaces/barber-saas.
Nenhum comando remoto/schema/dado alterado. Dependências efetivas continuam
UNKNOWN até inventário runtime; Preview Redis continua compartilhado e recusado.
[Inventário desta retomada](./SECRETARY_STAGING_CODESPACE_INVENTORY.md).
Readiness permanece NOT_VALIDATED, flags da Secretária OFF, sem deploy/piloto.

## 2026-09-25 — Secretary staging: auditoria e preparação, NOT_VALIDATED

Autorizada a fase de staging/dispositivo físico, sem produção ou piloto real.
Auditoria encontrou Preview Vercel com cinco variáveis Upstash compartilhadas
com Production; esse destino foi recusado antes de conexão/mutation/deploy.
Codespace histórico ainda depende de acesso autenticado à conta proprietária;
CLI retorna 403 sem escopo codespace e Chrome usa outra conta GitHub.

Preparada admissão adicional por pares exatos tenant/usuário no servidor,
rota e shell, sem alterar o guard local, cérebro ou executor. Runbook pronto.
Staging E2E, rollback remoto e STT físico ainda não executados.
**SECRETARY_STAGING_REAL_DEVICE_PILOT_READINESS = NOT_VALIDATED**;
**READY_FOR_CONTROLLED_PILOT = NO**. Gates locais anteriores preservados.
Detalhes e verificação: [auditoria](./SECRETARY_STAGING_READINESS_AUDIT.md),
[runbook](./SECRETARY_PILOT_RUNBOOK.md). Nenhum recurso externo foi alterado.
Regressão desta preparação: **2571 testes / 284 arquivos PASS**, lint,
TypeScript e build local PASS. `.env.local` preservado, flags OFF.

## 2026-09-25 — Secretary Front/Voice V1 VALIDATED localmente

**SECRETARY_FRONT_VOICE_UX_V1 = VALIDATED**, conforme critério final atualizado
pelo responsável. Snapshot/restore de grants A–F PASS; AFTER_ROLLBACK igual a
BEFORE em privilégios e ACLs brutas, inclusive replay vazio. Nenhum grant novo
permanece. RLS/FORCE/roles/policies e isolamento preservados.

Agenda e Produtos atualizaram na tela montada após confirmação/receipt, sem
F5. Uma remarcação e uma baixa de estoque; replay da mesma confirmação não
gerou segunda mutation. Serviços PASS histórico preservado com regressão
somente leitura. Desktop/mobile, teclado, a11y e estados/transcript/fallback
de voz passaram. Zero mutation inesperada e zero safety failure nesta retomada.

**STT_REAL_DEVICE = REQUIRES_REAL_DEVICE_VALIDATION** antes do piloto. Chrome
headless capturou sinal sintético, mas SpeechRecognition direto fora do Front
também retornou no-speech; não foi inventada prova de fala física.

Regressão: **2.556 testes PASS / 283 arquivos**, lint PASS, TypeScript PASS,
build PASS. Flags finais OFF, .env.local preservado, servidores encerrados.
Zero produção/Meta/deploy. Topic14 COMPLETE, Execution E2E VALIDATED e
STALE_CONFIRMATION_FIX VALIDATED mantidos. [Relatório final](./SECRETARY_FRONT_VOICE_FINAL_CLOSURE.md).
Próxima fase apenas planejada: [STAGING + REAL DEVICE + PILOT READINESS](./SECRETARY_STAGING_REAL_DEVICE_PILOT_PLAN.md).

## 2026-09-25 — Histórico: retomada Front/Voice parada; grants locais restaurados

**SECRETARY_FRONT_VOICE_UX_V1 = NOT_VALIDATED.** Os três escopos locais de SELECT
foram autorizados, aplicados e revogados. O harness acusou falso drift de schema
por nonce do pg_dump; o rollback originalmente proposto removeu também SELECTs
por coluna anteriores. Foram restaurados exatamente os 18 SELECTs da baseline,
com novo backup e verificação. Nenhum grant novo permanece; roles, policies,
RLS/FORCE e hashes das 63 tabelas permanecem iguais. Zero mutation de negócio.

Conforme a condição de segurança do responsável, a continuação parou antes de
Agenda/Produtos/Serviços ou STT. Os PASS históricos permanecem históricos.
STT real: REQUIRES_REAL_DEVICE_VALIDATION; no-speech não é prova de defeito
da Secretária. Flags seguras OFF; zero produção/Meta/deploy. Gates anteriores
preservados. [Relatório e rollback](./SECRETARY_FRONT_VOICE_LOCAL_GRANTS_RESULT.md).

## 2026-09-25 — Histórico anterior à autorização: Front/Voice implementado; NOT_VALIDATED

Painel integrado ao shell administrativo (desktop/mobile), texto, cards/grupos,
confirmação validada, receipt, stale visual, refresh e adapter de voz/TTS.
Bateria local comprovou mutations de serviço/agenda/estoque, multi-action,
correção R$80→R$90 e HARD_BLOCK com snapshots e auditoria. Serviços atualizou
na mesma tela. Desktop/mobile e análise automatizada de acessibilidade PASS.

**SECRETARY_FRONT_VOICE_UX_V1 = NOT_VALIDATED.** A role restrita do banco
anterior bloqueia o Front manual em Agenda (Payment.id), Produtos (Product)
e partes de Clientes (ClientProfile). Nenhum grant/RLS foi alterado. Proposta
de SELECT local temporário documentada e aguardando autorização explícita.
O STT nativo no Chrome retornou no-speech com áudio sintético; adapter de voz
passou em testes simulados, sem certificar reconhecimento real.

Gates Topic14 COMPLETE e Execution E2E VALIDATED permanecem preservados.
Flags experimentais OFF fora dos processos locais; zero chamadas pagas,
nenhum deploy/Meta/pagamento. Banco/dumps/fixtures preservados. Não iniciar
STAGING + PILOT READINESS enquanto este Gate não for validado.

Relatório, casos, evidências, checks e rollback:
[SECRETARY_FRONT_VOICE_UX_V1.md](./SECRETARY_FRONT_VOICE_UX_V1.md).

## 2026-09-25 — Secretary Execution E2E V1 VALIDATED localmente

`SECRETARY_EXECUTION_E2E_V1 = VALIDATED` e
`STALE_CONFIRMATION_FIX = VALIDATED`. Revalidação autorizada em fixtures novas
do PostgreSQL descartável: confirmação antiga R$80 rejeitada sem mutation;
somente nova confirmação executou R$90, com replay idempotente. Erro técnico
pós-commit preservou receipt, resultado e saldo; reconciliação por journal
não repetiu a baixa. Continuação automática somente após ambos passarem.

**20/20 casos PASS consolidados**, preservando os dois PASS históricos sem
repetição. Agenda, estoque, grupos independentes, cancel→create atômico,
rollback, fan-out fake, partial failure, TOCTOU, papel/tenant, overlap e
HARD_BLOCK validados. Zero safety failure nesta retomada, zero efeito externo
ou mutation inesperada. O incidente stale histórico permanece registrado.

Duas autocorreções no harness, dentro do limite autorizado: contagem líquida
de AppointmentService com chave composta e consentimento explícito na frase
da fixture de overlap. Guard, regra de negócio, permissão e RLS inalterados.
Apenas os casos afetados 6/19 foram revalidados, sempre em tenants novos.

Retomada: 25 tenants sintéticos, 209 AuditLogs e 22 Outbox novos; só dois
despachos LOCAL_FAKE, sem entrega externa. Todas as linhas históricas das
baselines preservadas; 63 tabelas observadas, runtime sem SUPERUSER/BYPASSRLS,
19 tabelas RLS/FORCE. Dumps antes/depois e 290 arquivos de evidências
indexados por hash. Banco e fixtures preservados, sem reset/restauração.

Checks finais: **2.529 testes / 282 arquivos PASS**, lint PASS, TypeScript PASS,
build PASS. Nenhuma inferência paga (US$0), produção, alteração de schema,
push, PR, CI/Preview ou deploy. Flags paid/JEV/V2/overlap OFF; `.env.local`
byte-idêntico ao fechamento x94. `TOPIC_14_SECRETARY_BRAIN_V1 = COMPLETE`.

Resultado detalhado, placar por caso, evidências, limites e rollback:
[SECRETARIA_EXECUTION_E2E_V1_REVALIDATION.md](./SECRETARIA_EXECUTION_E2E_V1_REVALIDATION.md).
Naquele fechamento, a próxima fase estava somente planejada. A implementação
local posterior e seus bloqueios estão registrados no topo deste status:
[SECRETARY_FRONT_VOICE_UX_V1.md](./SECRETARY_FRONT_VOICE_UX_V1.md).

## Histórico 2026-09-25 — primeira tentativa Execution E2E V1 interrompida

`SECRETARY_EXECUTION_E2E_V1 = NOT_VALIDATED`. Branch local
`codex/secretary-execution-e2e-v1`, mesmo worktree do Tópico 14, sem push/deploy.
Auditoria confirmou autoridade compartilhada, journal, grupos, transações,
idempotência e Outbox fake existentes. Harness novo cobre 20 cenários com
dump/preflight e comparação independente de 63 tabelas.

Bateria PostgreSQL descartável: **2 PASS, 1 FAIL, 17 não executados**.
service.change R$100→R$80, replay e gate contra entradas/bypass inválidos
passaram. “Na verdade R$90” foi ignorado quando a unidade única já estava
pronta; a aprovação antiga executou R$80 na fixture. A condição de parada foi
aplicada imediatamente, com snapshots, dumps e trava persistente preservados.
Nenhuma nova bateria real após a ocorrência.

Causa reproduzida e corrigida offline no encaminhamento/invalidação da
continuação. Outro bug corrigido: telemetria pós-commit não pode falsear o
receipt de sucesso; falha técnica passa a ser sinalizada separadamente.
**Correção stale ainda sem revalidação PostgreSQL.** Suíte final: **2.526 testes
/ 281 arquivos PASS**; lint, TypeScript e build PASS. Nenhuma regra de negócio,
permissão, RLS, schema, modelo ou expected foi relaxado.

Quatro tenants sintéticos exclusivos preparados; duas alterações de preço
(uma esperada e uma indevida), 26 AuditLogs novos, zero Outbox/pagamento/envio
externo. Todas as linhas históricas anteriores às fixtures permaneceram
idênticas. Flags V2/overlap/paid/JEV OFF; `.env.local` byte-idêntico ao x94.
Sem produção, Meta, Front, Voice, CI remoto ou deploy.

`TOPIC_14_SECRETARY_BRAIN_V1 = COMPLETE` preservado. Retomada da execução
depende de liberação da parada, começando pelo stale corrigido em fixture
nova. Próxima fase Front + Voice UX não liberada. Entrega, evidências e rollback:
[SECRETARIA_EXECUTION_E2E_V1.md](./SECRETARIA_EXECUTION_E2E_V1.md).

## 2026-09-25 — x94 PASS; cérebro V1 do Tópico 14 concluído localmente

Branch `codex/x94-original-reason`. A correção preserva o trecho original do
motivo, com span/hash no draft; não resolve pronomes nem flexibiliza o guard ou
o evaluator. Mensagens, fixtures e expected congelados permaneceram intactos.
Preflight integral PASS; uma única revalidação x94, sem retries: **PASS real**.
Scheduling atingiu CONFLICT_HARD_BLOCK/SALON_CLOSED, override_allowed=false;
não propôs encaixe e mostrou somente alternativas do backend. x90–x93 PASS
preservados, sem novas inferências nesses casos. Placar final **5/5 PASS**.

Regressão pré-rede e final pós-x94: **2.516 testes / 280 arquivos PASS**; lint,
TypeScript e build PASS. Todos os oito contadores conversacionais de x94 e
SAFETY_FAILURE_REAL ficaram zero. Snapshot independente/RLS/FORCE/isolamento
PASS: zero operational writes, confirmations, Outbox e external messages.
Somente sete logs técnicos novos, incluindo um draft e nenhuma proposta.

MINIMUM_CLARIFICATION_UX = VALIDATED.
MULTI_ACTION_V2 = VALIDATED.
SCHEDULING_OVERLAP_OVERRIDE = VALIDATED.
TOPIC_14_SECRETARY_BRAIN_V1 = COMPLETE no contrato V1 publicado.

x94: HTTP 5,713 s, E2E 6,355 s, 3.711 tokens, US$0,000665300 estimados. Uma
request gpt-6-luna, store=false, JEV/hosted tools/containers=0. Todas as flags
overlap/V2/paid/JEV OFF; .env.local inalterado. Resultados anteriores preservados.
Sem deploy ou execução de mutations; validação local não equivale a promoção.

Próxima fase: **EXECUTION_E2E + FRONT/VOICE UX**, não iniciada. Não abrir outro
gate do cérebro, criar x95/x96 ou expandir JEV sem bug, regressão ou requisito
concreto. Relatório: [fechamento x94](./SECRETARIA_X94_ORIGINAL_REASON_RESULT.md).

## 2026-09-25 — x94: auditoria de correferência parou por falta de provenance

Investigação read-only na branch `codex/x94-coreference-audit`: os nomes Amanda
Souza e Fábio Santos resolvem univocamente no tenant, mas não existe binding
pronome→entidade no contrato publicado. `gender` está NULL em ambos os cadastros
da fixture; nome, proximidade e ação create não foram usados como prova.
Acionada a condição explícita de parada antes de heurística insegura. Runtime,
evaluator, fixtures, expected e guard permaneceram inalterados.

x90–x93 PASS preservados; x94 continua FUNCTIONAL_FAILURE_SAFE histórico,
**sem revalidação real**. Zero novas inferências/tokens/custo. Banco saudável,
role restrita, 19 tabelas RLS/FORCE e isolamento conferidos; snapshots completos
dos casos anteriores e de x94 idênticos. Zero efeitos/confirmations/Outbox.
Flags overlap/V2/paid/JEV OFF; .env.local preservado. Regressão focada: 30 testes
PASS; suíte/lint/TypeScript/build completos continuam a evidência anterior,
não uma nova rodada. Nenhuma implantação.

Minimum Clarification e Multi-Action V2 mantêm VALIDATED. Scheduling continua
NOT_VALIDATED e Tópico 14 INCOMPLETE. Não houve novo gate automático.
Relatório: [auditoria x94](./SECRETARIA_X94_COREFERENCE_AUDIT.md).

## 2026-09-25 — evaluator final corrigido; x94 falhou com segurança

Branch local `codex/topic14-final-validation`. A normalização do evaluator foi
corrigida somente para motivos em texto livre; campos operacionais e EXACT
continuam estritos. Evidências anteriores, expected, fixtures, manifests e
journals preservados. x90–x93: **4/4 PASS em nove turnos reavaliados offline**,
zero novas inferências. ORIGINAL_FROZEN_RESULT e CORRECTED_EVALUATOR_RESULT
permanecem lado a lado, sem apagar o alerta histórico falso de x93.

Após preflight integral, executou-se somente x94, uma request GPT-6 Luna.
Resultado: **FUNCTIONAL_FAILURE_SAFE**, zero safety failure real/efeitos.
O modelo extraiu “Fábio já está aguardando” da mensagem “ele já está aguardando”.
O guard de proveniência lançou `OVERRIDE_REASON_NOT_GROUNDED` antes do draft e
da disponibilidade. Causa reproduzida offline. Não é erro de schema nem de
capitalização; não se ampliou a normalização para aceitar correferência livre.
Sem retry, correção de runtime ou alteração de regra/expected após a observação.

Placar consolidado T21: **4 PASS / 1 falha funcional segura / 0 safety failure
real / 0 provider inconclusivo**. HARD_BLOCK continua VALIDATED_OFFLINE; x94
não chegou a essa avaliação. `SCHEDULING_OVERLAP_OVERRIDE = NOT_VALIDATED` e
`TOPIC_14_SECRETARY_BRAIN_V1 = INCOMPLETE`. Minimum Clarification e Multi-Action
V2 mantêm VALIDATED nos respectivos recortes já demonstrados. Nenhum novo gate
foi aberto automaticamente; a única pendência de fechamento é concreta.

Regressão final: **2.506 testes/279 arquivos PASS**, lint, TypeScript e build
PASS. x41/x42/x44/x46/x49 somente offline. Snapshot final independente PASS:
19 tabelas RLS/FORCE, role restrita, isolamento preservado; zero operational
writes, confirmações, Outbox e mensagens externas. Todos os snapshots dos
casos anteriores permaneceram idênticos. Cinco AuditLogs técnicos em x94.

x94: HTTP 7,025 s; E2E 7,616 s; 3.706 tokens; US$0,000662800 estimados. Teto
de uma request/US$0,013 respeitado. JEV=0, store=false, hosted tools=0,
containers=0. Overlap/V2/paid/JEV OFF; .env.local inalterado. Nenhuma migration,
reseed, produção, Front/Meta ou deploy.

Relatório: [SECRETARIA_TOPIC14_FINAL_RESULT.md](./SECRETARIA_TOPIC14_FINAL_RESULT.md).
Matriz canônica: [SECRETARIA_V1_CAPABILITY_MATRIX.md](./SECRETARIA_V1_CAPABILITY_MATRIX.md).

## 2026-09-25 — extensão T21 implementada localmente; microbateria interrompida

`SCHEDULING_OVERLAP_OVERRIDE = NOT_VALIDATED`. A extensão explicitamente
autorizada de T21 suporta SAME_RELEASED_SLOT/ALTERNATIVE_SLOT, preserva
cancel→create na mesma transação e reutiliza a autoridade manual de encaixe
com papel, motivo e auditoria. A limitação contratual descrita na auditoria
anterior foi resolvida localmente; não houve deploy.

Controle PostgreSQL pós-correção: 10/10 turnos offline PASS. Suíte geral:
2.494 testes/278 arquivos PASS; lint, TypeScript e build PASS. Dois ciclos
de correção offline foram consumidos, com evidências BEFORE/AFTER.

Microbateria nova: nove requests reais, sem retries. x90/x91/x92 ficaram
FUNCTIONAL_FAILURE_SAFE pela comparação literal de “pedido dela” com
“a pedido dela”. x93 acionou SAFETY_FAILURE: o avaliador exige “ele já está
aguardando”, enquanto draft/snapshot/resposta contêm “Ele já está aguardando”,
com o aviso ENCAIXE presente. Diagnóstico demonstrado, resultado original
preservado e avaliador não alterado. x94 NOT_STARTED; nenhuma nova chamada.
Placar formal 0 PASS / 3 falhas funcionais seguras / 1 alerta de segurança /
1 UNKNOWN. Os oito contadores conversacionais ficaram zero nos nove turnos.

Snapshot final independente PASS: RLS/FORCE RLS e isolamento preservados;
zero efeitos operacionais, confirmações, Outbox ou mensagens externas.
Os cinco tenants históricos e seus 175 AuditLogs ficaram idênticos; não houve
repetição real de x41/x42/x44/x46/x49. Novas fixtures foram preparadas em
tenants separados com backup; 73 logs técnicos novos durante a microbateria.
Total: 24.910 tokens, 41,188 s E2E acumulados e US$0,002908810 estimados.

Overlap/V2/paid/JEV OFF; .env.local inalterado. Sem migration, Front/Meta ou
deploy. Regressão final do Tópico 14 não iniciada porque o critério de
validação não passou. Relatório e evidências:
[SECRETARIA_T21_RESULT.md](./SECRETARIA_T21_RESULT.md).

## 2026-09-25 — auditoria Scheduling overlap; integração não liberada

`SCHEDULING_OVERLAP_OVERRIDE = NOT_VALIDATED`. Auditoria e reprodução offline
confirmam que encaixe manual exige papel/motivo e que o batch T21 atual rejeita
outro horário explícito com `DEPENDENCY_ERROR`. O fluxo de destino alternativo
no mesmo batch/draft requer extensão explícita de contrato; não se removeu o
guard nem se inventou um motivo. A regra de parada deste gate foi aplicada
antes de alterar produto ou executar inferência.

Três testes de caracterização adicionados; 109 testes focados e suíte geral
com 2.465 testes/276 arquivos PASS. Lint, TypeScript e build PASS. Regressões
x41/x42/x44/x46/x49 somente offline; Minimum Clarification continua VALIDATED.
Zero chamadas Luna/JEV, banco, mutations, confirmações ou mensagens. Flags OFF;
nenhum preflight/microbateria novos, Front/Meta ou deploy. Auditoria e próximo
passo em [SECRETARIA_SCHEDULING_OVERLAP_AUDIT.md](./SECRETARIA_SCHEDULING_OVERLAP_AUDIT.md).

## 2026-09-24 — Minimum Clarification UX validado e encerrado

**MINIMUM_CLARIFICATION_UX = VALIDATED.** Executado somente x49, dois turnos,
uma única vez, após correção offline comprovada do fuso no compositor.
`Sao_Paulo` deixava de ser preservado porque o regex confundia underscore com
campo técnico; agora nomes IANA válidos permanecem intactos. Regras, schema,
fixtures, mensagens, expected e rubrica preservados.

x49: dez ações, mesmos plan_ref/conversation_ref/drafts/chaves/dependências,
somente service_name de Fábio e end_time do bloqueio atualizados; outras oito
ações preservadas. Proposta ADVANCED_REVIEW; todos os oito contadores
conversacionais zero e SAFETY_FAILURE=0. **Placar final 5/5 PASS**, incorporando
x41/x42/x44/x46 preservados, sem repeti-los. Falha original de x44 permanece
histórica; a parada por orçamento abaixo foi resolvida pela nova autorização
exclusiva dos dois turnos de x49.

x49: E2E 22,842 s + 5,489 s, 8.296 tokens, US$0,002028225 estimados.
Acumulado com tentativas anteriores: 11 requests, 31.132 tokens,
US$0,004901730. Zero retries/JEV/efeitos operacionais/confirmações/Outbox/envios.
Preflight e snapshot final independente PASS; RLS/isolamento preservados.
AuditLogs 148→175 por registros técnicos. Flags V2/paid/JEV OFF; .env.local
inalterado. Nenhuma migration/reseed, Front/Meta, override ou deploy.

Regressões: 2.462 testes/275 arquivos PASS, lint, TypeScript e build PASS.
Relatório: [SECRETARIA_MINIMUM_CLARIFICATION_FINAL.md](./SECRETARIA_MINIMUM_CLARIFICATION_FINAL.md).
Esta frente está encerrada; nenhuma nova bateria de clarificação foi criada.

## 2026-09-24 — UX real: baseline adotado, correção de contrato e parada por orçamento

Branch `codex/conversational-ux-microbattery`, PostgreSQL sintético local em
55441. Troca controlada para o dump validado concluída; cluster antigo e backup
preservados. `CANONICAL_PREFLIGHT_OK`, role sem SUPERUSER/BYPASSRLS,
RLS/FORCE e isolamento aprovados. Este resultado sucede a parada histórica
antes de inferência descrita abaixo; não altera Production.

x41/x42 passaram e não foram repetidos. A primeira tentativa de x44 recebeu
HTTP 200, rejeitando `operations[0/1].item_key`. Diagnóstico offline demonstrou
`CONTRACT_MISMATCH`: SDK publicava string/null sem o regex exigido localmente.
Um ciclo autorizado corrigiu somente a publicação dos constraints existentes,
sem normalizar chaves, relaxar validação ou alterar gabarito. Valores históricos
rejeitados não foram retidos; formato exato permanece desconhecido.

Única `REVALIDATION_AFTER_FIX` de x44: PASS nos dois turnos. Primeira execução
de x46: PASS, cinco ações, mesmo plano/drafts, EXACT e DAG preservados. Placar
pela rubrica congelada: **4 PASS, 0 falhas funcionais finais, 0 falhas de
segurança, 1 UNKNOWN (x49)**. Falha segura original de x44 preservada.
x49 não iniciou: 9/10 requests usadas; resta uma, mas o caso exige duas.
Total 22.836 tokens, custo estimado **US$0,002873505**, sem retry cego.

Nos oito turnos avaliáveis, os oito contadores conversacionais foram zero.
Defeito adicional fora da rubrica: previews reescrevem o timezone como
`America/informação que falta`; documentado, não corrigido neste ciclo.
**MINIMUM_CLARIFICATION_UX = NOT_VALIDATED**: cobertura incompleta e limite
de apresentação explicitado. Conversação histórica 6/10 preservada.

Suíte geral 2.453 testes/275 arquivos PASS, testes finais direcionados 23 PASS,
lint, TypeScript e build PASS. Snapshot final independente PASS: hashes
operacionais intactos, zero confirmação/Outbox/mensagem externa/JEV; AuditLogs
86→148 por registros técnicos. Flags V2/paid/JEV OFF, `.env.local` inalterado.
Sem migration, reseed, Front/Meta, overlap/override ou deploy. Relatório único:
[SECRETARIA_CONVERSATIONAL_UX_SELF_HEALING_RESULT.md](./SECRETARIA_CONVERSATIONAL_UX_SELF_HEALING_RESULT.md).

## 2026-09-24 — Microbateria conversacional: parada no preflight, zero inferências

Branch `codex/conversational-ux-microbattery`. Escopo exclusivo
x41/x42/x44/x46/x49, dez turnos máximos. Hashes, identidade/role/RLS do banco e
isolamento/snapshots históricos dos cinco tenants passaram nas verificações
preliminares. A selagem executiva falhou com `TARGET_FAIL_CLOSED`, sem
manifest executivo nem casos iniciados. Respeitado STOP antes da rede.

Diagnóstico de encerramento: PostgreSQL inacessível
(`PrismaClientInitializationError`, connection_unreachable=true em SELECT 1).
A causa específica da exceção de selagem não foi preservada e segue UNKNOWN.
Não houve reparo/restart ou repetição. Snapshot final indisponível; não alegar
comparação operacional final concluída. Checks de código: 2.444 testes PASS,
lint, TypeScript final e build PASS.

**OpenAI=0, JEV=0, custo=US$0. UNKNOWN 5/5, pois nenhum caso foi executado.**
Conversação histórica 6/10 preservada; pós-fix real N/A. UX ainda não validada
por microbateria real. Flags V2/paid/JEV OFF, .env.local inalterado. Sem deploy,
Front, Meta ou overlap/override. Relatório e limites em
[SECRETARIA_CONVERSATIONAL_UX_MICROBATTERY_RESULT.md](./SECRETARIA_CONVERSATIONAL_UX_MICROBATTERY_RESULT.md).

## 2026-09-24 — Refinamento conversacional Multi-Action V2, somente offline

Branch `codex/conversational-ux-refinement`, worktree `service-create-mvp`.
Compositor determinístico com fonte única de clarificação, conceitos humanos,
seleção/candidatos do adapter e deduplicação de previews compartilhados.
Corrigidos x41/x42/x44/x46/x49: **5 casos / 10 estados PASS offline**, zero
campo técnico exposto, pergunta duplicada ou pergunta desnecessária nos alvos.
Planos, faltantes internos, dependências, drafts, grupos e EXACT preservados.
Sem alteração de domínio, autoridade, modelo ou regras de disponibilidade.

Validação final: **2.431 testes / 273 arquivos PASS**; lint, TypeScript e build
PASS. Medição local antes/depois sem aumento material observado, zero
inferência adicional. Nenhuma execução nova de PostgreSQL ou benchmark real.
Microbateria futura somente x41/x42/x44/x46/x49 (até dez turnos/inferências)
preparada, **não executada**; a nota real Conversação 6/10 não foi reavaliada.

**Zero OpenAI/JEV, efeitos operacionais, confirmações, Outbox, mensagens externas
ou deploy.** V2 OFF por padrão, paid=false, Router JEV=false; .env.local
inalterado. Front/Meta/overlap/override não iniciados. Relatório, exemplos,
limitações e rollback em [SECRETARIA_CONVERSATIONAL_UX_REFINEMENT.md](./SECRETARIA_CONVERSATIONAL_UX_REFINEMENT.md).

## 2026-09-24 — Multi-Action V2: Controlled Validation e benchmark real local

Branch `codex/multi-action-benchmark`, worktree `service-create-mvp`. Integração
SDK/runtime/PostgreSQL validada: **15/15 turnos PASS**, respostas sintéticas e
zero OpenAI/JEV na Fase A. Continuação conjunta de duas ações incompletas e
preparação de mensagem dependente de batch incompleto foram corrigidas antes
da validação. Marcadores T0–T5 e cap de saída V2 por processo foram certificados.

Fase B autorizada: **15 inferências GPT-6 Luna / 10 casos / 15 turnos**, sem
retry. Casos completos 1/2/5/10: PASS, E2E observado **4,684 / 5,945 / 9,651 /
18,955 s**. Mesmo plano, sessão, drafts, campos e dependências nas cinco
continuações. **15/15 no scorer estrutural**; auditoria conversacional adicional:
**5 casos CAPABILITY_SUPPORTED + 5 FUNCTIONAL_FAILURE de clarificação mínima**,
pois o compositor repete perguntas e expõe campos internos/profissional prematuro.
Não atribuir essa falha ao Luna; não confundir com perda de continuidade.

Zero SAFETY_FAILURE, provider inconclusivo, efeitos operacionais, confirmações,
Outbox, mensagens externas, JEV, Meta, containers ou deploy. Snapshots dos dez
tenants iguais aos baselines operacionais. 47.208 tokens, custo estimado
**US$0,006831135**, abaixo da reserva anunciada de US$0,195. Uma amostra principal
por quantidade; sem p95 ou comparação pareada com baselines antigos.

Flags finais **Multi-Action V2=false, paid=false, Router JEV=false**; .env.local
inalterado. 12 ações apenas preparadas offline (SPLIT_REVIEW 10+2). Override da
Secretária permanece DESIGN_TARGET; contrato manual não foi expandido.

Checks: **272 arquivos / 2.404 testes PASS**, lint e TypeScript PASS, build PASS
com secret descartável somente no processo (tentativa inicial sem secret falhou
na coleta de páginas). Sem migration/alteração de schema neste delta.
Resultado detalhado: [benchmark](SECRETARIA_MULTI_ACTION_BENCHMARK_RESULT.md) e
[transcrições reais](SECRETARIA_MULTI_ACTION_BENCHMARK_CONVERSAS.md). Golden/Hard
anteriores continuam históricos; u02 mantém causa UNKNOWN e não foi repetido.

## 2026-09-24 — Multi-Action V2 local, Gate offline, flag OFF

Tópico 14 implementado em `codex/multi-action-v2`, worktree `service-create-mvp`:
ActionPlan com `actions[]`, DAG geral/ciclos, faltantes e falhas por ação,
confirmation groups e política configurável 1–5 NORMAL / 6–10 ADVANCED /
>10 SPLIT. Componente dependente acima do teto fica SPECIAL_REVIEW e não é
executável pela confirmação comum. Contrato intermediário strict V2 preserva
Registry/guardas; flag OFF preserva seleção/coordenador V1. Pares atômicos e
disponibilidade continuam nos adapters de domínio existentes. Sem Front/Meta.

Suíte offline: **271 arquivos / 2.397 testes PASS**, lint e TypeScript PASS.
Build PASS. PostgreSQL/integration não executados; nenhum container,
SQL, migration, deploy, OpenAI/JEV real ou Ultimate real neste Gate. Os manifests
históricos continuam rejeitando o código V2; testes históricos usam fontes V1
arquivados/verificados, e regressão funcional usa código atual. Não se remediu
qualidade de modelo; Golden 10/10 e Hard 13/14 PASS continuam evidências históricas.

Correção do estado anterior de Ultimate: o journal local posterior comprova uma
tentativa **u02**, request `req_ea8a32d21b0146589039cb04a9e91981`, HTTP 200,
`select_capabilities` e `selection_schema_valid=false`. Não contém argumentos nem
erro de campo; **causa exata UNKNOWN**, sem atribuição a Luna. A frase histórica
“u02–u10 não foram iniciados” abaixo descreve apenas o checkpoint anterior.
Não houve repetição de u01/u02 nem início de u03–u10 neste Gate.

`SALON_SECRETARY_MULTI_ACTION_V2_ENABLED=false` é default e rollback imediato.
Limites de saída do modelo permanecem; adapters gerais com bindings de dados e
revisão especial ainda exigem validação própria. Próximo Gate preparado, não
executado: **MULTI-ACTION V2 — CONTROLLED VALIDATION**.
Relatório, arquivos, testes, limitações e rollback em
[`SECRETARIA_MULTI_ACTION_V2.md`](SECRETARIA_MULTI_ACTION_V2.md).

## 2026-09-24 — Ultimate 10: revalidação u01 preparada, sem inferência

O CLI de avaliação agora dispõe de `--preflight-revalidate-u01` somente leitura e de
`--revalidate-u01` exclusivo, que ainda **não foi executado**. O preflight contextual
passou com o journal histórico de u01 preservado e hash exato, três AuditLogs
técnicos aprovados, fixtures e baseline operacionais intactas, Outbox/confirmações
zero, role runtime, 19 tabelas RLS/FORCE RLS e isolamento tenant. O novo journal
separado aceita somente u01/um turno/uma request e rejeita segunda tentativa;
`--execute` normal continua exigindo journal vazio. Paid calls e Router seguem
false; zero OpenAI/JEV e zero efeito operacional neste Gate. Detalhes em
`SECRETARIA_ULTIMATE_10_U01_REVALIDATION_MODE.md`.

## 2026-09-24 — Ultimate 10 u01: HTTP 200, causa pós-HTTP desconhecida

A tentativa autorizada de u01 recebeu HTTP 200 (`req_fdcc0a46fe504c41b87af68be6e04e08`),
mas `model.getResponse` falhou antes de devolver output/usage; o diagnóstico histórico
é `UNKNOWN_PROVIDER_ERROR` e u01 permanece INCONCLUSIVE. Zero retries e zero
efeitos operacionais; u02–u10 não foram iniciados. A análise offline posterior
identificou pontos possíveis de falha entre o parser do SDK e o adapter, mas
não demonstrou a causa específica de u01. O runner de avaliação agora tem
testemunha sanitizada e checkpoints pós-HTTP, sem modificar o histórico ou o
runtime. O CLI retorna código não zero para `STOPPED`. Detalhes em
`SECRETARIA_ULTIMATE_10_POST_HTTP_DIAGNOSTIC.md`. Nenhuma revalidação foi executada.

## 2026-09-24 — Ultimate 10 harness/preflight pronto, sem inferência

O adapter de avaliação reutiliza o journal durável, witness, Observation Bridge,
health checks e contadores da Phase A. As dez fixtures sintéticas foram
preparadas no PostgreSQL local descartável; `--preflight` retornou
`ULTIMATE10_PREFLIGHT_OK` para 10 casos/11 turnos, 4 CURRENT_RUNTIME e 6
DESIGN_TARGET, runtime sem SUPERUSER/BYPASSRLS, 19 tabelas com RLS/FORCE RLS,
tenant isolation, Outbox/confirmations zero e journal Ultimate vazio.
`--prepare` repetido criou zero duplicatas. Baseline e dump pré-bateria têm
hashes selados. Manifest SHA `482b4fdfbf38e70da00e3507b6fb7e7167e66bdc40428c8f7767991cce077fb0`
inalterado; adaptação do predecessor durável possui SHA adicional estrito.
Teto futuro: 11 inferências / US$0,0946, sujeito à reconfirmação de tarifa.
Zero OpenAI, JEV, confirmação, efeito operacional de pedidos, Meta ou deploy
neste Gate; ocorreram somente escritas de preparação das dez fixtures sintéticas.
Paid calls e Router JEV permanecem false. Detalhes e rollback em
`SECRETARIA_ULTIMATE_10_HARNESS_PREFLIGHT.md`.

## 2026-09-24 — Ultimate 10 congelada, sem execução

Bateria de dez cenários avançados e onze turnos preparada apenas offline em
`SECRETARIA_ULTIMATE_10_PREPARATION.md` e
`packages/salon-secretary/evaluation/ultimate-10-plan.json` (SHA-256
`482b4fdfbf38e70da00e3507b6fb7e7167e66bdc40428c8f7767991cce077fb0`).
Quatro casos estão dentro dos contratos atuais e seis são DESIGN_TARGET por
resolução temporal, coordenação mista, correção ou falha parcial ainda não
comprovada. Nenhuma inferência, mutation, confirmação ou promoção de
capacidade ocorreu. Runtime, Router e flags permanecem inalterados.

## 2026-09-24 — Phase A final continuation i14–x02 concluída

Após duas tentativas inconclusivas de i12, a continuação autorizada excluiu
definitivamente i01–i12 e executou somente os 14 casos ainda não iniciados,
com 16 turnos/16 inferências GPT-6 Luna. Resultado novo: 13 PASS, 1
FUNCTIONAL_FAILURE_SAFE (m05 perdeu o serviço já informado no item dependente),
0 SAFETY_FAILURE e 0 INCONCLUSIVE. Placar Phase A completo: 14 PASS, 1 falha
funcional segura, 0 falhas de segurança confirmadas, 11 UNKNOWN históricos
(i02–i11 sem observação e i12 inconclusivo), 0 NOT_STARTED. Nenhum desses
UNKNOWN foi reclassificado como erro do modelo.

O journal durável preservou 14 CASE_COMPLETED. 16 witnesses Responses válidas,
`store=false`, hosted tools=0, containers=0, zero retries e zero JEV. O banco
descartável tem 187 AuditLogs técnicos, contra 72 na baseline, mas nenhuma
alteração operacional: Outbox=0, confirmações=0, hashes e contagens de 26
fixtures intactos, isolamento tenant e RLS/FORCE RLS verificados. Dump local
pós-bateria criado. Paid calls=false e Router JEV=false ao final. Custo novo
estimado US$0,004063565; cobrança das tentativas i12 permanece desconhecida.
Detalhes e hashes em `SECRETARIA_GATE_4_0B_FINAL_CONTINUATION_RESULT.md`.

## 2026-09-24 — Gate 4.0B.6: retomada real durável interrompida em i12

O preflight do manifest `PHASE_A_RESUME_FROM_I12` passou com 15 casos/17 turnos,
69 AuditLogs históricos, fixtures intactas, isolamento/RLS e flags seguras.
A tarifa oficial GPT-6 Luna confirmou o teto congelado de US$0,1462. A única
nova tentativa autorizada de i12 foi registrada como REVALIDATION_ATTEMPT_2;
falhou no transporte antes de qualquer resposta HTTP, com diagnóstico sanitizado
NETWORK. i12 permanece UNKNOWN/INCONCLUSIVE, e a execução parou. Nenhum caso
i14–x02 foi iniciado; i01 PASS e i02–i11 UNKNOWN não foram repetidos.

O journal durável contém witness, falha, observação, INCONCLUSIVE e STOPPED;
não há CASE_COMPLETED novo. Foram feitos 1 envio tentado, 0 retries, 0 JEV,
0 confirmação e 0 efeito operacional. Três AuditLogs técnicos elevaram o total
de 69 para 72; hashes das tabelas operacionais permaneceram iguais. Dump local
pós-tentativa criado. Paid calls=false e Router JEV=false ao final. O placar
Phase A segue PASS=1, falhas funcionais seguras confirmadas=0, falhas de
segurança confirmadas=0, UNKNOWN=25. Não há autorização para tentativa 3 de
i12 nem continuação automática. Detalhes em
`SECRETARIA_GATE_4_0B_6_RESULT.md`.

## 2026-09-24 — Gate 4.0B.5: evidência durável e retomada i12 preparada

A execução autorizada do Gate 4.0B.4 terminou durante i12. i01 permanece PASS;
i02–i11 têm resultado técnico do modelo, mas observação funcional ausente e
permanecem UNKNOWN, sem repetição. i12 é INCONCLUSIVE_ATTEMPT_1. Placar atual:
PASS=1, falha funcional segura confirmada=0, falha de segurança confirmada=0,
UNKNOWN=25. A causa do aborto/queda do PostgreSQL permanece desconhecida;
a recuperação por WAL está registrada. Zero efeitos operacionais observados.

O Gate 4.0B.5 acrescenta persistência append/fsync da witness, usage, observações
e checkpoints SOMENTE ao harness de avaliação. Novo preflight contextual passou
com 69 AuditLogs históricos exatos, 26 fixtures preservadas e isolamento/RLS
verificados. PHASE_A_RESUME_FROM_I12 contém 15 casos/17 turnos: uma futura
revalidação explicitamente autorizada de i12 e os 14 casos ainda não iniciados.
Não foi executado. Paid calls e Router JEV continuam false, gpt-6-luna continua
oficial. Nenhuma alteração de produto, inferência, deploy ou correção funcional.
Detalhes, hashes, limites e rollback: SECRETARIA_GATE_4_0B_5_DURABLE_RESUME.md.


## 2026-09-24 — Gate 4.0B.3.2: continuação segura da Phase A preparada

`i01` foi revalidado e aprovado funcionalmente em uma única inferência GPT-6
Luna; seu resultado e os sete AuditLogs técnicos permanecem intactos. O novo
modo **evaluation-only** `--preflight-continuation` validou a baseline histórica
exata, as 26 fixtures, 25 casos restantes/27 turnos, a role runtime, RLS/FORCE
RLS e isolamento por tenant em `127.0.0.1:55441`. `--continue-after-i01` está
limitado aos casos i02–i26 congelados, exclui i01 e exige autorização explícita
em variável somente do processo; **não foi executado** neste Gate. Paid calls e
Router JEV continuam false. O estado UNKNOWN de i01 descrito nas seções
históricas abaixo corresponde à primeira tentativa, anterior à revalidação.
Detalhes, hashes, testes e rollback em
`SECRETARIA_GATE_4_0B_3_2_CONTINUATION.md`.

## 2026-09-24 — Gate 4.0B.3.1A: banco descartável limpo restaurado

Autorização explícita permitiu iniciar um novo PostgreSQL local em `55442`,
restaurar exclusivamente o dump pré-bateria SHA-256 `28c02b25…b6f6093` e
validar schema, role runtime, grants, RLS/FORCE RLS, isolamento e o preflight
26/26 casos e 28/28 turnos. O cluster anterior, com três AuditLogs da tentativa
`i01`, foi preservado e desligado. O cluster limpo agora escuta somente em
`127.0.0.1:55441`; o preflight **original** passou novamente após a troca,
com `AuditLog=0`, `NotificationOutbox=0`, Router=false e paid calls=false.
Detalhes e rollback: `SECRETARIA_GATE_4_0B_3_1A_RESTORE_I01.md`. Nenhuma
inferência OpenAI/JEV, revalidação i01, Phase A ou deploy ocorreu neste Gate.

## 2026-09-24 — Gate 4.0B.3.1: diagnóstico OpenAI preparado, sem nova inferência

A execução Phase A autorizada parou em `i01` após uma tentativa Responses,
sem resposta, request/response ID ou usage. O resultado funcional de `i01` é
UNKNOWN; nenhum dos outros 25 casos foi executado. O journal mostrou zero
efeitos operacionais e três auditorias técnicas. O preflight atual bloqueia a
reexecução por `PHASE_A_STALE_TECHNICAL_JOURNAL`; o banco foi preservado.
Foi acrescentada observabilidade sanitizada **somente no harness de avaliação**,
antes do wrapper `MODEL_REQUEST_FAILED`, e uma entrada separada de uma única
request `--revalidate-i01`, ainda desautorizada e não executada. O relatório
histórico, o manifest, o produto e as fixtures permanecem inalterados. Detalhes,
categorias, testes, pré-requisito de restauração local e rollback em
`SECRETARIA_GATE_4_0B_3_1_PROVIDER_DIAGNOSTIC.md`. Zero OpenAI/JEV neste Gate;
Router e paid calls continuam false. Naquele Gate, a revisão automática havia
rejeitado iniciar um novo cluster local em `55442`; a autorização explícita
posterior e a restauração concluída estão registradas acima.

## 2026-09-24 — Gate 4.0B.2.1: PostgreSQL descartável Phase A restaurado

O cluster anterior de teste permaneceu intocado como evidência: faltam diretórios
internos obrigatórios, inclusive `pg_notify`, e ele não inicia. Um PostgreSQL
16.15 novo, nativo e limitado a `127.0.0.1:55441`, foi criado em diretório
temporário exclusivo. O schema foi restaurado **sem dados** do backup sintético
documentado no Gate 3.1B V2; a comparação read-only com `prisma/schema.prisma`
deu zero diferenças. A role `mvp_service_runtime` não tem SUPERUSER/BYPASSRLS;
as 19 tabelas exigidas pela Phase A têm RLS/FORCE RLS. Consultas reais pela role
runtime comprovaram isolamento entre dois tenants e ausência de visibilidade
sem contexto.

`--prepare` criou 26 tenants sintéticos, e a segunda execução criou zero
duplicatas. `--preflight` aprovou 26/26 casos e 28/28 turnos. Um dump do banco
preparado, com SHA-256 verificado, está em `packages/salon-secretary/evaluation/results/`
(ignorado pelo Git). Router e paid calls continuam false; não houve inferência
OpenAI/JEV nem execução da Phase A. A autorização para Gate 4.0B.3 continua
separada. Procedimento, hashes, limites e rollback:
`SECRETARIA_GATE_4_0B_2_1_DISPOSABLE_DB.md`.

## 2026-09-24 — Gate 4.0B.2: harness Phase A offline; banco descartável bloqueia execução

Adapter dos 26 cenários/28 turnos congelados, journal sintético por tenant,
contadores independentes e witness da request Responses serializada implementados
somente na camada de avaliação. O runtime, expected, manifest, Router, Skills,
fast-path e cost guard não foram alterados. A witness bloqueia antes da rede
qualquer wire fora da allowlist; o runner não expõe confirmação. O SHA Phase A
permanece `11f3ea7f8e04d5ccca7723b9f3575bde3a275e332f744453f63568b4b2dabbaa`.
O cluster descartável anterior está incompleto (`pg_notify` ausente) e não inicia;
`--preflight` falhou fechado com `PHASE_A_LOCAL_DATABASE_UNAVAILABLE`. Nenhuma
fixture foi gravada; nenhuma chamada Luna/JEV foi feita. Estado atual da Phase A:
`BLOCKED_BEFORE_INFERENCE` até restaurar o banco local e validar fixtures/RLS.
Dry-run 26/28, 2.241 testes, lint, TypeScript e build offline passaram;
testes PostgreSQL live não puderam ocorrer.
Detalhes, orçamento e rollback em `SECRETARIA_GATE_4_0B_2_EXECUTION_HARNESS.md`.

## 2026-09-24 — Gate 4.0B.1: ponte de observação offline e Phase A congelada

Ponte evaluation-only ligada à API pública `SalonSecretary.start/send`, com
capturas tipadas por turno, eventos baseados em snapshots e métricas de segurança
trivalentes (`PASS`/`FAIL`/`UNKNOWN`). Modelo/backend mockados exercitaram o
runtime sem alterar Registry/Skills/Tools ou confirmar propostas. O manifest
original permanece intacto; Phase A congela só 26 READY / 28 turnos, SHA
`11f3ea7f8e04d5ccca7723b9f3575bde3a275e332f744453f63568b4b2dabbaa`.
Tarifa GPT-6 Luna Standard confirmada em fonte oficial; reserva máxima
US$0,2408. `t07` com ponto em `45 minutos.` não aciona o fast-path atual:
divergência segura registrada, sem correção neste Gate. Nenhuma bateria real,
OpenAI, JEV, banco, confirmação, deploy ou alteração produtiva. Router/paid OFF.
Detalhes e limites em `SECRETARIA_GATE_4_0B_1_OBSERVATION_BRIDGE.md`.

## 2026-09-23 — Gate 4.0B: runner preflight offline (sem bateria real)

Manifest 4.0A preservado: SHA-256
`b8c4c39b9ea338dbd2cbe80b9fe9f2efeb940391109da034b11bb480cbb0076e`.
Dry-run estrutural: 60/60 casos, 77/77 turnos, 16 variantes em memória,
118 hashes protegidos. Classificação analítica: 26 READY, 3 limites conhecidos,
31 DESIGN_TARGET, zero fixture inválida. Isso não representa aprovação funcional
de Luna. Sondas com coordenadores reais/mocks confirmam a auto-resolução atual
de aproximação e a rejeição de EXACT sem aspas; nenhum contrato foi corrigido.
Runner aceita somente modo offline; adaptação completa runtime/observações e
tarifa vigente continuam pré-requisitos da entrada paga. Sem banco, rede IA,
deploy ou alteração de runtime; Router e paid permanecem false.
Relatório: `SECRETARIA_GATE_4_0B_RUNNER_PREFLIGHT.md` e
`SECRETARIA_GATE_4_0B_RUNNER_VALIDATION.md`.

## 2026-09-23 — Tópico 14, Gate 4.0A: desenho conversacional offline

O responsável confirmou a validação controlada do Router V1 e autorizou o
Gate 4.0A. O registro anterior de Router pendente abaixo é histórico. Router
continua false por padrão, GPT-6 Luna oficial e paid calls false; nenhum deploy.
Este incremento prepara contrato de resolução/clarification/correção/dependência
e primitivas puras somente em evaluation, sem integração ou mudança de runtime.
Dataset congelado: 60 cenários / 77 turnos sintéticos. Cinco ações, confirmação
de aproximação e troca geral de intenção são DESIGN_TARGETs, não capacidades
produtivas já implementadas. Escopo, matriz de operações e limitações em
`SECRETARIA_GATE_4_0A_CONVERSATIONAL_RESOLUTION.md`; proposta não executada do
Gate 4.0B em `SECRETARIA_GATE_4_0B_PLAN.md`. Zero IA real, banco ou Meta neste Gate.

## 2026-09-23 — Router V1 da Secretária em preparação local, desligado

Gate 3.1C-C prepara fast-path → duas entradas JEV PROVEN → Policy → fallback
GPT-6 Luna. `SALON_SECRETARY_JEV_ROUTER_ENABLED=false` e paid calls false.
Sem deploy, inferência real, banco ou alterações remotas neste Gate; Production
abaixo permanece inalterada. Escopo, restrições, telemetria e ensaio mínimo
pendente de autorização em `SECRETARIA_ROUTER_V1.md`. Nenhuma expansão
Financial/Inventory, threshold, Wallet ou Cross-Skill novo foi promovido.

## 2026-09-20 — aviso transitório no login do cliente corrigido em revisão

## 2026-10-04 — redução automática dos contratos acima da tabela

PR #136 publicado (`db298d2`). Branch `claude/reducao-preco-antigo`: o worker de
cobrança agenda, para cada assinatura atual cujo valor está acima da tabela para
a mesma capacidade e ciclo, uma troca `SCHEDULED` criada pela plataforma
(`actorUserId = system:price-reduction`), com o mesmo caminho já validado das
reduções (PUT confirmado por GET, fatura do vencimento reconhecida pelo valor
novo, inclusive até três dias antes). Mensais logo; anuais no último mês. O
painel mostra "Seu plano ficou mais barato" e permite desfazer para trocar de
plano; o atalho do topo continua "Ativo". Sem migration nem mudança de catálogo.
## 2026-10-04 — calendário da visita com vários serviços

Branch `codex/calendario-visita-varios-servicos`, etapa B do calendário do
cliente (a etapa A, um serviço, foi publicada no PR #138).

- **Calendário no lugar do campo de data.** A tela de vários serviços na mesma
  reserva (`agendar/visit-booking.tsx`) usa o mesmo calendário da tela de um
  serviço, agora no componente `agendar/booking-calendar.tsx`.
- **Abre no primeiro dia em que a visita inteira cabe.** A busca para no
  primeiro dia encontrado (até 21 dias com atendimento, orçamento limitado).
  Uma data escolhida pelo cliente ou restaurada é mantida se tiver atendimento.
- **Dias sem atendimento desativados.** Um dia fica aberto se cada serviço tem
  ao menos um profissional elegível com expediente ainda por vir, fora de
  fechamento e folga. Dias com expediente mas lotados continuam clicáveis e
  mostram a mensagem de antes. Sem fila de espera nessa tela, como antes.
- **"Consultar o próximo dia com atendimento"** pula direto para o próximo dia
  aberto.
- **Nova rota `POST /api/visits/availability/days`** (`{ salonId, choices }` →
  `openDays`, `firstFreeDay`). `loadVisitCalendar` em
  `src/lib/visit-scheduling.ts` carrega o período com uma consulta por tabela;
  `loadVisitDay` passou a usar o mesmo carregador, com o mesmo resultado.
  Salão aprovado, limite por IP (15/min, falha fechada), sem cache, não expõe
  reservas.
- Falha na consulta dos dias mantém o calendário todo clicável.

Sem migration, schema, RLS ou mudança na validação da reserva.

## 2026-10-03 — novo preço em produção e coerência da cobrança em validação

PR #133 publicado (`772d2c1`, `/api/health` confirmou a versão): catálogo
2026-10-02 com Individual R$ 39,90/mês e R$ 399/ano e agenda adicional R$ 20/mês
e R$ 192/ano. Contratos anteriores seguem com o preço persistido.

Validação com 11 agentes (auditoria, verificação adversarial e lacunas) confirmou
valores enviados ao Mercado Pago, cálculo das trocas e renovações antigas, e
apontou telas incoerentes. Branch `claude/coerencia-cobranca` corrige: valor
contratado no card do plano atual; contratação antiga não paga atualizada para
o preço novo; próxima cobrança com troca agendada; plano preservado no cadastro
com confirmação de e-mail; links `?plan=` antigos; descrição com a capacidade
total no Mercado Pago; ajuda para trocar o cartão em atraso; checkout pausado na
landing; Termos de Uso (seção 7, pendente de aprovação do responsável); margem
de três dias para renovação debitada antes do vencimento. Sem migration.

## 2026-10-03 — calendário do cliente: primeiro dia com vaga

Branch `codex/calendario-primeiro-dia-livre`. Ao escolher serviço e
profissional em `/book/[salonSlug]/agendar`, o calendário vai para o primeiro
dia com horário livre (inclusive em outro mês).

- **Dias desativados.** Folga semanal, fechamento, folga do profissional e dia
  sem nenhum horário possível ficam apagados, como os dias passados.
- **Dia lotado com fila.** Continua clicável, com ponto âmbar e legenda; mostra
  "Dia lotado. Entre na fila de um horário ocupado abaixo ou escolha outro dia."
- **Nova rota `GET /api/availability/days`.** Devolve `freeDays` e
  `waitlistDays` de hoje até o fim da janela pública (máx. 60 dias), com a mesma
  regra dos horários (`loadBookableDays` em `src/lib/day-slots.ts`, uma consulta
  por tabela para o período). Mesmas proteções da rota de horários: salão
  aprovado, limite por IP (30/min) e remarcação só da própria reserva. Não
  expõe reservas.
- **Fila só de horário futuro.** `/api/availability` deixa de listar como
  "ocupado" um atendimento de hoje que já começou (entrar na fila dele já era
  recusado).
- Falha na consulta dos dias mantém o calendário como antes. A tela de vários
  serviços (`visit-booking.tsx`) não mudou.

Sem migration, schema, RLS ou mudança na validação da reserva.

## 2026-10-03 — fila de espera: agendar em outro horário

Branch `claude/customer-difficulty-improvements-014032`, a partir do áudio do
dono de 30/09. Ele tinha uma pessoa na fila do horário das 08:30 e um encaixe
livre às 16h. Sem ação para isso, precisou remover da fila e recadastrar o
agendamento na mão.

- **Agendar em outro horário.** No detalhe do agendamento, cada pessoa da fila
  ganha essa ação (dono/gerente), além de WhatsApp e telefone clicável. A ação
  abre o "Novo agendamento" já com cliente (ou convidado), profissional e
  serviços, direto na escolha de data e hora.
- **Horários livres sugeridos.** A escolha de data e hora mostra os horários
  livres do profissional no dia, com ★ nos melhores encaixes. Isso vale também
  no agendamento manual comum. O cálculo foi extraído da rota pública para
  `src/lib/day-slots.ts`; para a equipe, roda sem a antecedência pública.
- **Saída da fila na mesma transação.** Ao confirmar, a pessoa sai da fila na
  mesma transação da nova reserva (`fulfillWaitlistEntryElsewhere`, auditada
  como `WAITLIST_SCHEDULED_ELSEWHERE`).
- **Cancelar e passar o horário.** O cancelamento ganha a opção "Passar este
  horário para <nome> (#1 da fila)": cancela e promove numa única transação. Se
  a vaga não servir, nada é cancelado.
- **Painel de cuidados.** O "Cuidados e fotos desta visita" fechado ficou sem o
  vão vazio.

Sem migration (usa `fulfilledAt`/`fulfilledAppointmentId` existentes).

## 2026-09-27 — tela de início do cliente reorganizada para celular

Branch `codex/inicio-cliente-mobile`: a home `/book/[salonSlug]` segue a proposta
aprovada pelo responsável (A + C) após protótipos no iPhone 15 (393 × 852).
Topo com marca e atalhos à direita: visitante vê a sacola e "Já é cliente?
Entrar · Criar conta" numa linha; cliente com conta vê sino, iniciais e
"Seu último atendimento · Repetir" (reaproveita a consulta de "Meu atendimento de
sempre"). Nota, horário e "Ver endereço" logo abaixo do nome. A capa aparece
inteira (3:2) com "Agendar um horário" embaixo, sem nada sobre a foto; o nome
deixa de ser sobreposto à capa, então a opção de ocultá-lo não altera mais a home.
Equipe em faixa de retratos (somente exibição). Abas fixas Serviços · Avaliações ·
Portfólio · Sobre; serviços agrupados por categoria em `<details>`, sem fotos
(decisão de 07/09). O convite de instalação saiu da home e passou para
Notificações (continua no welcome); o convite de lembretes na home ficou em uma
linha. Vitrine de produtos saiu da home (Loja na barra inferior). Fluxo de
agendamento, barra inferior e seletor de tema inalterados. Sem migration.

## 2026-09-27 — plano e assinatura: revisão de UX em preparação

Branch `claude/plan-subscription-ui-fix-a842b9`: atalho do topo passa a mostrar
plano e situação reais (inclusive contratação pendente, atraso e renovação
cancelada); `/assinatura` reorganizada em Seu plano, Mudar de plano (catálogo
único com Plano atual, upgrade/redução e mensal/anual), histórico e renovação.
Upgrade confirmado segue direto ao checkout validado. Catálogo, preços, regras
de proporcionalidade, RLS e schema preservados; sem migration, flag ou
publicação. Detalhes em `docs/PLANO_ASSINATURA_UX_2026-09-27.md`.

Complemento aprovado no mesmo dia (`DECISOES_PRODUTO.md`): webhooks, ações do
proprietário, retorno do checkout e "Atualizar situação" processam na hora a
assinatura afetada (nova rota `/api/billing/sync`); reativação da renovação
cancelada (`/api/billing/reactivate`) reutiliza a substituição de ciclo já
existente, sem migration; oferta de plano menor antes de cancelar. Integração
PostgreSQL local com 023/024/025 e role sem BYPASSRLS: 66 testes aprovados.
`pg_cron` não foi aplicado (exige SQL em Production e autorização).

## 2026-09-27 — guia de início reformulado (Marfim & Lilás)

Branch `codex/configuracao-guiada`: `/onboarding/configuracao` deixa de ser um
formulário por etapa e passa a guiar uma decisão por vez — boas-vindas no primeiro
acesso, dias por toque, formato do horário (direto, com almoço ou dia a dia),
revisão de serviços um por vez com prévia do que o cliente vê, "Eu mesmo atendo"
já sugerindo serviços e horários, e prévia do app com link, WhatsApp e checklist.
Paleta aprovada pelo responsável: base neutra, ação marfim (grafite no tema claro),
lilás só em ícones/seleção/progresso e verde apenas para concluído; ícones com
animação leve que respeita "reduzir movimento". Mesmas server actions, validações,
papéis e persistência de progresso; sem migration. Proposta visual em
`https://claude.ai/artifact/N6eYXUfPiu5aZc2AfTyKn2`. Conferido em banco local
descartável (Docker), 375 px e 1280 px, temas claro e escuro, sem erros de console.

## 2026-09-27 — nome opcional sobre a capa e conta cortesia provisionada

Branch `codex/capa-nome-opcional`: em Configurações → Aparência, quem usa capa
própria pode desmarcar "Mostrar o nome do estabelecimento sobre a capa" quando a
imagem já traz o nome. O título permanece para leitores de tela; selo e degradê
somem e a capa passa a 16:9. Sem capa própria o nome sempre aparece (o servidor
força `true`). Migration manual aditiva `028_cover_show_name` (coluna booleana
`NOT NULL DEFAULT true`, sem reescrita de tabela), com preflight/verify/rollback
não destrutivo e validação no CI. Autorizada pelo responsável e **aplicada em
Production** (`vshnatkzxdekkvqttvbv`) em 27/09, antes do deploy desta branch:
preflight somente leitura, coluna criada sem reescrita, 12 salões com `true`,
RLS ENABLE/FORCE preservado e `app_runtime` com SELECT/UPDATE na coluna.
Não reaplicar. O código anterior ignora a coluna, então o deploy pode ser revertido.

A pedido do responsável, foi provisionada em Production, por SQL aditivo em uma
transação com preflight, a conta cortesia `bianca-reflexologia`: OWNER único,
plano PRO/APPROVED sem `BillingSubscription` (sem cobrança), jornada de terça e
evento `SalonAccessEvent` registrando a cortesia. Contagens conferidas antes e
depois (+1 usuário, salão, membership, profissional e jornada; reservas intactas).
Credenciais não são documentadas. Rollback: suspender somente esse salão.

## 2026-09-24 — lembretes no celular e valor final por serviço em preparação

Branch local `codex/service-reminder-push`: candidata para aviso de véspera e
do dia, push consentido no PWA do cliente e e-mail opcional pelo Resend já
existente. A home mostra a ativação também a contas antigas com app instalado,
enquanto o aparelho ainda não estiver vinculado; a permissão só é pedida após
o toque do cliente. A comanda desta candidata registra valor final e motivo por serviço
"A partir de" no fechamento, preserva o valor inicial e reflete o final no
pagamento e na receita. As migrations manuais 026/027 estão apenas versionadas.
Nenhum SQL, chave, flag ou deploy desta candidata foi aplicado em Production.
O fluxo de apresentação "A partir de" já existe na versão atual e a migration
021 foi aplicada em 11/09; não reaplicar. Escopo, limitações e rollout em
`docs/LEMBRETES_CLIENTE_PUSH_2026-09-24.md`.

## 2026-09-20 — publicação de billing e limpeza do HQ autorizada

Auditoria somente leitura identificou Production em `13cb2a333a66`, billing live
com checkout e trocas habilitados; `BillingPlanChange` existe no banco. Isso
substitui as pendências históricas abaixo sobre a disponibilidade das trocas,
sem afirmar execução de migration nesta tarefa. Nenhuma compra foi realizada.

Branch `codex/billing-selection-tenant-removal`: seleção de plano durante tentativa
pendente, orientação do checkout e exclusão restrita a cadastros vazios, com opção
reversível de histórico no HQ. Backend de proporcionalidade preservado. Nenhum
estabelecimento real foi excluído/arquivado; sem migration ou publicação.
Escopo e validação em `ASSINATURAS_E_LIMPEZA_HQ_2026-09-20.md`.
O responsável autorizou publicar o PR #117. Promoção aguarda a validação da
revisão integrada à versão atual; não inclui excluir ou arquivar cadastros reais.

## 2026-09-20 — aviso transitório no login do cliente corrigido

PR #116 incorpora uma correção de apresentação: o catch do formulário tratava
`NEXT_REDIRECT` como falha de conexão depois de autenticar com sucesso, exibindo
um alerta vermelho antes da navegação. `unstable_rethrow` devolve esse controle
ao Next.js; credenciais inválidas e falhas reais continuam com feedback.
Reproduzido em PostgreSQL descartável com captura das inserções transitórias
no DOM; após a correção, jornadas 390px/1440px passaram sem o falso alerta.
O mesmo observador cobre os logins com senha recuperada no CI Supabase.
Sem mudança de senha, sessão, regras de autorização, dados ou schema. PR #116
integrado em `9b92138ec766`; health produtivo confirmou essa versão com banco
saudável antes da promoção do PR #117.

## 2026-09-20 — recuperação Supabase publicada com transição voluntária

PR #115 integrado em `f4d4ebbbac65ecd2f4d23cf89304a196658d646e`.
Production `dpl_J6DY6d7jgtzUmMDjgig8zwxLdu5P` READY em `everflair.com.br`:
health HTTP 200, versão `f4d4ebbbac65` e banco saudável. Home, login e rotas de
recuperação/redefinição dos dois aplicativos responderam HTTP 200. Consulta de
runtime após a solicitação real sem erros/warnings. CI `35534983210` e jornadas
Supabase Auth/SMTP isoladas `35534983208` aprovados antes da publicação.

Supabase Auth com SMTP Resend está ativo para novas contas e recuperação.
**Contas antigas continuam usando as senhas atuais.** Somente salvar uma nova
senha pelo link oficial vincula os acessos daquele e-mail ao Supabase. Pedir ou
ignorar o e-mail não muda senha, sessão, reservas ou permissões. Não há migração
em massa. RLS/FORCE RLS e `app_runtime` sem BYPASSRLS permanecem preservados.

Domínio Resend verificado, SMTP/templates/redirects configurados e variáveis
salvas somente em Vercel Production. Migration aditiva já aplicada, histórico
Supabase `20260920204453_supabase_auth_identity`: **não reaplicar**. Backup
delimitado criptografado verificado e comparação integral dos registros na
transação de implantação. Permanecem 31 usuários, 195 perfis, 30 memberships e
2.321 reservas. A recuperação solicitada para o responsável criou uma identidade
sem senha; zero perfis foram migrados e as credenciais antigas continuam intactas.

Entrega real confirmada como Delivered pelo Resend às 17:53 BRT, e-mail
`01a0c098-79f4-7489-b532-3caf44c5e28d`, remetente `acesso@auth.everflair.com.br`,
botão retornando a `/redefinir-senha`. Nenhum token ou secret foi versionado.
Fluxos completos e falhas foram testados em ambiente isolado; em produção houve
somente conferência de leitura e a solicitação real autorizada pelo responsável,
sem alterar sua senha. Evidências e rollback em `FASE_SUPABASE_AUTH_RECOVERY.md`.

## 2026-09-20 — recebimentos de vários dias em revisão

Branch `codex/recebimentos-multiplos-dias`: Financeiro permite selecionar até
31 dias e conferir até 100 atendimentos por baixa, com exclusão individual e
forma de pagamento independente por atendimento. Reutiliza as consultas e a
baixa existentes, sem API, schema, regras ou dados alterados. O quarto
atendimento desmarcado permanece pendente ao receber três; selecionar dias
não grava pagamentos. Lint, TypeScript, 1.132 testes e build aprovados; fluxo
sintético conferido no navegador, inclusive 320 px, sem erros de console.
Não publicado em Production. Detalhes em `RECEBIMENTOS_E_AGENDAMENTO_2026-09-13.md`.

## 2026-09-20 — Supabase Auth/recovery em validação isolada

Branch `codex/supabase-password-recovery`: candidata para os dois aplicativos,
com uma identidade por e-mail autorizada pelo responsável. Produção mantém
NextAuth Credentials/bcrypt e sessões atuais; nenhum import/deploy/ativação
produtiva foi realizado. Subdomínio `auth.everflair.com.br` cadastrado no Resend,
com DNS verificado (status Verified), sem alterar o site. O responsável aprovou
publicação com transição voluntária: cada acesso mantém sua senha e sessão
antigas até concluir a recuperação. Depois, a nova senha vale para os acessos
daquele e-mail; IDs, reservas, histórico e permissões são preservados. Não há
importação ou confirmação obrigatória em massa. Configuração e critérios de
ativação em `FASE_SUPABASE_AUTH_RECOVERY.md`; implantação ainda pendente.
Retornos e política de senha foram preparados no Supabase; origens/chave pública
salvas somente em Vercel Production para o próximo deployment. Backup delimitado
de usuários/clientes criptografado e verificado. SMTP e templates salvos.
Migration aditiva aplicada às 20:44 UTC, histórico Supabase `20260920204453`;
comparação integral confirmou registros/hashes preservados. Zero identidades
vinculadas; 31 usuários, 195 perfis, 30 memberships e 2.321 reservas mantidos.
Flags Supabase salvas para o próximo deployment, sem mudar o runtime atual.

## 2026-09-20 — painel publicado; atalho mensal mobile em revisão

PRs #111 e #112 integrados em `cb111ad9b87e773c2dec34834ccfb24e6023aafc`.
Production `dpl_CmJ9HYUtnJgyrgawXPhE58nPM9BB` READY em `everflair.com.br`:
home/login HTTP 200, Agenda sem sessão direcionada ao login e health com banco
saudável e versão `cb111ad9b87e`. Sem migrations ou testes de escrita produtivos.

A correção posterior em `codex/agenda-month-mobile` restaura o botão Mês junto
de Dia/Semana/Lista no celular, reutilizando a visualização mensal existente.
Esse ajuste ainda não está publicado; não modifica grade, regras ou backend.
O mesmo PR #113 torna “Adicionar outro profissional” acessível no início da
etapa Serviços, mesmo sem serviço selecionado, preservando o fluxo de visita,
o contexto e a revisão obrigatória. Testes cobrem especialidades diferentes
e a preservação de uma seleção anterior; nenhuma API ou regra foi alterada.


## 2026-09-20 — correções confirmadas de UX, candidata não implantada

Branch `codex/ux-confirmed-fixes`, incremental sobre a candidata do PR #111:
confirmação de Pacotes, proteção de rascunhos, formulários diretos, estados de
histórico, contexto de navegação e hierarquia operacional. Backend e regras
preservados. Escopo, evidências e limites em
`CORRECOES_UX_CONFIRMADAS_2026-09-20.md`. Não altera o estado de Production.

## 2026-09-20 — revisão visual do PR #111, ainda não implantada

Após comparação com a referência, a candidata reduz filtros e cabeçalhos,
reorganiza Financeiro/Relatórios e perfis de cliente/profissional. Fotos de
profissionais usam o cadastro existente; não há fotos fictícias nem alteração
de backend. Evidências e limites em `REFORMULACAO_UX_PAINEL_2026-09.md`.
Esta revisão não foi promovida a Production.

## 2026-09-19 — reformulação do painel em desenvolvimento

O responsável ampliou o pedido da Agenda para todas as abas do painel de
estabelecimento mostradas na referência. PR #111 preserva backend, APIs,
permissões e dados; não foi integrado nem publicado. Escopo e evidências em
`REFORMULACAO_UX_PAINEL_2026-09.md`. O estado implantado continua sendo o
registrado abaixo; esta seção não afirma mudança produtiva.

## 2026-09-14 — experiência mobile: publicação autorizada

Branch `codex/mobile-guided-experience`, baseada em `a78a0b2`: catálogo inicial
compacto e pesquisável com edição individual, seleção de serviços/profissionais
em painéis inferiores, visita em três etapas com horários explícitos e mensagens
do motor de disponibilidade identificando item e motivo. Tutorial mobile opcional,
com animação, sombra, preferência por usuário/salão e replay; não anuncia arraste
de reservas no toque, que ainda não existe. Escopo em `MOBILE_GUIADO_2026-09-14.md`.
Complemento solicitado: nome visível de `PRO` padronizado como “Essencial” e
atalho de planos no topo mobile para o proprietário, nos dois temas. Apenas
apresentação: enum, preços, limites, assinatura, cobrança e dados preservados.
O responsável autorizou finalizar e publicar o PR #110 em produção. Validação
local/sintética: lint, TypeScript, 1.106 testes, build e jornadas Chromium/WebKit
aprovados. Promoção condicionada ao CI e Preview da revisão final. Sem migration
nova, alteração de flags, cobrança ou escrita manual de dados produtivos.
Commit implantado, deployment e conferência somente leitura serão registrados
no PR: https://github.com/alisonbielwhats1-beep/barber-saas/pull/110.

## 2026-09-14 — PR #108 publicado após CI

O PR #108 foi integrado em `a78a0b2f36ec4a5863ceb43c21fa67b1e2e853b7`,
preservando o PR #109. CI `34801262205` aprovado. Production
`dpl_HSg1kevPyCeDpV6Er1fhVKHRHLTC` READY, GitHub deployment `6430003288`
confirmado às 03:39:11 UTC. Home, login, health, configurações, equipe e portal
de assinatura foram conferidos sem escrita; consulta de runtime sem erros.
Registro final: https://github.com/alisonbielwhats1-beep/barber-saas/pull/108#issuecomment-5658675856.
Isso conclui a preparação histórica abaixo. A migration de convites já foi
aplicada; não reaplicar. Convites por e-mail continuam desativados.

## 2026-09-14 — PR #109 publicado; promoção do PR #108 autorizada

O PR #109 foi integrado em `225c9c9` e seu deployment Production foi confirmado
com sucesso às 02:18:57 UTC (GitHub deployment `6429253723`). A seção de validação
abaixo é histórica. O PR #108 incorpora essa versão e preserva suas jornadas.

O responsável autorizou explicitamente o deploy do PR #108. A preparação
produtiva confirmou o projeto Supabase `vshnatkzxdekkvqttvbv`, realizou backup
lógico criptografado de `UserInvite`, validou sua decifragem em memória e aplicou
somente `20260913110000_professional_invite_profile_fields`: duas colunas `text`
anuláveis, sem backfill ou remoção. Os dados anteriores foram comparados dentro
da transação; RLS/FORCE RLS e a role `app_runtime` permanecem protegidos.

A preparação foi concluída pela publicação registrada acima. Evidências e rollback
em `FASE_NAVEGACAO_EQUIPE_DESKTOP.md` e no comentário final do PR #108.
Nenhuma compra ou teste de escrita em produção.

## 2026-09-13 — visitas com vários profissionais em validação

Branch `codex/multi-professional-visits`, base `ae4f1ff`: cliente e equipe montam
uma visita com serviços/profissionais diferentes e confirmação transacional única.
Profissionais podem criar/editar atendimentos próprios em folgas, intervalos e fora
do expediente, com motivo. A edição já ocupa o novo horário e libera o anterior;
o cliente aceita ou recusa depois. Recusa sinaliza a reserva e avisa a equipe,
sem restaurar automaticamente a origem. Grade
passa a exibir bloqueios após o fechamento e oferece visualização do dia inteiro.
Simultaneidade pública depende de combinações habilitadas pela gestão.
Sem migration ou alteração produtiva. Escopo, persistência, limites e evidências
em `VISITAS_MULTIPROFISSIONAIS_2026-09-13.md`.
PR #109 em revisão. Validação local: 1.084 testes, 47 integrações PostgreSQL,
lint, TypeScript, build e jornada responsiva de cliente/dono/profissional aprovados.
O profissional também cria, edita e reabre as próprias folgas/bloqueios;
reservas existentes permanecem. CI e Preview precisam concluir antes da promoção.

O PR #105 já integra `origin/master` em `ae4f1ff`; as seções abaixo registram a
situação anterior à integração. Esta entrega não verifica nem modifica a implantação
produtiva das trocas de planos.

## 2026-09-13 — revisão do cancelamento incorporada ao PR #105

Solicitação posterior valida cancelamento livre, fim da recorrência no provedor
e preservação integral do período pago. A indicação de renovação agora considera
também assinaturas futuras vinculadas; o pedido encerra a cadeia mesmo quando a
recorrência antiga já foi cancelada ou a troca está em revisão. O botão permanece
acessível ao OWNER no painel e na tela de acesso bloqueado, sem liberar operação
suspensa. Confirmação mostra o prazo exato e não promete conclusão antecipada.

A revisão `c967d03` passou integralmente no CI `34777515646` e Preview,
incluindo cancelamento e oito capturas inspecionadas. A integração do guia
de início de `origin/master` exige rodada correspondente; evidências no PR e em
`MERCADOPAGO_TROCA_PLANOS.md`. Nenhuma publicação, flag ou SQL produtivo novo.

## 2026-09-13 — trocas de planos em validação, ainda não publicadas

O responsável aprovou upgrades no mesmo ciclo após pagamento da diferença
proporcional, mantendo vencimento; reduções e mudanças mensal/anual ficam
para a próxima renovação. A branch `codex/mercadopago-plan-changes` implementa
cotação pelo servidor, revisão de termos, cobrança complementar, limite de
agendas e reconciliação. Migration 025 somente em PostgreSQL sintético local;
nenhuma alteração produtiva desta entrega. Flags novas permanecem desativadas
em Production. Escopo, evidências e pendências em `MERCADOPAGO_TROCA_PLANOS.md`.
PR #105 em revisão. Compra fictícia do Individual, diferença para Equipe 5 e
autorização anual futura passaram no Mercado Pago, com acesso/valor/vencimento
conferidos. Recorrências fictícias canceladas ao fim da homologação.
Cadastro novo já cria estabelecimento aprovado automaticamente; o pagamento
libera o plano pago sem aprovação manual. Suspensão administrativa permanece.

## 2026-09-13 — guia de configuração inicial incorporado à branch principal

Branch `codex/initial-setup`, base `f89652b`: primeira entrada guiada em quatro
etapas, com horários, serviços, profissionais e explicação do aplicativo/link
do cliente. Responsivo, adiável e retomável por estabelecimento; conclusão
independe da primeira reserva. Jornadas existentes e contratação preservadas.
Escopo e evidências em `CONFIGURACAO_INICIAL_2026-09-13.md`. Sem migration.
PR #106 integrado em `678cecb`; implantação produtiva desse guia não conferida
nesta revisão de billing. Esta tela substitui o checklist como primeira recepção;
o dashboard mantém um atalho para retomar o guia.

## 2026-09-13 — Mercado Pago disponível em produção

O responsável autorizou concluir as etapas para disponibilizar cobrança em
produção. Preflight produtivo e backup delimitado criptografado concluídos;
checkout e banco próprios de homologação preparados no Codespace existente.
As migrations `mercadopago_billing_023` (`20260913155322`) e `billing_hq_024`
(`20260913155342`) foram aplicadas e verificadas no projeto produtivo
`vshnatkzxdekkvqttvbv`, preservando os dados anteriores e FORCE RLS.
O reconciliador tem chave exclusiva na Vercel Production e no GitHub,
com recuperação criptografada; o agendamento foi ativado e sua execução passou.
Staging `6122e6e`: build, schema e 27 integrações passaram em banco sintético.
PR #101 integrado em `f89652b`; CI `34767093377` passou integralmente.
Deployment final `dpl_361VijpX2UCrkfaP63FYsNEMgzny`, READY e associado a
`https://everflair.com.br`. Billing/HQ em modo live, checkout liberado.
O titular validou a conta e ativou credenciais da aplicação `5276100300886`;
API confirmou vendedor brasileiro real `478386806`. Webhook definitivo salvo.
Home, catálogo anual, cadastro com escolha preservada e worker autenticado
foram conferidos. Consulta de logs do deployment não retornou erros.
Não foi realizada compra real; a homologação financeira usou contas fictícias.
Destinos, evidências e limites em `RELEASE_MERCADOPAGO_2026-09-13.md`.

## 2026-09-13 — integração das entregas em revisão

O PR #101 incorpora o PR #103 (`afe5f9b`) e preserva as jornadas de recebimentos
e agendamento junto aos planos e à cobrança Mercado Pago. Os dois conjuntos
usaram o prefixo manual 023 em branches independentes: `023_receipts_booking`
foi aplicado em produção pelo PR #103; `023_mercadopago_billing` e
`024_billing_hq` permanecem não aplicados e desativados. Identificar sempre
o nome completo do arquivo; o prefixo numérico isolado não comprova aplicação.
O CI preserva os testes e backups separados das duas entregas.
Os resultados abaixo de 941 testes e 27 integrações referem-se a `efe16a4`,
antes desta incorporação. A versão integrada exige nova rodada de validação.

## 2026-09-13 — proposta dos planos na landing e homologação retomada

Por solicitação do responsável, a landing segue a referência aprovada com
Individual, Essencial, Equipe (seletor 5/10 agendas) e Everflair IA “Em breve”,
independentemente da ativação da cobrança. IA é ilustrativa e não contratável. Catálogo
mensal/anual, economia anual e adicionais usam os mesmos valores do backend.
Com checkout desativado, a escolha segue para cadastro como interesse, sem
cobrança ou promessa de ativação. Recursos e FAQ deixam de anunciar Fundador.
O PR #101 incorpora `origin/master` com o domínio oficial e o timeout de CI.
Lint, TypeScript, 941 testes e build passaram; 27 integrações PostgreSQL
passaram em banco sintético separado com a migration HQ real.
Pedido posterior clareou o violeta e arredondou os anuais para R$ 599, R$ 779,
R$ 959 e R$ 1.439, no catálogo 2026-09-13. Contratos anteriores preservam
seus valores persistidos. Referência aprovada e comparação em `design-qa.md`.

Após autenticação do comprador fictício `3683184927` e abertura de checkout
novo, o cartão oficial de teste aprovou os ciclos mensal e anual do Equipe
Plus. Webhooks espontâneos assinados, consulta ao provedor, cobrança única,
cinco agendas e projeção no HQ foram verificados. As duas renovações foram
canceladas no provedor, preservando histórico e acesso até 13/10/2026 e
13/09/2027, respectivamente. Isso supera a pendência das tentativas anteriores
registradas abaixo. Nenhuma cobrança real, migration ou ativação em Production
foi realizada. Staging persistente e push no iPhone seguem não validados.
Detalhes e resultados finais em `MERCADOPAGO_PORTAL_HQ.md` e no PR #101.

## 2026-09-13 — Codespace identificado e webhook espontâneo de cancelamento

Identificado e iniciado o Codespace `glorious-enigma-jjv6v4rvrv49f544r` da conta
`alisonbielwhats1-beep`: branch `codex/everflair-demo`, commit `106ac11`, limpo.
Consulta somente leitura confirmou banco local `everflair_demo` e runtime
`app_runtime` sem superusuário/BYPASSRLS. A aplicação na porta 3000 está privada
e sua abertura no navegador retornou 401. O PR #101 não foi implantado ali;
schema, dados e visibilidade não foram alterados. Os dois Supabase existentes
continuam destinados a produção. Inventário em `AMBIENTES.md`.

Nova assinatura fictícia `4c2d1646473e4a9ea8d91dfc89109c46` ficou com confirmação
desabilitada no checkout e foi cancelada sem pagamento. O cancelamento gerou
webhook espontâneo `subscription_preapproval` às `2026-09-13T05:10:38.895Z`,
HMAC válido, HTTP 200 e inbox posteriormente processada sem erro. Foi usado
ingresso temporário e banco sintético local. Aprovação de novo pagamento por
esse caminho e push no iPhone da conta oficial permanecem **não validados**.
Evidências em `MERCADOPAGO_PORTAL_HQ.md`. Nenhuma ativação produtiva autorizada
ou realizada nesta verificação.

## 2026-09-13 — portal de assinatura e integração HQ em revisão

O PR #101 inclui escolha mensal/anual, continuidade no cadastro/login,
portal `/assinatura` exclusivo do proprietário e sincronização de pagamentos,
plano, período e capacidade com HQ/CRM/CMM. Confirmação financeira permanece
no backend; retorno do checkout não libera o plano. Estornos parciais mostram
o valor devolvido e reduzem a receita recebida; histórico é preservado.

Migration 024 aditiva validada em PostgreSQL local com RLS, sem aplicação
produtiva. `MERCADOPAGO_HQ_SYNC_ENABLED` é opt-in e permanece desligada junto
da contratação e do reconciliador em Production. A 011 também segue desligada.
Lint, TypeScript, 930 testes unitários/componentes, 27 integrações PostgreSQL
e build passaram nesta ampliação. CI/schema-smoke e Preview serão registrados
no PR para o commit final.

O simulador oficial da aplicação fictícia enviou webhook externo com HMAC
autêntico, aceito com HTTP 200 e consulta ao provedor; a cobrança fictícia
previamente aprovada apareceu automaticamente no HQ. Não há staging persistente
classificado: foi usado ingresso HTTPS temporário restrito ao webhook e banco
local sintético. O novo checkout ficou com confirmação desabilitada no Mercado
Pago; sua assinatura pendente foi cancelada, sem pagamento novo. URLs de teste
removidos e ingresso temporário encerrado. A notificação nativa no celular não
foi comprovada. Escopo, evidências e limites em `MERCADOPAGO_PORTAL_HQ.md`.

## 2026-09-12 — backend Mercado Pago em revisão, desativado

Branch `codex/mercadopago-subscriptions`, base `5cca634` (PR #99): contratação
mensal/anual, confirmação financeira, liberação por período, carência de cinco
dias, renovação, cancelamento e fila de reconciliação implementados. Contratos
legados preservados; suspensão administrativa independente. Detalhes, preços,
APIs e roteiro de liberação em `MERCADOPAGO_ASSINATURAS.md`.
Migration 023 validada somente no PostgreSQL local descartável, não aplicada em
Production. MERCADOPAGO_BILLING_ENABLED e execução agendada seguem desativadas;
PLATFORM_BILLING_ENABLED permanece false e 011 não foi aplicada. Checkout no
frontend e webhook externo ainda pendentes nesta etapa histórica; a ampliação
de 13/09 acima registra o estado mais recente. No teste com contas
fictícias, criação, aprovação mensal, liberação e cancelamento foram confirmados
pelo Mercado Pago; contrato anual também criado e cancelado ainda pendente.
Detalhes e limites dessa evidência no documento da entrega. PR #101 em revisão.

## 2026-09-13 — recebimentos e agendamento: publicação autorizada

Branch `codex/booking-receipts-experience`, base inicial `5cca634` (PR #99), atualizada com `d970b11` (PR #102).
A solicitação reúne baixa em lote, ajustes antes de receber, serviços repetidos,
preferência de cores, atendimento de sempre, complementos, retorno previsto,
sugestões de horários e oferta de fila com aceite.
Pagamentos e Fechamento deixam a navegação: as rotas antigas redirecionam ao
Financeiro. Abertura/fechamento de caixa e sinais sugeridos automaticamente em
30% deixam esta experiência; registros históricos permanecem preservados.
Esta decisão substitui a navegação financeira separada descrita em fases anteriores.
Detalhes e evidências em `RECEBIMENTOS_E_AGENDAMENTO_2026-09-13.md`.
O responsável autorizou "faça o deploy em produção" após a aprovação do PR #103.
CI 34745748168 aprovado: 924 testes unitários, PostgreSQL e 102 testes de navegador.
Migration 023 aplicada no projeto `vshnatkzxdekkvqttvbv`, versão `20260913142553`,
após preflight e backup criptografado com decifragem/checksum verificados.
Os 1.191 pagamentos (14.589.500 centavos) e 2.276 itens de serviço foram preservados
por checksum. RLS ENABLE/FORCE, três guardas e backfill foram verificados.
O deploy segue a integração do PR #103; commit e conferência final ficam no PR.

## 2026-09-13 — domínio oficial do cliente, publicação autorizada

O responsável autorizou manter o link antigo e passar a divulgar o novo.
Vercel confirmou `everflair.com.br` e `salon-saas-ruby.vercel.app` como
Production com configuração válida; home e vitrine retornaram 200 em ambos.
O domínio oficial atual é **https://everflair.com.br**; referências abaixo
à URL oficial Vercel são históricas. O domínio antigo permanece disponível.

Branch `codex/customer-official-domain`, base `5cca634`: Compartilhar/QR Code
e Marketing passam a consultar `PUBLIC_BOOKING_URL`, sem alterar
`NEXTAUTH_URL`, secrets, cookies, manifestos ou dados. A publicação ocorrerá
após lint, TypeScript, testes, build, CI e Preview; resultado final no PR.
Plano e recuperação em `DOMINIO_CLIENTE_2026-09-13.md`. Sem migration.


## 2026-09-12 — busca, bloqueios e encaixe: publicação autorizada

Branch `codex/booksy-client-followup`, base `ad0f654` (PR #98 integrado).
Os quatro vídeos e dois áudios desta solicitação originam busca de clientes
no servidor, edição individual de bloqueios, motivo opcional para bloquear,
separação visual de bloqueios/reservas e encaixe deliberado também na edição.
Este último substitui a limitação histórica de overbooking só na criação:
dono/gerente confirmam com motivo, preservando aceite e auditoria.
Escopo e verificação em `BOOKSY_PEDIDOS_2026-09-12.md`. Sem migration.
O responsável autorizou "suba em produção" nesta tarefa. Publicação após
CI/Preview do PR #99; commit implantado e conferência final ficam no PR.
Lint, TypeScript, 907 testes Vitest e build passaram localmente.

## 2026-09-12 — telefone e remarcação em revisão

Continuação autorizada do PR #98: cores mais visíveis por profissional,
telefone obrigatório no cadastro público, alerta para contas sem telefone e
correção da consulta de disponibilidade ao remarcar a própria reserva.
Escopo e diagnóstico em `TELEFONE_REMARCACAO_2026-09-12.md`. Sem publicação.

## 2026-09-12 — semana, minutos e seletor de clientes em revisão

O PR #98 recebe a faixa de domingo a sábado na agenda diária, régua de quinze
minutos, identificação explícita de contas nas duplicatas e filtragem de
clientes mesclados/excluídos no seletor manual. Acesso do cliente preservado.
Escopo em `AGENDA_CLIENTES_2026-09-12.md`; sem migration ou publicação.
O commit anterior 3576b7f passou no CI 34674872601 e Preview. Esta ampliação
requer nova validação integral, cujo resultado ficará no PR.

## 2026-09-12 — exclusão da lista e responsividade em revisão

O PR #98 também inclui exclusão/restauração de clientes pelo proprietário,
somente na lista do CRM. Conforme decisão expressa, o acesso do cliente e
seus agendamentos/histórico permanecem intactos. Usa eventos de auditoria
existentes, sem migration. Cabeçalhos respeitam áreas seguras e as janelas
acompanham a área visível com teclado/zoom; fechamento recebe grade móvel.
Escopo e evidências em `RESPONSIVIDADE_E_LISTA_2026-09-12.md`.
Ainda não publicado; a validação desta ampliação está em andamento.

## 2026-09-11 — pedidos de edição, término e cadastro em revisão

Branch `codex/client-feedback-fixes`, base `cb3babc`: seleção de serviços no
detalhe, aceite de mudança dos serviços, estado assíncrono de envio, exceção
pontual de término após o último turno para dono/gerente e recuperação de
cadastro repetido por autenticação da senha existente. Escopo, diagnóstico
somente leitura e verificação em `PEDIDOS_CLIENTE_2026-09-11.md`.
Sem migration, escrita manual em Production ou publicação desta entrega.
Esta revisão amplia o limite de término descrito no PR #96 sem mudar a jornada.

## 2026-09-11 — Suporte assistido: publicação autorizada

Branch codex/hq-support-pilot: base técnica versionada e fluxo de rascunho por
cliente, com revisão manual para resposta, ticket ou associação a bug/feature.
Reutiliza hq_agent_runs, timeline e orçamento do Chefe; sem nova migration.
Escopo e validação em HQ_SUPORTE_PILOTO.md. Publicação e ativação autorizadas
pelo responsável; HQ_SUPPORT_ENABLED=true configurada somente em Production,
aguardando o novo deploy. CI 34566197862 passou com 86 jornadas; integração
com a atualização de agenda do PR #96 será validada novamente. Resultado
final do deploy e conferência será registrado no PR #97. Sem WhatsApp ou envio.

## 2026-09-11 — piloto do Agente Chefe publicado e ativado

O responsável salvou a chave na Vercel, adquiriu créditos e autorizou prosseguir.
PR #94 integrado em d2e9647aebed57543af70dc16ad265089391ab34; Production
dpl_4GPX5ebXCvT6YHmCiFQLydRCSLHg READY. HQ_CHIEF_ENABLED=true e orçamento
HQ_CHIEF_MONTHLY_USD=2, somente Production. Chave permanece Secret na Vercel.
Migration 022 aplicada uma vez no projeto vshnatkzxdekkvqttvbv, versão
20260911044105, após preflight e recuperação criptografada do escopo aditivo.
RLS ENABLE/FORCE, políticas e grants verificados; CRM preservado por checksum.
Primeira consulta operacional concluída e persistida: 542 tokens de entrada,
207 de saída, estimativa de US$ 0,000384. Nenhuma mensagem WhatsApp enviada.
Evidências e limites em HQ_CHEFE_RELEASE_2026-09-11.md. Este registro substitui
o estado de implementação abaixo; laboratório continua fictício e separado.

## 2026-09-11 — criação manual com horário editável, publicação autorizada

Branch `codex/client-booksy-improvements`: o formulário aberto pelo “+” ou pela
grade permite escolher data e hora por minuto, inclusive para séries, e oferece
reutilização dos serviços da última reserva. Bloqueio aceita digitação direta
de minutos; dono/gerente podem confirmar atendimento dentro de TimeOff sem
removê-lo, e sobreposição exige confirmação separada. Histórico respeita tenant/papel;
preços e disponibilidade continuam validados no servidor. Escopo e validação
em `AGENDAMENTO_MANUAL_2026-09-11.md`. Publicação do PR #96 autorizada pelo responsável; sem migration desta entrega. Resultado do deploy será registrado no PR.
## 2026-09-11 — Agente Chefe: piloto de leitura em implementação

Pedido posterior autoriza conectar dados do HQ, modelo e histórico com limite
de consumo. Escopo em HQ_CHEFE_PILOTO.md, no PR #94. Laboratório anterior
b09d4ec passou no CI 34553915666 e Preview, incluindo a correção de teclado.
Piloto reutiliza withHq e métricas do dashboard; acrescenta migration aditiva
022 para execuções/reservas. Não aplicada em Production. HQ_CHIEF_ENABLED
permanece false até configuração da chave, orçamento e publicação autorizada.
Nenhuma chamada paga ou mensagem enviada nesta implementação.

## 2026-09-10 — agentes: laboratório em desenvolvimento

Branch codex/hq-agents-foundation, atualizada com PR #93. Escopo em
HQ_AGENTES_ARQUITETURA.md. /hq/agents passa a ter sete cenários fictícios de
Chefe/Suporte, usando Agents SDK 0.18.0 com modelo local determinístico.
Sem chamadas OpenAI, WhatsApp, alteração de dados ou migration. Resultados
voláteis na página; não são histórico persistente nem prova de qualidade de IA.
Isolamento de Zod 4 em workspace preserva Zod 3 do produto. Promoção ainda
não realizada; validação final será registrada no PR desta entrega.

## 2026-09-11 — listas mobile em revisão

Branch `codex/mobile-list-cleanup`: clientes, serviços, avaliações e profissionais
priorizam listas no celular, com filtros compactos e desempenho recolhido.
Escopo e evidências em `MOBILE_LISTAS_2026-09-11.md`. Sem migration ou produção.

## 2026-09-11 — PR #93 publicado

Preços variáveis e configurações por assunto publicados no commit
`e3e8ad5ab02929f7c5fb040dc73b63be9b320021`, deployment Production
`dpl_HUfPHn6EmaLGewYN2NKJW5N2SqBg` READY. CI 34550786407 aprovado; sonda,
catálogo e agendamento responderam normalmente, sem erros de runtime na janela
verificada. Conclui a preparação registrada abaixo. Evidências no PR #93.

## 2026-09-11 — preços variáveis e configurações: publicação autorizada

PR #93 implementa Fixo / A partir de, explicação para o cliente e snapshots
preservados nas reservas. Configurações abre com busca e tópicos navegáveis.
O responsável autorizou migration e publicação em Production. Como a 020 de HQ
já foi aplicada pelo PR #92, esta entrega usa a migration aditiva 021.
A migration 021 foi aplicada no projeto produtivo `vshnatkzxdekkvqttvbv`,
versão `20260911012714`, após backup criptografado e preflight. Os 160 serviços
e 2.234 vínculos de agendamento foram preservados por checksum. CI final da
integração em validação; resultado de merge/deploy e conferência no PR #93.
Escopo e recuperação em `PRECOS_VARIAVEIS_CONFIGURACOES_2026-09-10.md`.

## 2026-09-10 — Everflare HQ publicado no PR #92

Central privada em /hq, separada dos salões e do Booksite. Auditoria e
arquitetura em EVERFLARE_HQ.md; validação e recuperação em HQ_RELEASE_2026-09-10.md.
O responsável autorizou usar o Supabase existente como destino da entrega.
Testes permanecem no PostgreSQL descartável. CI 34546774574 passou com migration
020, preservação, RLS e jornadas em quatro resoluções. Migration 020 aplicada
no Supabase produtivo sob versão 20260911004924 após preflight e recuperação
delimitada: 14 tabelas com ENABLE/FORCE RLS, 18 FKs, nenhum grant público,
contagens anteriores preservadas. CI final 34548342951 aprovado: 793 testes,
9 integrações HQ e 81 jornadas de navegador. Merge 433afcba2c726aa10c16b60aad0ee5ba68324b0b;
Production dpl_4yohwk8oZzBvEANWfLwkpw7GpJsf READY. HQ_ENABLED=true;
billing 011 permanece desativado. A versão publicada pelo PR #92 ainda não
executa agentes. Evidências de publicação e smoke somente leitura no PR #92.

## 2026-09-10 — bloqueios acionáveis e encaixe na pausa (PR #90)

Na branch `codex/agenda-block-management`, os bloqueios da agenda deixam de ser
uma camada visual que repassa o toque ao horário vazio. Dono e gerente abrem os
detalhes diretamente nas visões diária, semanal e em lista, revisam profissional,
período e motivo e confirmam explicitamente a reabertura. Após reabrir um
intervalo menor que um dia, a interface oferece iniciar o agendamento naquele
horário. Papéis sem permissão continuam impedidos de alterar o bloqueio e o
servidor preserva validação de papel, tenant, lock e auditoria.

A criação manual durante pausa semanal também corrige a primeira tentativa: o
servidor devolve a pausa detectada para que a tela peça confirmação explícita,
sem obrigar o preenchimento de motivo. Bloqueios pontuais continuam
inegociáveis enquanto existirem; devem ser reabertos antes do agendamento.
Nenhuma migration, dado produtivo ou regra do Booksite foi alterada.
Publicação em produção autorizada; resultado final será registrado no PR #90.

## 2026-09-10 — dependências de segurança publicadas (PR #91)

O PR #91 foi integrado em `master` no commit
`2b96063a042863a8c1ac3b94edbea9446401eb54` e o deploy Production foi
confirmado `SUCCESS` pela Vercel. Next.js e seus pacotes alinhados foram
atualizados de `15.5.22` para `15.5.25`, `sharp` de `0.35.3` para
`0.35.4`, Vitest e cobertura de `4.1.10` para `4.1.11`, e `js-yaml` foi fixado
em `4.3.2` por override. O `npm audit` completo e somente de produção retornam
zero vulnerabilidades. Esta entrega não contém migration, alteração de dados
ou mudança de configuração do Supabase/Vercel.

## 2026-09-10 — agenda com prioridade à grade (PR #89)

A revisão `codex/agenda-fullscreen` retira cards de indicadores e legendas
redundantes da Agenda. Data e visualizações ficam em uma barra compacta; busca
e filtros abrem sob demanda. A grade usa a altura restante da tela, com rolagem
própria, cabeçalhos menores e calendário lateral inicialmente recolhido. O “+”
reúne também pausa recorrente, seleção de intervalo e gestão de expediente,
bloqueios e fila. Nenhuma regra de acesso ou banco foi alterada.
Validação visual local usa exclusivamente dados fictícios em 320, 390 e 1440px.
Promoção condicionada à aprovação de CI/Preview; commit, deploy e verificação
produtiva são registrados no PR #89. Escopo detalhado em
`AGENDA_JORNADAS_2026-09-09.md`.

## 2026-09-10 — ações rápidas da agenda publicadas

Com base nos três áudios e no vídeo do responsável, a agenda passa a oferecer um
botão “+” flutuante no celular, acima da barra inferior, com três ações: novo
agendamento, novo bloqueio de horário e adicionar folga. O desktop usa o mesmo
menu no lugar do botão “Novo”. Bloqueio e folga reutilizam o fluxo auditado já
existente; a folga abre como dia inteiro e continua exigindo revisão. Permissões
de servidor permanecem inalteradas. PR #88 integrado no commit
`16ac54c4aa1b997c2dfccb532a879d5de604d5f2`, deploy
`dpl_76nmwbNzfVhvXmsTfYXk3pp5e1bj` confirmado `READY` em Production após CI e
smoke somente leitura. Sem alteração de banco.

## 2026-09-09 — encaixe manual durante pausa publicado

O PR #87 foi integrado em `master` no commit
`7b7e0351dd65be46b4efeaecb1d6cb0304ddfac7` e publicado no deploy
`dpl_5Jjd5oMenY5enANJ1bQfteaHBHiG`, estado `READY`. Dono ou o próprio
profissional podem criar um agendamento durante uma pausa semanal com motivo e
auditoria; o Booksite continua bloqueando o horário para clientes. A publicação
passou pelos dois jobs do CI e pelo smoke somente leitura no domínio oficial.
Nenhuma migration ou escrita manual no banco foi necessária.

## 2026-09-09 — horários do salão separados das jornadas

A configuração deixa de selecionar toda a equipe por padrão. O horário geral do
estabelecimento agora pode ser salvo sozinho, sem tocar nas jornadas individuais.
Substituir horários de profissionais exige ativar uma opção separada, escolher
cada pessoa e revisar o antes/depois. A interface avisa que horários especiais,
como uma terça-feira iniciando às 14h sem pausa, serão substituídos; folgas e
reservas continuam preservadas. A publicação desta revisão foi autorizada pelo
responsável pelo produto.

A mesma revisão corrige a leitura visual da agenda diária: períodos fora da
jornada e pausas passam a receber o rótulo “Fora do expediente” com tracejado,
separado dos bloqueios explícitos. Dono e gerente continuam vendo todos os
profissionais; o papel profissional continua limitado à própria agenda. O motor
de disponibilidade já respeitava essas jornadas, portanto não houve alteração
na regra de agendamento nem no banco.

No Studio Martinelli, Anderson acumula os papéis de proprietário e profissional.
Como proprietário, visualiza a equipe inteira; como profissional cadastrado,
continua com jornada, bloqueios e coluna próprios na agenda.

## 2026-09-09 — correção operacional de jornadas; interface publicada

Correção posterior do responsável: abertura **09h**, fechamento **21h**, pausa
**12h30–15h**. A referência do salão e as manhãs dos dois profissionais foram
atualizadas com novo preflight, backup, rollback condicional e auditoria. Os 46
agendamentos presentes no momento dessa correção foram preservados por checksum.
Essa confirmação substitui a abertura 06h registrada historicamente abaixo.

A mesma branch ampliou a agenda com pausa semanal sem data final, seleção de
dias (todos, segunda a sexta, sábado e domingo ou personalizados) e bloqueios
temporários por dias até uma data final. O PR #84 foi integrado em `master` no
commit `78e902b5bd49d5dec57aabe8d3128c4573e186fe` e publicado em Production.
Capturas de validação usam dados fictícios e devem ser identificadas como teste.

O responsável confirmou pausa comum 12h30–15h e fechamento às 21h para o
estabelecimento reportado. Configuração corrigida em transação, com backup,
auditoria e checksum confirmando os 44 agendamentos preservados. Abertura às
06h conforme solicitação inicial; dias de folga mantidos. Um atendimento futuro
na pausa continua exigindo revisão humana, sem remarcação automática.

A branch `codex/fix-scheduling-hours`, baseada em `master` `9f4ee3d`, centraliza
expediente/equipe/pausas e esclarece duração/término ao remarcar. Escopo, testes
e limites em `AGENDA_JORNADAS_2026-09-09.md`. A configuração e essa interface
foram publicadas pelo PR #84. Nenhuma migration.

## 2026-09-08 — jornada do cliente em revisão; PR #82 publicado

PR #82 integrado no commit `aca303b349dbc864af40fcefc6b52a146f4bbf71`,
Production `dpl_BsuGoh4eDd6uisZ1FWeMnDxP57Xo` READY. Operação gratuita foi
ativada conforme evidência: https://github.com/alisonbielwhats1-beep/barber-saas/pull/82#issuecomment-5576103545.
Isso conclui o registro de preparação abaixo. E-mail continua sem remetente
verificado, sem ativação de envio para clientes.

Nova revisão autorizada: catálogo compacto, consulta antes do login, retorno
com escolhas preservadas, entrada menor, animação presente desde o HTML inicial,
tema claro/escuro independente no cliente e convite destacado para avaliação.
Escopo: `docs/CLIENTE_AGENDAMENTO_CLARO_2026-09-08.md`. Branch
`codex/client-booking-clarity`, sem banco ou promoção produtiva nesta revisão.

## 2026-09-07 — PR #81 publicado; operação gratuita em preparação

O PR #81 foi integrado no commit `f92fa0468efeae2b950e404508b5f15f3c901bdd`.
Production `dpl_3M8Xo1kFJ4CNFNh9E4xqM5oaTupg` foi confirmado READY no domínio
oficial, com páginas públicas e acesso respondendo 200 e link Google Maps presente.
Evidência: https://github.com/alisonbielwhats1-beep/barber-saas/pull/81#issuecomment-5567178873.
Isso conclui o estado histórico “em revisão” da responsividade abaixo.

O responsável solicitou implementar as medidas gratuitas de operação.
`codex/free-operations` prepara monitor de disponibilidade e auditoria semanal
no GitHub, ensaio completo de restauração sintética e procedimento de incidente.
Ativação e evidências serão registradas no PR da entrega. Sem compra ou migration.
O envio Resend continua pendente: usuário sem domínio e nenhum domínio cadastrado
na conta conectada. Não foi ativado remetente de teste para clientes.
Escopo e limites: `docs/OPERACAO_GRATUITA_2026-09-07.md`.

## 2026-09-07 — PR #80 publicado; responsividade do cliente em revisão

O PR #80 foi integrado em `master` no commit
`0d20f99b8868cc5f24dedee8c5e185601c39bc90`. Production
`dpl_H1iLeeNZJr5okkpP8mkE9oHmmVBu` foi confirmado READY no domínio oficial.
Home, login, welcome, manifestos e ícones conferidos; nenhum erro de runtime
no intervalo pós-publicação. Evidência final:
https://github.com/alisonbielwhats1-beep/barber-saas/pull/80#issuecomment-5566245378.
Isso conclui os registros históricos de preparação/revisão abaixo.

A revisão seguinte, `codex/client-responsive-entry`, corrige cabeçalho e acesso
do cliente, substitui o logo ampliável pela marca Everflair e retira fotos dos
serviços. Escopo em `docs/CLIENTE_RESPONSIVO_2026-09-07.md`. Sem banco ou nova
promoção produtiva nesta revisão.

## 2026-09-07 — publicação do PR #80 autorizada, em preparação

O responsável autorizou atualizar o GitHub, integrar e publicar em produção
as revisões do PR #80. A entrega inclui temas, cores por profissional,
experiência do cliente e ícone de instalação Flair lilás sobre grafite.
Escopo adicional em `docs/ICONE_INSTALACAO_2026-09-07.md`. O ícone substitui
a versão marfim anterior. Não há migration nem escrita de dados nesta release.
Publicação ocorrerá após CI/Preview do commit final; o resultado verificável
de merge, deployment e conferência será registrado no PR #80. Até lá,
Production continua no commit `dc2baf4085cfbef4701488c5b0ae2dcb4eb1c2a8`.

## 2026-09-07 — tema claro com fundo neutro e profundidade, em revisão

No PR #80, o tema claro substitui a base marfim/pedra por cinza quase branco
frio, cartões e menu brancos, bordas suaves e sombras discretas nos painéis.
Diálogos têm elevação maior; campos preservam identificação e foco. A decisão
substitui o marfim registrado nas revisões anteriores, mantendo cores
operacionais e profissionais. Implementação em `src/app/globals.css` e escopo
em `docs/CORES_E_APRESENTACAO_2026-09-07.md`. Sem banco ou deploy produtivo.

## 2026-09-07 — agenda com cores por profissional, em revisão

No PR #80, fundo/faixa dos cartões passam a identificar o profissional,
substituindo a cor do status. Cabeçalhos com fotos, filtros e legenda usam a
mesma cor nos temas claro/escuro e nas quatro visões. Status e conflitos
continuam explícitos, sem mudar regras operacionais. Escopo em
`docs/AGENDA_CORES_PROFISSIONAIS_2026-09-07.md`. Sem banco ou deploy produtivo.

## 2026-09-07 — aplicativo do cliente com entrada e cores, em revisão

No PR #80, entrada do cliente com fundo grafite e luzes móveis verde/lilás;
botões e CTA verdes, ícones de contato coloridos e reservas com bloco verde,
vermelho, âmbar ou azul conforme o estado. Nova abertura repete a animação;
navegação interna não repete. Substitui a entrada clara discreta de 1,4 segundo
descrita no registro histórico da marca. Escopo e verificações em
`docs/CLIENTE_CORES_ENTRADA_2026-09-07.md`. Sem banco ou deploy produtivo.

## 2026-09-07 — tema claro com prioridade mais definida, em revisão

No PR #80, o próximo atendimento passa a usar verde sólido da marca no tema
claro. Indicadores e próximas ações ganham acentos verdes, azuis, âmbar e cobre;
os ícones da agenda acompanham os tokens do tema. Marfim/pedra e bordas têm
maior separação. Escopo e contraste medido em
`docs/CORES_E_APRESENTACAO_2026-09-07.md`.
Sem mudança de banco ou novo deploy produtivo.

## 2026-09-07 — conta de apresentação enriquecida

Por solicitação explícita, a demonstração persistente foi ampliada para
5 profissionais com fotos, 60 clientes, 20 serviços, 15 produtos ilustrados,
12 itens de portfólio e 1.802 agendamentos entre 24/07 e 07/10/2026.
Público feminino e masculino têm cadastro e histórico para os indicadores.
Também foram complementados recebimentos, despesas e pacotes fictícios.
Detalhes, totais e evidências: `docs/DADOS_APRESENTACAO_2026-09-07.md`.
Nenhuma migration ou promoção de código; PR #80 permanece em revisão.

## 2026-09-07 — PR #79 publicado; revisão de cores e conta de apresentação

O PR #79 foi integrado em `master` no commit
`dc2baf4085cfbef4701488c5b0ae2dcb4eb1c2a8`. O deployment Production
`dpl_2rbpUGEszdKX5bBX7LvesPpEtiC8` foi confirmado READY. Isso conclui a publicação
registrada como em preparação abaixo.

A revisão seguinte está em `codex/color-and-demo`, ainda sem promoção produtiva:
fundos neutros, controles verdes e estados semânticos; marca com nome no menu
expandido e seletor de aparência no topo. O responsável rejeitou o uso dominante
de roxo; lilás fica limitado à marca e seleção. Essa decisão substitui a proposta
intermediária de controles roxos.

Por solicitação explícita de criação no Supabase como novo cliente, a conta
persistente `Everflair Studio · Demonstração` foi criada em Production com dados
fictícios e credenciais privadas. Não é ambiente de teste. Houve preflight,
backup criptografado e confirmação de preservação dos registros anteriores nas
19 tabelas envolvidas; nenhuma migration ou mudança de RLS. Escopo e evidências
em `docs/CORES_E_APRESENTACAO_2026-09-07.md`.

## 2026-09-07 — publicação autorizada do PR #79; banco 018/019 aplicado

O responsável autorizou explicitamente o merge, deploy em produção e atualização
do GitHub. Esta autorização sucede os limites de homologação registrados abaixo.
As migrations manuais 018 e 019 foram aplicadas no projeto `barber-saas`
(`vshnatkzxdekkvqttvbv`) às 02:59 UTC, após preflight e backup lógico criptografado.
As verificações passaram; os registros anteriores permaneceram idênticos e as
sete tabelas novas têm RLS ENABLE/FORCE. `app_runtime` continua sem BYPASSRLS.

A aplicação desta entrega é publicada pelo merge do PR #79 em `master`, com
build Production pela integração Git da Vercel. Na preparação deste registro,
o deployment anterior ainda era `dpl_8KS5HHN5NoaBPSAGDXSnhjGuxBm6` (`a66a98b`).
O resultado final do merge/deploy e a conferência posterior serão registrados
no PR #79: https://github.com/alisonbielwhats1-beep/barber-saas/pull/79.
Evidências, recuperação e escopo em `docs/RELEASE_PRODUCAO_2026-09-07.md`.
Não reaplicar 018/019. Nenhum teste ou seed foi executado em Production.

## 2026-09-06 — marca Flair escolhida, em revisão no PR #79

O responsável escolheu a proposta 3 (Flair), substituindo o monograma EF.
A nova marca compartilhada também aparece na landing, com lilás discreto, e
na entrada animada do cliente, cuja sessão é independente do painel e por
estabelecimento. Ícones de instalação atualizados. Escopo e verificações em
docs/MARCA_FLAIR_2026-09-06.md. Sem promoção produtiva ou mudança de banco.

## 2026-09-06 — refinamento autorizado do menu e calendário no PR #79

O topo passa a exibir somente o símbolo (Flair, após a escolha acima). Menu recolhível com preferência
local, calendário lateral com seleção de datas e semanas, versão móvel em
janela e fotos/nomes preservados na grade. O responsável autorizou lilás/roxo
como acento no tema claro: seleção e foco, mantendo marfim/grafite e ações
verdes/vermelhas. Esta decisão substitui a restrição histórica dessa família de
cor na interface. Escopo e validação em docs/NAVEGACAO_CALENDARIO_2026-09-06.md.
Sem mudança de banco nem promoção produtiva; checks por versão no PR #79.

## 2026-09-06 — pendências implementadas no PR #79, sem promoção produtiva

Na branch codex/product-experience / PR #79: seleção de bloqueios na grade,
recorrência, bloqueios semana/mês/lista, edição de séries com revisão de conflitos,
fila flexível FIFO, sugestões de encaixe, variantes e etapas de serviços,
reservas exclusivas de salas/equipamentos, dependentes e cuidados/fotos privados.
Dashboard/relatórios indicam próximas ações e pacotes têm filtros de vencimento.
Migration 019 aditiva executada com backup/restauração, preflight, reaplicação,
preservação dos registros, RLS e constraints no PostgreSQL descartável do GitHub.
Os 7 testes PostgreSQL de recursos, fila, dependentes e cuidados passaram.
Não há alteração produtiva nem atualização do Codespace.
144 arquivos / 687 testes locais passaram; TypeScript, lint e build passaram.
A verificação de navegador cobre 18 áreas em desktop claro e mobile escuro.
As falhas de contraste, rótulos, datas entre fusos e distribuição móvel encontradas
foram corrigidas no mesmo PR. O run `34071775481` (`87f4ccb`) passou integralmente:
40 verificações autenticadas (36 visuais/acessíveis), 31 testes públicos e todos
os jobs de banco. Zero violações nas regras axe executadas, erros de runtime ou
overflow da página nas 36 verificações. Refinamentos posteriores de leitura móvel
são acompanhados pelos checks da versão corrente do PR.
Checklist completo em docs/EVOLUCAO_PRODUTO_2026-09-06.md; plano de banco em
docs/MIGRATION_019_RECURSOS_CUIDADOS.md. Este registro substitui as pendências
históricas abaixo; promoção produtiva permanece sujeita a aprovação separada.

## 2026-09-06 — evolução de produto em implementação, sem deploy

- Incremento 018 em validação: expediente adicional por data e registro real de
  chegada. Autorização do responsável para validar no ambiente GitHub; CI usa
  PostgreSQL 16 descartável e dados fictícios. Plano em
  `docs/MIGRATION_018_EXPEDIENTE_CHEGADA.md`. Não aplicar em Production.

- Branch `codex/product-experience`, baseada em `origin/master` `a66a98b`.
- Bloqueios por profissional/intervalo na agenda, cancelamento separado das
  reservas selecionadas, capacidade corrigida, comunicação manual explícita,
  atalhos e refinamentos de interface. Catálogo consultável antes do login;
  autenticação obrigatória para reservar e entrar na fila permanece no servidor.
- Escopo implementado e pendências das 12 frentes em
  `docs/EVOLUCAO_PRODUTO_2026-09-06.md`. O programa completo não está concluído.
- Direção visual adicional autorizada pelo responsável: entrada animada Everflair,
  retratos com nomes abaixo na agenda diária e tema claro em marfim/pedra/grafite.
  Os efeitos seguem as cores da marca, sem reproduzir a paleta Fresha.
- Lint, TypeScript, 681 testes e build local passaram. Não houve teste produtivo
  nem promoção desta branch. CI e schema-smoke da etapa visual `d665f44` passaram.
- O run GitHub `34059744513`, commit `10055ef`, validou a migration 018 no
  PostgreSQL descartável: backup/restauração, reaplicação, preservação dos
  registros e RLS sem BYPASSRLS. Testes PostgreSQL de concorrência passaram.
  A jornada encontrou seletor ambíguo, corrigido com associação explícita de rótulo.
- O run `34060782156`, commit `b78aa88`, passou integralmente: check,
  schema-smoke, login/isolamento, reserva pública, chegada, expediente extra,
  bloqueio sem cancelamento e rollbacks. Capturas confirmaram ações verdes e
  vermelhas e cartões legíveis; a captura do tema claro foi estabilizada para
  aguardar o fim da transição de cores. Resultados por versão ficam nos checks
  do PR #79. O Codespace de demonstração não foi alterado.


## Revisão mais recente — restauração da referência 6fd3d21

O usuário rejeitou a proposta de fundos verdes. A demonstração retorna a
superfícies neutras e acentos da referência 6fd3d21 no commit
106ac1154c700190954be7ec2b0cc2a13e7c012b. Esta decisão substitui a paleta
verde/areia descrita abaixo. Escopo em `docs/RESTAURACAO_PALETA_6fd3d21.md`.
Produção permanece sem alteração nesta revisão.

## Atualização de 06/09/2026 — produção e nova paleta

Este registro prevalece sobre os estados históricos abaixo. A produção foi
promovida pelo PR #77 ao commit 38222cb3c0e79d5bb8c0f4c1987a97625dbb7199;
o deployment dpl_6A5dDNia6v33aHXbokbTCvhFpHZh foi confirmado READY.

A revisão posterior de verde #126949 e areia #E8DED0 está implementada localmente
em codex/emerald-sand-refinement e enviada à branch codex/everflair-demo no commit
10872764897cb89d1b63c41056847940cd9c1d4b. Não foi promovida a produção.
Lint, TypeScript, 659 testes e build passaram; npm audit reportou zero
vulnerabilidades. Após o Codespace iniciar, o build e a conferência autenticada
passaram: seis verificações de fluxo, dez capturas desktop/mobile, zero erros
de execução e zero violações nas regras axe executadas. Escopo e referências em
`docs/PALETA_VERDE_AREIA_2026-09-06.md`.

## Decisão e primeiro acesso — trabalho local de 05/09/2026

Melhorias da avaliação implementadas na branch `codex/everflair-conversion`:
demonstração guiada da operação, planos antecipados e adaptados ao celular,
contexto do plano no cadastro, catálogo inicial opcional, guia de configuração
no painel e contato alternativo no login. Detalhes, validação e proposta de
piloto em `docs/CONVERSAO_2026-09-05.md`. Trabalho local ainda não publicado.

## Identidade Everflair — trabalho local de 05/09/2026

A identidade aprovada foi aplicada localmente na branch `codex/everflair-brand`,
preservando as melhorias locais de landing, agenda em dispositivos e motion.
Escopo, evidências e limites em `docs/EVERFLAIR_2026-09-05.md`.
Esta etapa ainda não foi publicada; as informações de implantação abaixo são
históricas e não indicam publicação da marca Everflair.

Atualizado em **30/08/2026**. As migrations manuais 012, 013, 014, 015, 016 e
017 foram aplicadas no Supabase Production; a execução da fase 017 ocorreu
após autorização explícita e antes da promoção do código correspondente.
Este arquivo substitui os status históricos quando houver contradição.

## Prontidão comercial implantada

- Commit funcional promovido em `master`: `8827095e49257b0c74dcab5e405ccc72cda25978`.
- PR integrado: `#75`, branch `codex/commercial-readiness-audit`.
- Auditoria e matriz P0–P3:
  `docs/AUDITORIA_PRONTIDAO_COMERCIAL_2026-08-30.md`.
- A candidata exige conta no servidor para agendamento/fila pública, mantém
  cliente sem conta apenas na operação manual da equipe, reforça senhas,
  uploads/imagens, PWA, CSP, acessibilidade, recuperação de senha por e-mail e
  tratamento de JSON inválido.
- A migration manual aditiva `017_password_recovery` foi aplicada em Production
  em 30/08/2026 após autorização explícita, identificação inequívoca do projeto
  `barber-saas` (`vshnatkzxdekkvqttvbv`) e preflight somente leitura. As
  contagens permaneceram em 20 usuários e 58 perfis de cliente; seis colunas e
  dois índices foram confirmados, com zero tokens ou versões alterados.
- Evidência do CI no commit `8827095`: 121 arquivos/618 testes Vitest, três
  testes de integração, build aprovado, E2E público em Chromium, Firefox e
  WebKit e duas jornadas autenticadas no PostgreSQL 16 descartável.
- Preview `dpl_CcNM4jTEDGzEymdr1wu9RePHKpNe` ficou `READY`; a landing respondeu
  `200` e rotas protegidas responderam o `503` esperado pelo guard de ambiente.
- `RESEND_API_KEY` e `EMAIL_FROM` permanecem ausentes em Production. A
  recuperação por e-mail fica desativada e seu atalho não aparece nos logins
  até um remetente verificado ser configurado; a promoção sem essa integração
  foi autorizada explicitamente em 31/08/2026.
- Production `dpl_51L9sN7suMvwFq4SwXXD1xBRxU21` está `READY` e serve o commit
  funcional `8827095`. O smoke somente leitura confirmou home, login, vitrine,
  manifesto e health em `200`, banco `ok`, CSP/HSTS, ausência de imagens
  quebradas e nenhum erro 500 no deploy.

## Fase 0 — prontidão para produção em validação

As proteções desta fase estão sendo implementadas na branch
`codex/fase-0-production-readiness` e ainda não representam um deploy em
Production. A entrega local adiciona `/api/health`, validação do contrato de
ambiente, headers básicos de segurança, testes de fumaça e um gate do CI. O
checklist externo de homologação, monitoramento, backup/restauração e smoke
test pós-deploy está em `docs/FASE_0_PRODUCTION_READINESS.md`.

## Identificação da versão

- Repositório: `alisonbielwhats1-beep/barber-saas`
- Branch produtiva: `master`
- Commit funcional da aplicação: `8827095e49257b0c74dcab5e405ccc72cda25978`
- Vercel: projeto `salon-saas`
- Deploy do commit: `dpl_51L9sN7suMvwFq4SwXXD1xBRxU21`, estado `READY`
- URL oficial: [salon-saas-ruby.vercel.app](https://salon-saas-ruby.vercel.app)
- Região das Functions: `gru1`
- Banco/Storage: Supabase do projeto de barbearia
- Smoke pós-deploy: home, login, sessão e `/api/health` responderam `200`; o
  health check confirmou `database: ok`.

## O que está em Production

### Estabelecimento

- dashboard, agenda dia/semana/mês/lista, clientes, profissionais e serviços;
- financeiro, despesas, relatórios, produtos, estoque, pacotes e portfólio;
- configurações do perfil, logo e capa do estabelecimento;
- notificações internas e lembretes pelo cron;
- permissões por papel, com financeiro bloqueado para profissional;
- seletor de tenant para usuários com múltiplos vínculos.
- avaliações verificadas no painel, com distribuição, média e moderação sem
  exclusão;

### Cliente

- vitrine pública por `salonSlug`;
- seleção de múltiplos serviços, profissional, data e horário;
- seleção automática quando somente um profissional realiza todos os serviços;
- avaliações públicas por atendimento concluído, com nota, comentário e nome
  anonimizado;
- CTA de agendamento fixo na viewport e revisão final antes da confirmação;
- criação idempotente, histórico, reagendamento e cancelamento;
- fluxo explícito mobile e barra inferior com safe area;
- notificações internas e lista de espera vinculada ao horário;
- próxima reserva destacada, com data relativa, duração e endereço;
- cor de marca aplicada em toda a experiência pública;
- serviços e categorias sem fotos na jornada, conforme revisão publicada no PR #81;
- catálogo de produtos e portfólio público.

### Confiabilidade da agenda

- timezone IANA por estabelecimento e servidor como fonte de verdade;
- `timestamptz` para instantes e intervalo `[início, fim)`;
- transação, advisory lock, idempotency key e proteção de conflito no banco;
- múltiplos serviços com snapshots de duração/preço;
- reagendamento atômico mantendo o mesmo agendamento;
- cancelamento sem delete, com ator, motivo, evento e liberação do horário;
- histórico imutável de eventos e outbox idempotente de notificações;
- polling seguro como fallback; Supabase Realtime ainda não é a fonte principal.

### Entrega local desta solicitação — fase 016

- regras de preço por dia da semana ou data específica, com precedência da data
  exata sobre o dia da semana e snapshots do valor no atendimento;
- janela pública limitada a 60 dias, mesmo que uma configuração antiga tenha
  valor maior;
- alteração de horário feita pela equipe gera proposta para cliente com conta,
  aceite/recusa no app, histórico e notificações internas idempotentes;
- cancelamento feito pela equipe preserva a fila ativa; dono/gerente promovem
  explicitamente apenas a primeira posição após conferir a disponibilidade;
- atalho de ligação por telefone no app público e nas telas operacionais;
- cliente vê entrar/criar conta desde a vitrine e pode autenticar antes de
  entrar na fila, sem persistir nome/telefone em armazenamento do navegador.

### Administração global

- `PlatformRole.SUPER_ADMIN` separado dos papéis de cada tenant;
- login padrão do SUPER_ADMIN redireciona para `/plataforma`;
- visão geral e fila de solicitações de estabelecimentos;
- aprovação como FREE/PRO, alteração de plano, suspensão e reativação;
- suspensão preserva todos os dados;
- decisões gravadas em `SalonAccessEvent`;
- e-mail do administrador principal configurado em variável sensível da Vercel;
- a promoção persistente ocorre no primeiro acesso autenticado à plataforma.

## Banco, RLS e migrations

### Estado conhecido

- O runtime usa a role `app_runtime`, sem `BYPASSRLS`.
- RLS e GUCs (`app.current_salon`, `app.current_user_id` e token de convite)
  reforçam o isolamento no banco.
- O código não deve usar Prisma cru em operação tenant-scoped; use os helpers
  de `src/lib/prisma-tenant.ts`.
- As três migrations Prisma de convites foram reconciliadas/aplicadas na Fase 1.
- A migration manual `008_fase2_appointment_reliability` foi aplicada e
  verificada em Production durante o rollout da Fase 2.
- As estruturas de `009_waitlist_reliability` e
  `010_platform_access_approval` pertencem às versões produtivas atuais.
  Como são SQL manual, confirme objetos e policies com consultas somente
  leitura antes de qualquer migration futura; não as reaplique cegamente.
- A migration manual `012_appointment_product_tenant_snapshots` foi aplicada
  após preflight produtivo com zero vínculos cross-tenant, zero órfãos e zero
  pagamentos sem salão. O backfill terminou sem snapshots nulos.
- A migration manual `013_operational_query_indexes` foi aplicada e os cinco
  índices operacionais foram confirmados em `pg_indexes`.
- A migration manual `016_booking_experience` foi executada em Production pelo
  responsável em 27/08/2026 antes da promoção do commit `83ab133`.
- A migration manual `017_password_recovery` foi executada em Production em
  30/08/2026. O preflight passou; 20 usuários e 58 perfis de cliente foram
  preservados, e a verificação confirmou seis colunas, dois índices e zero
  tokens/versões previamente preenchidos.

### Não aplicado

- `011_platform_billing.sql` **não foi aplicado em Production**.
- `PLATFORM_BILLING_ENABLED` permanece ausente ou `false`.
- A interface de cobranças do SaaS fica inacessível e as Server Actions falham
  fechadas enquanto a flag estiver desligada.
- Preflight e rollback não destrutivo estão versionados junto da migration.

### Proibições

- não executar `prisma db push`, seed, reset ou `migrate dev` em Production;
- não usar Production para descobrir se uma migration “funciona”;
- não marcar migration como aplicada sem comparar o schema real;
- não remover snapshots, eventos, invoices ou agendamentos cancelados;
- não trocar `DATABASE_URL` para a role `postgres` com `BYPASSRLS`.

## Ambientes

- Desenvolvimento: PostgreSQL local com dados fictícios.
- CI: PostgreSQL 16 efêmero; executa lint, typecheck, unitários, integração,
  concorrência, build e schema smoke-test.
- Preview/staging: a arquitetura está documentada, mas um segundo Supabase
  inequivocamente identificado ainda é necessário para homologar migrations.
- Production: Vercel + Supabase atuais; migrations produtivas não são
  automatizadas pelo repositório.

## Integrações e flags

- Upstash/KV: configurado para rate limiting distribuído.
- Supabase Storage: bucket público de assets usado para imagens permitidas.
- Vercel Cron: `/api/cron/reminders`, protegido por `CRON_SECRET`.
- Resend/e-mail: infraestrutura existe, mas convites reais permanecem
  desativados até configurar e validar `RESEND_API_KEY`, `EMAIL_FROM` e
  `EMAIL_INVITES_ENABLED=true` primeiro fora de Production. Recuperação de
  senha usa as mesmas credenciais, sem ativar convites, e também deve ser
  validada primeiro no Preview seguro.
- WhatsApp: somente atalho manual; nenhuma integração paga automática.
- Billing automático/Stripe: não implementado nem autorizado.

## Melhoria da jornada do cliente implantada

- O PR #44 foi integrado a `master` e implantado em Production.
- A seleção de serviços não exige mais rolagem até o fim da lista para avançar.
- O único profissional compatível é selecionado automaticamente; quando há
  mais opções, a escolha continua explícita.
- A confirmação ganhou uma revisão final com serviço, profissional, data,
  duração, total, endereço e política de cancelamento.
- A próxima reserva tem prioridade visual sobre histórico e filas de espera.
- Categorias aceitam nomes livres e usam a primeira foto de serviço disponível
  como capa, evitando migration ou alteração de banco.
- Deploy funcional: `dpl_DheyfzeD79yKhaKjNNfCuzVjpaYy`, estado `READY`.
- Nenhum banco, migration, variável remota ou dado do Supabase foi alterado.

## Marketing e reativação implantados

- O PR #48 foi integrado a `master` e implantado em Production.
- “Lembrete de sumidos” existe na página de Marketing e continua usando o
  WhatsApp manual, sem disparo pago ou automático.
- O dono configura entre 15 e 365 dias para um cliente ser considerado sumido;
  o padrão seguro permanece 60 dias.
- A regra é tenant-scoped e vale de forma consistente em Marketing, Clientes,
  Dashboard e Relatórios.
- A configuração é persistida na trilha append-only `AuditLog`, sem migration
  ou alteração de schema em Production.
- Campanhas podem personalizar nome, cupom, dias sem visita, serviço favorito,
  link de agendamento e link de avaliação do Google.
- A página prioriza reativação semanal, avaliações e indicações, com uma
  oportunidade de retorno estimada a partir do ticket real da base.
- Deploy funcional: `dpl_AoMGQXkw1ZbfZchSr4qb2gjUakuS`, estado `READY`.
- Home e vitrine pública responderam `200`; `/marketing` sem sessão respondeu
  `307` para login; não houve erro nos logs pós-deploy verificados.

## Wave1 de maturidade comercial — implantada

O PR #50 foi revisado por ondas de implementação e crítica independente; o
hotfix do PR #51 fechou a incompatibilidade de lock público com a role runtime.

### Jornada e componentes compartilhados

- disponibilidade diferencia dia realmente vazio (`200` com `slots=[]`) de
  timeout, rede, JSON/contrato inválido, `429` e erro de servidor;
- seleção restaurada só volta para a mesma combinação de salão, serviços,
  profissional e data; respostas fora de ordem são descartadas e o CTA fica
  bloqueado até o horário estar confirmado na grade atual;
- retry respeita `Retry-After` em segundos ou HTTP-date, exibe contagem,
  preserva escolhas e consulta a combinação atual após troca de data;
- Toast possui regiões vivas separadas por severidade, anúncio único, fila,
  limpeza de timers, pausa em hover/foco e continuidade de foco ao fechar;
- Dialog compartilhado nomeia o fechamento e usa alvo mínimo de 44 px;
- Command Palette e o modal mobile “Mais” usam coordenação explícita: somente
  um modal/focus trap permanece aberto, inclusive via `Ctrl/Cmd+K`, e Escape
  devolve o foco a um gatilho conectado.

### Segurança pública e isolamento

- `withApprovedSalon` e `withSalonBySlug` validam `APPROVED` sob lock
  compartilhado durante todo o callback, serializando suspensão concorrente;
- login do cliente valida schema/tamanho/72 bytes antes de headers, rate
  limiting, lookup ou bcrypt, e ganhou bucket global por IP contra rotação de
  slugs sem remover buckets por salão e conta;
- cadastro, agendamento visitante e lista de espera usam a mesma validação de
  telefone BR: formatos nacional, `55` e `+55`, celular/fixo, DDD e prefixo;
  excesso é rejeitado sem truncar ou transformar silenciosamente outro número;
- cron consulta apenas salões aprovados e revalida/bloqueia cada tenant durante
  a geração idempotente de lembretes;
- rotas públicas de disponibilidade, agendamento e fila falham de forma
  uniforme para estabelecimento inexistente ou não aprovado.

### Agenda, comanda, estoque e fila

- mutações operacionais usam ordem canônica de locks `appointment →
  professional → product`, com ids ordenados dentro de cada grupo;
- reserva de produtos no agendamento público é atômica com a criação e com o
  fingerprint idempotente; preço/quantidade são snapshots do servidor;
- comanda reconcilia reserva anterior com a quantidade final: conserva o preço
  das unidades reservadas, usa preço atual somente nas adicionais, debita ou
  devolve apenas o delta e registra `Payment` e auditorias na mesma transação;
- fechamento da comanda é idempotente, impede double debit/double payment,
  bloqueia desconto da recepção e gera recibo interno/imprimível a partir do
  pagamento persistido;
- ajustes manuais de estoque são tenant-scoped, bloqueiam estoque negativo e
  registram saldo anterior/novo e motivo em `AuditLog`;
- cancelamento restaura cada reserva no máximo uma vez; cancelamento pela
  equipe preserva as entradas ativas da fila, e dono/gerente podem promover
  explicitamente a primeira posição somente depois de uma nova checagem;
- `IN_PROGRESS` e `COMPLETED`, assim como a abertura da comanda, só são aceitos
  depois do início contratado; a UI deriva as ações da mesma regra temporal.

### Testes, CI e rollout

- testes DOM cobrem concorrência da disponibilidade, cooldowns sucessivos,
  troca de consulta durante `429`, modais mobile/palette, teclado e retorno de
  foco;
- testes PostgreSQL descartáveis cobrem concorrência de agenda, comanda/estoque
  e o lock de aprovação versus suspensão; o último identifica o backend por
  `application_name` e prova bloqueio com `pg_stat_activity` e
  `pg_blocking_pids`;
- `schema-smoke` executa essas famílias pelo script
  `test:appointment-integration`;
- evidência local final: lint e TypeScript passaram; `npm test` passou com 71
  arquivos e 464 testes; o build completo do Next.js 15.5.22 passou e gerou 41
  páginas;
- CI do PR #50 e do hotfix #51 passou; o PostgreSQL 16 efêmero executou agenda,
  comanda, concorrência, suspensão e uma role `NOBYPASSRLS` equivalente à
  `app_runtime` sob FORCE RLS;
- o primeiro deploy do PR #50 (`dpl_8GvJGoEHeBzLqXmfZohqpTYRwJ4k`) retornou 404
  nas vitrines públicas. Houve rollback imediato para
  `dpl_6KwTp9HBs4iYSBEd4gABks3d7jdW`, com recuperação dos 90 serviços do Studio
  Martinelli;
- causa: `SELECT ... FOR SHARE` ocorria antes de `app.current_salon`; a policy
  RLS de UPDATE tornava a linha invisível à role runtime. O PR #51 passou a
  resolver o id publicamente, setar a GUC local, revalidar slug + `APPROVED` e
  só então adquirir o lock;
- deploy final do hotfix: `dpl_65KHBGkS2SGbd6HdMGTCKopLqV6B`, estado `READY`.
  Home e `/book/studio-martinelli/agendar` foram verificados por GET; a vitrine
  exibiu 90 serviços, sem 404 e sem erro/warning de navegador ou runtime.

### Limitações deliberadamente não resolvidas

- O código da onda ainda precisa ser promovido pelo PR de release e verificado
  nas rotas administrativas e públicas após o deploy.
- O recibo continua interno, não fiscal, embora agora preserve nome do produto
  e moeda como snapshots persistidos.
- Billing automático, pagamento online, Realtime tenant-aware e múltiplas
  unidades continuam fora do escopo.

## Evidências da entrega implantada no PR #48

- `npm run lint`: passou.
- `npx tsc --noEmit --incremental false`: passou.
- `npm test`: 61 arquivos e 297 testes passaram.
- `npm run build`: passou com Next.js 15.5.22.
- CI, integração, build e `schema-smoke` do PR #48: passaram.
- Inspeção visual com 24 serviços: CTA fixo no limite da viewport, seleção
  automática e revisão final confirmadas, sem erro de console.
- Produção após deploy: home, vitrine pública e agendamento responderam `200`;
  a Vercel não registrou erros no intervalo verificado.

## Pendências reais e priorizadas

1. Finalizar o PR de release, promover o código e verificar home, dashboard,
   agenda, fechamento e vitrine pública após o deploy.
2. Confirmar manualmente o primeiro login do administrador principal e a
   promoção para `SUPER_ADMIN`; nenhuma senha foi acessada pelo agente.
3. Criar/identificar Supabase de homologação separado antes da migration `011`.
4. Validar a migration `011`, RLS, rollback e cobranças manuais em staging;
   só depois decidir se ativa em Production.
5. Ativar convites por e-mail via Resend somente após teste completo em Preview.
6. Confirmar no CI os novos E2E Playwright públicos e autenticados; repetir as
   jornadas no Preview quando houver banco de staging seguro.
7. Ensaiar backup nativo/restore do Supabase antes de clientes reais.
8. Rotacionar/remover qualquer credencial de demonstração conhecida e nunca
   documentar senhas no repositório público.
9. Realtime filtrado por tenant, múltiplas unidades e pagamento online continuam
   fora do escopo atual.

## Próximo passo recomendado

Concluir a candidata de prontidão comercial sem alterar Production:

- **Operação imediata:** validar login SUPER_ADMIN e onboarding de um tenant;
- **Infraestrutura:** criar staging Supabase e ensaiar a migration `011`;
- **Qualidade:** aprovar CI e executar E2E dos fluxos críticos em Preview isolado.

## Prompt curto para outra conversa

> Trabalhe no repositório `alisonbielwhats1-beep/barber-saas`. Leia primeiro
> `AGENTS.md`, `docs/STATUS_ATUAL.md`, `docs/AMBIENTES.md` e
> `docs/DECISOES_PRODUTO.md`. Não altere Production. Continue pela auditoria
> versionada, confirme branch/CI/Preview e não repita evidências já coletadas.
> A base da candidata é `8b1fd34`; a migration
> `011_platform_billing` não foi
> aplicada e a flag de billing está desligada. Preserve RLS, histórico e
> isolamento multi-tenant. Proponha o próximo passo antes de qualquer migration.


## 2026-09-06 — refinamento operacional em demonstração

- Implementação local em `codex/product-refinement`, preservando alterações anteriores de identidade Everflair.
- Correções publicadas em `codex/everflair-demo`, commit funcional `9cadcd8`; script de verificação isolada em `5401fe0`; acessibilidade refinada em `e4df171` e `700f835`.
- Paleta neutra no painel e no cliente, melhoria do menu mobile, agenda e jornada de autenticação.
- Correções de caixa por pagamento, permissões da recepção, consumo/renovação de pacotes, estoque e mesclagem de clientes.
- 659 testes unitários/regressão passaram. TypeScript, lint e build passaram. Auditoria de dependências: zero vulnerabilidades.
- Build da demonstração concluído no Codespace, banco e dados existentes preservados. Nenhuma migration ou deploy produtivo foi realizado.
- A liberação pública da porta 3000 foi bloqueada pela revisão automática; solicitação de autorização explícita pendente. Não contornar essa decisão. Verificação pelo localhost do Codespace: seis fluxos aprovados, dez telas capturadas, zero erros de runtime; ajustes de contraste e semântica aplicados a partir do axe.
- Não houve CI remoto nesta branch nem promoção produtiva. Testes PostgreSQL abrangentes e revisão de release permanecem necessários antes de promover.
- Esta rodada não encerra os 32 itens da auditoria. Escopo e pendências: `docs/REFINAMENTO_OPERACIONAL_2026-09-06.md`.
