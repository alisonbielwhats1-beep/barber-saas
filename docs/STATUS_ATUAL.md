# Status atual canônico — Salon SaaS


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
